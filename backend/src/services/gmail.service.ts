/**
 * GmailService
 *
 * Handles all Gmail API interaction:
 *  - OAuth2 token management (load, save, auto-refresh)
 *  - Listing message IDs with pagination
 *  - Fetching full message detail
 *  - Parsing sender / subject / date / body from Gmail payload format
 *
 * Rate-limit strategy: process in batches of 25 with a 400 ms pause between
 * batches — well within Gmail's 250 quota-units/s per-user ceiling.
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { logger } from '../utils/logger';
import { withRetry, withTimeout, isTransientError, sleep } from '../utils/retry';

const TOKENS_PATH = path.join(__dirname, '../../data/tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export interface ParsedEmail {
  gmailMessageId: string;
  threadId: string | null;
  subject: string | null;
  snippet: string | null;
  fromAddress: string | null;
  fromName: string | null;
  receivedAt: string | null; // ISO string
  bodyText: string | null;
  rawPayloadJson: string;
}

export interface ListMessagesPage {
  messageIds: string[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export class GmailService {
  private auth: OAuth2Client;
  private gmail: gmail_v1.Gmail;

  constructor() {
    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  isAuthenticated(): boolean {
    if (!fs.existsSync(TOKENS_PATH)) return false;
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
      this.auth.setCredentials(tokens);
      return !!(tokens.access_token || tokens.refresh_token);
    } catch {
      return false;
    }
  }

  getAuthUrl(): string {
    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  }

  async exchangeCodeForTokens(code: string): Promise<void> {
    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);
    this.saveTokens(tokens);
    logger.info('Gmail OAuth tokens saved');
  }

  loadTokens(): void {
    if (!fs.existsSync(TOKENS_PATH)) {
      throw new Error('No Gmail tokens found. Complete OAuth at /auth/google');
    }
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    this.auth.setCredentials(tokens);

    // Persist refreshed tokens automatically
    this.auth.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      this.saveTokens(merged);
      logger.debug('Gmail tokens auto-refreshed');
    });
  }

  /**
   * Returns true if the error is an OAuth invalid_grant, meaning the refresh
   * token has expired or been revoked and the user must re-authenticate.
   */
  static isInvalidGrantError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    if (msg.includes('invalid_grant')) return true;
    // google-auth-library sometimes wraps it in a GaxiosError response body
    const body = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
    return body === 'invalid_grant';
  }

  /**
   * Deletes the stored tokens file so isAuthenticated() returns false and
   * subsequent scheduler checks stop attempting scans.
   */
  private clearTokens(): void {
    try {
      if (fs.existsSync(TOKENS_PATH)) {
        fs.unlinkSync(TOKENS_PATH);
        logger.warn('[gmail] Stale tokens removed — re-authentication required at /auth/google');
      }
    } catch {
      // best-effort
    }
  }

  private saveTokens(tokens: object): void {
    fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  }

  /**
   * Interactive CLI auth for first-run when no tokens exist.
   * Only used when running directly (not via HTTP auth flow).
   */
  async authenticateInteractive(): Promise<void> {
    const url = this.getAuthUrl();
    console.log('\n─────────────────────────────────────────────────────');
    console.log('Open this URL in your browser to authorize HireTrack:');
    console.log('\n' + url + '\n');
    console.log('─────────────────────────────────────────────────────\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise<string>((resolve) => {
      rl.question('Paste the authorization code here: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    await this.exchangeCodeForTokens(code);
  }

  // ─── Message Listing ───────────────────────────────────────────────────────

  /**
   * Fetches a page of message IDs matching the given query.
   * Gmail query syntax: https://support.google.com/mail/answer/7190
   *
   * @param query  - Gmail search query (e.g. "after:2026/01/01")
   * @param pageToken - continuation token for pagination
   * @param maxResults - max number of message IDs to fetch (1-500)
   */
  async listMessageIds(
    query: string,
    pageToken?: string | null,
    maxResults = 100
  ): Promise<ListMessagesPage> {
    try {
      return await withRetry(
        async () => {
          const normalizedMaxResults = Math.max(1, Math.min(500, maxResults));
          const response = await withTimeout(
            () =>
              this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: normalizedMaxResults,
                pageToken: pageToken ?? undefined,
              }),
            15_000,
            'gmail.messages.list'
          );

          const data = response.data;
          return {
            messageIds: (data.messages ?? []).map((m) => m.id!).filter(Boolean),
            nextPageToken: data.nextPageToken ?? null,
            resultSizeEstimate: data.resultSizeEstimate ?? 0,
          };
        },
        {
          maxAttempts: 4,
          initialDelayMs: 2_000,
          shouldRetry: isTransientError,
          context: 'gmail.listMessageIds',
        }
      );
    } catch (err) {
      if (GmailService.isInvalidGrantError(err)) {
        this.clearTokens();
        throw new Error('Gmail authentication expired — re-authenticate at /auth/google');
      }
      throw err;
    }
  }

  /** Fetches lightweight metadata + snippet for stage-1 classification. */
  async fetchMessageMetadata(messageId: string): Promise<ParsedEmail> {
    try {
      return await withRetry(
        async () => {
          const response = await withTimeout(
            () =>
              this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'metadata',
                metadataHeaders: ['From', 'Subject', 'Date'],
              }),
            15_000,
            `gmail.messages.get.metadata(${messageId})`
          );

          return this.parseMessage(response.data, false);
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1_500,
          shouldRetry: isTransientError,
          context: 'gmail.fetchMessageMetadata',
        }
      );
    } catch (err) {
      if (GmailService.isInvalidGrantError(err)) {
        this.clearTokens();
        throw new Error('Gmail authentication expired — re-authenticate at /auth/google');
      }
      throw err;
    }
  }

  /**
   * Fetches and parses full message payload for stage-2 deep classification
   * and extraction.
   */
  async fetchMessage(messageId: string): Promise<ParsedEmail> {
    try {
      return await withRetry(
        async () => {
          const response = await withTimeout(
            () =>
              this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full',
              }),
            15_000,
            `gmail.messages.get.full(${messageId})`
          );

          return this.parseMessage(response.data, true);
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1_500,
          shouldRetry: isTransientError,
          context: 'gmail.fetchMessage',
        }
      );
    } catch (err) {
      if (GmailService.isInvalidGrantError(err)) {
        this.clearTokens();
        throw new Error('Gmail authentication expired — re-authenticate at /auth/google');
      }
      throw err;
    }
  }

  // ─── Batch Fetching ────────────────────────────────────────────────────────

  /**
   * Fetches multiple messages with rate-limit-safe batching.
   * Processes BATCH_SIZE at a time with BATCH_DELAY_MS between batches.
   */
  async fetchMessagesBatch(
    messageIds: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<ParsedEmail[]> {
    const BATCH_SIZE = 25;
    const BATCH_DELAY_MS = 400;

    const results: ParsedEmail[] = [];

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batch = messageIds.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map((id) => this.fetchMessage(id))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          logger.warn('Failed to fetch message', { error: result.reason?.message });
        }
      }

      onProgress?.(Math.min(i + BATCH_SIZE, messageIds.length), messageIds.length);

      if (i + BATCH_SIZE < messageIds.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return results;
  }

  // ─── Message Parsing ───────────────────────────────────────────────────────

  private parseMessage(
    msg: gmail_v1.Schema$Message,
    includeBody: boolean
  ): ParsedEmail {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string): string | null =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

    const subject = getHeader('Subject');
    const fromRaw = getHeader('From') ?? '';
    const dateRaw = getHeader('Date');

    // Parse "Name <email@domain.com>" or "email@domain.com"
    const fromMatch = fromRaw.match(/^(.*?)\s*<([^>]+)>/);
    const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : null;
    const fromAddress = fromMatch ? fromMatch[2].trim() : fromRaw.trim() || null;

    // Parse date to ISO string
    let receivedAt: string | null = null;
    if (msg.internalDate) {
      receivedAt = new Date(parseInt(msg.internalDate, 10)).toISOString();
    } else if (dateRaw) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) receivedAt = d.toISOString();
    }

    const bodyText = includeBody ? this.extractBodyText(msg.payload ?? {}) : null;

    return {
      gmailMessageId: msg.id!,
      threadId: msg.threadId ?? null,
      subject,
      snippet: msg.snippet ?? null,
      fromAddress,
      fromName,
      receivedAt,
      bodyText,
      rawPayloadJson: JSON.stringify({
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds,
        snippet: msg.snippet,
        payload: {
          headers: msg.payload?.headers,
          mimeType: msg.payload?.mimeType,
        },
      }),
    };
  }

  /**
   * Recursively walks the Gmail MIME tree and extracts both text/plain and
   * text/html (stripped) when available, then merges them.
   */
  private extractBodyText(
    payload: gmail_v1.Schema$MessagePart,
    depth = 0
  ): string | null {
    const parts = this.extractBodyParts(payload, depth);
    const merged = [parts.plain, parts.html].filter(Boolean).join('\n\n').trim();
    return merged || null;
  }

  private extractBodyParts(
    payload: gmail_v1.Schema$MessagePart,
    depth = 0
  ): { plain: string | null; html: string | null } {
    if (depth > 10) return { plain: null, html: null }; // safety guard

    let plain: string | null = null;
    let html: string | null = null;

    if (payload.body?.data) {
      const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
      if (payload.mimeType === 'text/plain') {
        plain = text;
      } else if (payload.mimeType === 'text/html') {
        html = this.stripHtml(text);
      }
    }

    for (const part of payload.parts ?? []) {
      const child = this.extractBodyParts(part, depth + 1);
      if (!plain && child.plain) plain = child.plain;
      if (!html && child.html) html = child.html;
      if (plain && html) break;
    }

    return { plain, html };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}

export const gmailService = new GmailService();

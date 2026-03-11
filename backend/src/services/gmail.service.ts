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
   */
  async listMessageIds(
    query: string,
    pageToken?: string | null
  ): Promise<ListMessagesPage> {
    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            this.gmail.users.messages.list({
              userId: 'me',
              q: query,
              maxResults: 100,
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
  }

  /**
   * Fetches and parses the full message detail for a given Gmail message ID.
   */
  async fetchMessage(messageId: string): Promise<ParsedEmail> {
    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            this.gmail.users.messages.get({
              userId: 'me',
              id: messageId,
              format: 'full',
            }),
          15_000,
          `gmail.messages.get(${messageId})`
        );

        return this.parseMessage(response.data);
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1_500,
        shouldRetry: isTransientError,
        context: 'gmail.fetchMessage',
      }
    );
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

  private parseMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string): string | null =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

    const subject = getHeader('Subject');
    const fromRaw = getHeader('From') ?? '';
    const dateRaw = getHeader('Date');

    // Parse "Name <email@domain.com>" or "email@domain.com"
    const fromMatch = fromRaw.match(/^(.*?)\s*<([^>]+)>/) ;
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

    const bodyText = this.extractBodyText(msg.payload ?? {});

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
   * Recursively walks the Gmail MIME tree to extract plain text body.
   * Prefers text/plain; falls back to text/html stripped of tags.
   */
  private extractBodyText(
    payload: gmail_v1.Schema$MessagePart,
    depth = 0
  ): string | null {
    if (depth > 10) return null; // safety guard

    // Direct body
    if (payload.body?.data) {
      const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
      if (payload.mimeType === 'text/plain') return text;
      if (payload.mimeType === 'text/html') return this.stripHtml(text);
    }

    if (!payload.parts) return null;

    // Prefer text/plain part over text/html
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plainPart) {
      const result = this.extractBodyText(plainPart, depth + 1);
      if (result) return result;
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart) {
      const result = this.extractBodyText(htmlPart, depth + 1);
      if (result) return result;
    }

    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const result = this.extractBodyText(part, depth + 1);
        if (result) return result;
      }
    }

    return null;
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

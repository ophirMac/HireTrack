/**
 * ScannerService — Core email scanning engine
 *
 * ── Scanning Modes ────────────────────────────────────────────────────────────
 *
 * Historical Scan (first run):
 *   - Fetches ALL emails since SCAN_START_DATE (default 2026/01/01)
 *   - Paginates through Gmail using pageToken stored in sync_state for resumption
 *   - Processes emails in batches, updating progress after each batch
 *   - When complete, marks history_scan_completed = 1 and sets last_scanned_after
 *
 * Incremental Scan (daily):
 *   - Fetches only emails since last_scanned_after
 *   - Also rescans the newest 20 messages as a safety backfill
 *   - Processes them through the same pipeline
 *   - Updates last_scanned_after to current time on success
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 *
 *   - gmail_message_id UNIQUE constraint prevents duplicate email storage
 *   - email_id UNIQUE constraint on job_interactions prevents re-extraction
 *   - processed_flag = 1 guards against re-running AI on processed emails
 *   - In-memory `isRunning` flag + DB status check prevent concurrent scans
 *
 * ── Processing Pipeline (per email) ──────────────────────────────────────────
 *
 *   1. Check gmail_message_id — skip if already processed
 *   2. Fetch full message from Gmail API
 *   3. Upsert into emails table (raw storage)
 *   4. Classify: job-related or not (OpenAI, cheap call)
 *   5. If job-related:
 *       a. Extract structured data (OpenAI, full extraction)
 *       b. Find or create company record
 *       c. Resolve logo (background, non-blocking)
 *       d. Create job_interaction record
 *       e. Update company current_status
 *   6. Mark email processed_flag = 1
 */

import {
  getSyncState,
  updateSyncState,
  createScanRun,
  updateScanRun,
  getActiveScanRun,
  upsertEmail,
  getEmailByGmailMessageId,
  markEmailInitialClassification,
  markEmailFinalClassification,
  markEmailProcessed,
  createJobInteraction,
  jobInteractionExistsForEmail,
  listPendingEmailMessageIds,
} from '../db';
import { gmailService, ParsedEmail } from './gmail.service';
import { openAIService } from './openai.service';
import { companyService } from './company.service';
import { logoService } from './logo.service';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

const SCAN_START_DATE = process.env.SCAN_START_DATE ?? '2026/01/01';
// Inter-batch delay to stay within Gmail API rate limits
const INTER_BATCH_DELAY_MS = 500;
const INCREMENTAL_SAFETY_RESCAN_COUNT = 20;
const EXPLICIT_NON_JOB_SENDERS = new Set([
  'jobs-listings@linkedin.com',
  ...parseCsvSet(process.env.NON_JOB_SENDERS),
]);
const EXPLICIT_NON_JOB_DOMAINS = new Set([
  'linkedin.com',
  'aiapply.co',
  'chataiapply.co',
  ...parseCsvSet(process.env.NON_JOB_SENDER_DOMAINS),
]);
const NON_EMPLOYER_CONTENT_MARKERS = [
  'aiapply',
  'auto apply',
  'auto-apply',
  'job matches',
  'best job matches',
  'recommended jobs',
  'your ai agent',
  'job alert digest',
  'resume builder',
  'cv builder',
  'cover letter generator',
];
const EMPLOYER_PROCESS_MARKERS = [
  'interview',
  'hiring manager',
  'talent acquisition',
  'application status update',
  'we reviewed your application',
  'moved forward with other candidates',
  'we regret to inform',
  'coding challenge',
  'take-home',
  'offer letter',
];

export class ScannerService {
  private isRunning = false;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initiates a historical scan from SCAN_START_DATE.
   * Safe to call multiple times — resumes from last page token if interrupted.
   */
  async runHistoricalScan(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scan already in progress — skipping historical scan trigger');
      return;
    }

    const state = getSyncState();
    if (state.history_scan_completed) {
      logger.info('Historical scan already completed — running incremental instead');
      await this.runIncrementalScan();
      return;
    }

    // Stale 'running' scan_run from a previous crash — mark it failed
    const staleRun = getActiveScanRun();
    if (staleRun) {
      updateScanRun(staleRun.id, {
        status: 'failed',
        error_message: 'Interrupted by server restart',
        finished_at: new Date().toISOString(),
      });
    }

    this.isRunning = true;
    const scanRun = createScanRun('historical');
    logger.info(`[scanner] Historical scan started`, { scanRunId: scanRun.id });

    let emailsScanned = 0;
    let jobEmailsDetected = 0;

    try {
      // Retry previously pending emails first so deep-stage failures are resumed
      // even if Gmail query cursors have advanced.
      const pendingRetry = await this.retryPendingEmails();
      emailsScanned += pendingRetry.scanned;
      jobEmailsDetected += pendingRetry.jobEmails;

      const query = `after:${SCAN_START_DATE}`;

      // Get total estimate for progress tracking (first page gives resultSizeEstimate)
      let currentPageToken: string | null = getSyncState().last_page_token ?? null;

      // If starting fresh, get estimate
      if (!currentPageToken) {
        const firstPage = await gmailService.listMessageIds(query, null);
        if (state.total_estimated_emails === 0) {
          updateSyncState({ total_estimated_emails: firstPage.resultSizeEstimate });
          logger.info(`[scanner] Estimated ${firstPage.resultSizeEstimate} total emails`);
        }
        // Immediately process this first page
        const { scanned, jobEmails } = await this.processMessageIds(
          firstPage.messageIds,
          scanRun.id
        );
        emailsScanned += scanned;
        jobEmailsDetected += jobEmails;

        currentPageToken = firstPage.nextPageToken;
        updateSyncState({
          last_page_token: currentPageToken,
          total_processed_emails: getSyncState().total_processed_emails + scanned,
        });
        updateScanRun(scanRun.id, { emails_scanned: emailsScanned, job_emails_detected: jobEmailsDetected });

        if (!currentPageToken) {
          // Only one page — done
          await this.completeHistoricalScan(scanRun.id, emailsScanned, jobEmailsDetected);
          return;
        }
      }

      // Paginate through remaining pages
      while (currentPageToken) {
        const page = await gmailService.listMessageIds(query, currentPageToken);

        const { scanned, jobEmails } = await this.processMessageIds(
          page.messageIds,
          scanRun.id
        );
        emailsScanned += scanned;
        jobEmailsDetected += jobEmails;

        currentPageToken = page.nextPageToken;

        // Persist cursor after every page — enables safe restart after crash
        updateSyncState({
          last_page_token: currentPageToken,
          total_processed_emails: getSyncState().total_processed_emails + scanned,
        });
        updateScanRun(scanRun.id, {
          emails_scanned: emailsScanned,
          job_emails_detected: jobEmailsDetected,
        });

        logger.info(`[scanner] Page processed`, {
          emailsScanned,
          jobEmailsDetected,
          hasMore: !!currentPageToken,
        });

        if (currentPageToken) await sleep(INTER_BATCH_DELAY_MS);
      }

      await this.completeHistoricalScan(scanRun.id, emailsScanned, jobEmailsDetected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('re-authenticate at /auth/google')) {
        logger.error('[scanner] Historical scan aborted — Gmail token expired or revoked. Re-authenticate at /auth/google', { error: msg });
      } else {
        logger.error('[scanner] Historical scan failed', { error: msg });
      }
      updateScanRun(scanRun.id, {
        status: 'failed',
        error_message: msg,
        finished_at: new Date().toISOString(),
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Incremental scan: fetches only emails newer than last_scanned_after.
   * Also rescans the newest 20 inbox emails as a safety backfill.
   * Runs daily via scheduler after historical scan is complete.
   */
  async runIncrementalScan(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scan already in progress — skipping incremental scan trigger');
      return;
    }

    const state = getSyncState();

    if (!state.history_scan_completed) {
      logger.warn('[scanner] Historical scan not complete — deferring incremental scan');
      return;
    }

    this.isRunning = true;
    const scanRun = createScanRun('incremental');

    let emailsScanned = 0;
    let jobEmailsDetected = 0;
    const seenMessageIds = new Set<string>();

    try {
      const pendingRetry = await this.retryPendingEmails();
      emailsScanned += pendingRetry.scanned;
      jobEmailsDetected += pendingRetry.jobEmails;

      // Build Gmail query: "after:YYYY/MM/DD" or Unix timestamp
      const after = state.last_scanned_after
        ? this.toGmailDate(state.last_scanned_after)
        : SCAN_START_DATE;

      const query = `after:${after}`;
      const scanStart = new Date().toISOString();

      logger.info(`[scanner] Incremental scan started`, { query });

      let pageToken: string | null = null;

      do {
        const page = await gmailService.listMessageIds(query, pageToken);

        if (page.messageIds.length === 0) break;

        const uniquePageMessageIds = page.messageIds.filter((id) => !seenMessageIds.has(id));
        for (const id of uniquePageMessageIds) seenMessageIds.add(id);

        if (uniquePageMessageIds.length === 0) {
          pageToken = page.nextPageToken;
          if (pageToken) await sleep(INTER_BATCH_DELAY_MS);
          continue;
        }

        const { scanned, jobEmails } = await this.processMessageIds(
          uniquePageMessageIds,
          scanRun.id
        );
        emailsScanned += scanned;
        jobEmailsDetected += jobEmails;

        pageToken = page.nextPageToken;
        updateScanRun(scanRun.id, {
          emails_scanned: emailsScanned,
          job_emails_detected: jobEmailsDetected,
        });

        if (pageToken) await sleep(INTER_BATCH_DELAY_MS);
      } while (pageToken);

      const newestMessages = await gmailService.listMessageIds(
        'in:inbox',
        null,
        INCREMENTAL_SAFETY_RESCAN_COUNT
      );
      const safetyRescanIds = newestMessages.messageIds;

      if (safetyRescanIds.length > 0) {
        logger.info('[scanner] Incremental safety rescan started', {
          count: safetyRescanIds.length,
        });
        const { scanned, jobEmails } = await this.processMessageIds(
          safetyRescanIds,
          scanRun.id,
          { forceRecheckNonJob: true }
        );
        emailsScanned += scanned;
        jobEmailsDetected += jobEmails;
      }

      // Update cursor to scan start time (not end time, to avoid gaps)
      updateSyncState({ last_scanned_after: scanStart });
      updateScanRun(scanRun.id, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        emails_scanned: emailsScanned,
        job_emails_detected: jobEmailsDetected,
      });

      logger.info(`[scanner] Incremental scan completed`, {
        emailsScanned,
        jobEmailsDetected,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('re-authenticate at /auth/google')) {
        logger.error('[scanner] Incremental scan aborted — Gmail token expired or revoked. Re-authenticate at /auth/google', { error: msg });
      } else {
        logger.error('[scanner] Incremental scan failed', { error: msg });
      }
      updateScanRun(scanRun.id, {
        status: 'failed',
        error_message: msg,
        finished_at: new Date().toISOString(),
      });
    } finally {
      this.isRunning = false;
    }
  }

  isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  private async retryPendingEmails(limit = 500): Promise<{ scanned: number; jobEmails: number }> {
    const pendingIds = listPendingEmailMessageIds(limit);
    if (pendingIds.length === 0) return { scanned: 0, jobEmails: 0 };

    logger.info(`[scanner] Retrying pending emails`, { count: pendingIds.length });
    return this.processMessageIds(pendingIds, 0);
  }

  // ─── Private: Batch Processing ─────────────────────────────────────────────

  private async processMessageIds(
    messageIds: string[],
    _scanRunId: number,
    options?: { forceRecheckNonJob?: boolean }
  ): Promise<{ scanned: number; jobEmails: number }> {
    let scanned = 0;
    let jobEmails = 0;
    const forceRecheckNonJob = options?.forceRecheckNonJob === true;

    const BATCH = 10; // fetch 10 messages in parallel to balance speed vs. rate limits

    for (let i = 0; i < messageIds.length; i += BATCH) {
      const batch = messageIds.slice(i, i + BATCH);

      await Promise.all(
        batch.map(async (msgId) => {
          try {
            const isJob = await this.processEmail(msgId, { forceRecheckNonJob });
            scanned++;
            if (isJob) jobEmails++;
          } catch (err) {
            logger.warn(`[scanner] Failed to process email ${msgId}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
      );

      if (i + BATCH < messageIds.length) {
        await sleep(200); // small intra-batch pause
      }
    }

    return { scanned, jobEmails };
  }

  // ─── Private: Single Email Pipeline ───────────────────────────────────────

  /**
   * Processes a single email through the full pipeline.
   * Returns true if the email was classified as job-related.
   * Fully idempotent — safe to call multiple times for the same message.
   */
  private async processEmail(
    gmailMessageId: string,
    options?: { forceRecheckNonJob?: boolean }
  ): Promise<boolean> {
    const forceRecheckNonJob = options?.forceRecheckNonJob === true;
    let email = getEmailByGmailMessageId(gmailMessageId);
    const shouldForceRecheck =
      forceRecheckNonJob && email?.processed_flag === 1 && email.is_job_related === 0;

    // ── Step 1: Ensure metadata exists (lightweight Gmail fetch) ──────────
    if (!email) {
      let parsedMeta: ParsedEmail;
      try {
        parsedMeta = await gmailService.fetchMessageMetadata(gmailMessageId);
      } catch (err) {
        logger.warn(`[scanner] Could not fetch Gmail metadata ${gmailMessageId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }

      email = upsertEmail({
        gmail_message_id: parsedMeta.gmailMessageId,
        thread_id: parsedMeta.threadId,
        subject: parsedMeta.subject,
        snippet: parsedMeta.snippet,
        from_address: parsedMeta.fromAddress,
        from_name: parsedMeta.fromName,
        received_at: parsedMeta.receivedAt,
        raw_payload_json: parsedMeta.rawPayloadJson,
        full_body_fetched: 0,
      });
    }

    let subject = email.subject;
    let snippet = email.snippet;
    let fromAddress = email.from_address;
    let fromName = email.from_name;
    let receivedAt = email.received_at;
    let bodyText = email.body_text;

    // Deterministic sender-level exclusion for known non-relevant sources.
    if (this.isExplicitNonJobSender(fromAddress)) {
      const confidence = 1;
      markEmailInitialClassification(email.id, false, confidence);
      markEmailFinalClassification(email.id, false, confidence);
      markEmailProcessed(email.id);
      logger.info('[scanner] Ignoring email from explicitly non-job sender', {
        gmailMessageId,
        fromAddress,
      });
      return false;
    }

    if (email.processed_flag === 1 && !shouldForceRecheck) {
      logger.debug(`[scanner] Skipping already-processed email: ${gmailMessageId}`);
      return email.is_job_related === 1;
    }

    // ── Step 2: Initial snippet classification (cached if already done) ───
    let initialIsJobRelated = email.initial_is_job_related === 1;
    let initialConfidence = email.initial_classification_confidence ?? null;
    const shouldRecomputeInitial = forceRecheckNonJob && email.initial_is_job_related === 0;

    if (email.initial_is_job_related == null || initialConfidence == null || shouldRecomputeInitial) {
      try {
        const initial = await openAIService.classifySnippet(subject, snippet, fromAddress);
        initialIsJobRelated = initial.isJobRelated;
        initialConfidence = initial.confidence;
        markEmailInitialClassification(email.id, initialIsJobRelated, initialConfidence);
      } catch (err) {
        logger.warn(`[scanner] Snippet classification failed for ${gmailMessageId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }

    // Clear non-job mails end here (no deep-fetch)
    if (!initialIsJobRelated && !forceRecheckNonJob) {
      markEmailFinalClassification(email.id, false, initialConfidence ?? 0);
      markEmailProcessed(email.id);
      return false;
    }

    if (this.isLikelyNonEmployerEmail(subject, snippet, null, fromAddress)) {
      this.markEmailAsNonJob(email.id, Math.max(initialConfidence ?? 0.8, 0.8));
      logger.info('[scanner] Suppressed likely non-employer email at snippet stage', {
        gmailMessageId,
        fromAddress,
        subject,
      });
      return false;
    }

    // ── Step 3: Fetch full payload once (idempotent) ──────────────────────
    if (email.full_body_fetched !== 1) {
      let parsedFull: ParsedEmail;
      try {
        parsedFull = await gmailService.fetchMessage(gmailMessageId);
      } catch (err) {
        logger.warn(`[scanner] Could not fetch full Gmail message ${gmailMessageId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }

      email = upsertEmail({
        gmail_message_id: parsedFull.gmailMessageId,
        thread_id: parsedFull.threadId,
        subject: parsedFull.subject,
        snippet: parsedFull.snippet,
        from_address: parsedFull.fromAddress,
        from_name: parsedFull.fromName,
        received_at: parsedFull.receivedAt,
        body_text: parsedFull.bodyText,
        raw_payload_json: parsedFull.rawPayloadJson,
        full_body_fetched: 1,
      });

      subject = email.subject;
      snippet = email.snippet;
      fromAddress = email.from_address;
      fromName = email.from_name;
      receivedAt = email.received_at;
      bodyText = email.body_text;
    }

    // ── Step 4: Authoritative full-content classification ─────────────────
    let isJobRelated = email.is_job_related === 1;
    let finalConfidence = email.final_classification_confidence ?? null;
    const shouldRecomputeFinal = forceRecheckNonJob && email.is_job_related === 0;

    if (email.is_job_related == null || finalConfidence == null || shouldRecomputeFinal) {
      try {
        const fullClassification = await openAIService.classifyFullContent({
          subject,
          snippet,
          fromAddress,
          fromName,
          bodyText,
        });
        isJobRelated = fullClassification.isJobRelated;
        finalConfidence = fullClassification.confidence;
        markEmailFinalClassification(email.id, isJobRelated, finalConfidence);
      } catch (err) {
        logger.warn(`[scanner] Full-content classification failed for ${gmailMessageId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }

    if (!isJobRelated) {
      markEmailProcessed(email.id);
      return false;
    }

    if (this.isLikelyNonEmployerEmail(subject, snippet, bodyText, fromAddress)) {
      this.markEmailAsNonJob(email.id, Math.max(finalConfidence ?? 0.8, 0.8));
      logger.info('[scanner] Suppressed likely non-employer email at full-content stage', {
        gmailMessageId,
        fromAddress,
        subject,
      });
      return false;
    }

    // If extraction already persisted from a previous attempt, just finalize.
    if (jobInteractionExistsForEmail(email.id)) {
      markEmailProcessed(email.id);
      return true;
    }

    // ── Step 5: Extract structured data from full content ─────────────────
    let extraction;
    try {
      extraction = await openAIService.extract({
        subject,
        fromAddress,
        fromName,
        snippet,
        bodyText,
      });
    } catch (err) {
      logger.warn(`[scanner] Extraction failed for ${gmailMessageId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Keep processed_flag=0 so only deep stage can retry next run.
      return true;
    }

    // ── Step 6: Find or create company ────────────────────────────────────
    const company = companyService.findOrCreate(
      extraction,
      fromAddress,
      receivedAt ?? null
    );

    // ── Step 7: Kick off logo resolution (background) ─────────────────────
    if (company.domain && !company.logo_url) {
      logoService
        .resolveForCompany(company.id, company.domain)
        .catch(() => {});
    }

    // ── Step 8: Create job interaction ────────────────────────────────────
    createJobInteraction({
      company_id: company.id,
      email_id: email.id,
      role: extraction.jobRole,
      status: extraction.status,
      extracted_confidence: extraction.confidence,
      raw_extraction_json: JSON.stringify(extraction),
    });

    // ── Step 9: Refresh company status ────────────────────────────────────
    companyService.refreshCompanyStatus(
      company.id,
      extraction.status,
      receivedAt ?? new Date().toISOString()
    );

    // ── Step 10: Mark done ────────────────────────────────────────────────
    markEmailProcessed(email.id);

    logger.debug(`[scanner] Processed job email`, {
      messageId: gmailMessageId,
      company: company.name,
      status: extraction.status,
      confidence: extraction.confidence,
    });

    return true;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private isExplicitNonJobSender(fromAddress: string | null): boolean {
    const emailAddress = this.extractEmailAddress(fromAddress);
    if (!emailAddress) return false;
    if (EXPLICIT_NON_JOB_SENDERS.has(emailAddress)) return true;

    const domain = this.extractDomain(emailAddress);
    if (!domain) return false;

    for (const blockedDomain of EXPLICIT_NON_JOB_DOMAINS) {
      if (domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)) {
        return true;
      }
    }

    return false;
  }

  private isLikelyNonEmployerEmail(
    subject: string | null,
    snippet: string | null,
    bodyText: string | null,
    fromAddress: string | null
  ): boolean {
    const text = [subject, snippet, (bodyText ?? '').slice(0, 3_000), fromAddress]
      .filter((value): value is string => !!value && value.trim().length > 0)
      .join('\n')
      .toLowerCase();

    if (!text) return false;

    const hasNonEmployerMarkers = NON_EMPLOYER_CONTENT_MARKERS.some((marker) =>
      text.includes(marker)
    );
    if (!hasNonEmployerMarkers) return false;

    const hasEmployerProcessSignals = EMPLOYER_PROCESS_MARKERS.some((marker) =>
      text.includes(marker)
    );
    return !hasEmployerProcessSignals;
  }

  private markEmailAsNonJob(emailId: number, confidence: number): void {
    markEmailInitialClassification(emailId, false, confidence);
    markEmailFinalClassification(emailId, false, confidence);
    markEmailProcessed(emailId);
  }

  private extractEmailAddress(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    const emailMatch = normalized.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    return emailMatch ? emailMatch[0] : normalized;
  }

  private extractDomain(value: string | null): string | null {
    if (!value) return null;
    const atIndex = value.lastIndexOf('@');
    if (atIndex === -1) return null;
    return value.slice(atIndex + 1).toLowerCase();
  }

  private async completeHistoricalScan(
    scanRunId: number,
    emailsScanned: number,
    jobEmailsDetected: number
  ): Promise<void> {
    const now = new Date().toISOString();
    updateSyncState({
      history_scan_completed: 1,
      last_scanned_after: now,
      last_page_token: null,
    });
    updateScanRun(scanRunId, {
      status: 'completed',
      finished_at: now,
      emails_scanned: emailsScanned,
      job_emails_detected: jobEmailsDetected,
    });
    logger.info(`[scanner] Historical scan completed`, { emailsScanned, jobEmailsDetected });
  }

  /** Convert ISO datetime to Gmail "after:YYYY/MM/DD" format */
  private toGmailDate(iso: string): string {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
}

export const scannerService = new ScannerService();

function parseCsvSet(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

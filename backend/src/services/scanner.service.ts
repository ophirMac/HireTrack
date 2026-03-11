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
  emailProcessed,
  markEmailClassified,
  markEmailProcessed,
  createJobInteraction,
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
      logger.error('[scanner] Historical scan failed', { error: msg });
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

    try {
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

        const { scanned, jobEmails } = await this.processMessageIds(
          page.messageIds,
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
      logger.error('[scanner] Incremental scan failed', { error: msg });
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

  // ─── Private: Batch Processing ─────────────────────────────────────────────

  private async processMessageIds(
    messageIds: string[],
    _scanRunId: number
  ): Promise<{ scanned: number; jobEmails: number }> {
    let scanned = 0;
    let jobEmails = 0;

    const BATCH = 10; // fetch 10 messages in parallel to balance speed vs. rate limits

    for (let i = 0; i < messageIds.length; i += BATCH) {
      const batch = messageIds.slice(i, i + BATCH);

      await Promise.all(
        batch.map(async (msgId) => {
          try {
            const isJob = await this.processEmail(msgId);
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
  private async processEmail(gmailMessageId: string): Promise<boolean> {
    // ── Idempotency guard ──────────────────────────────────────────────────
    if (emailProcessed(gmailMessageId)) {
      logger.debug(`[scanner] Skipping already-processed email: ${gmailMessageId}`);
      return false;
    }

    // ── Step 1: Fetch from Gmail ───────────────────────────────────────────
    let parsed: ParsedEmail;
    try {
      parsed = await gmailService.fetchMessage(gmailMessageId);
    } catch (err) {
      logger.warn(`[scanner] Could not fetch Gmail message ${gmailMessageId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    // ── Step 2: Store raw email ────────────────────────────────────────────
    const email = upsertEmail({
      gmail_message_id: parsed.gmailMessageId,
      thread_id: parsed.threadId,
      subject: parsed.subject,
      snippet: parsed.snippet,
      from_address: parsed.fromAddress,
      from_name: parsed.fromName,
      received_at: parsed.receivedAt,
      raw_payload_json: parsed.rawPayloadJson,
    });

    // ── Step 3: Classify ───────────────────────────────────────────────────
    let isJobRelated: boolean;
    try {
      isJobRelated = await openAIService.classify(
        parsed.subject,
        parsed.snippet,
        parsed.fromAddress
      );
    } catch (err) {
      logger.warn(`[scanner] Classification failed for ${gmailMessageId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Mark as processed to avoid infinite retries on bad emails
      markEmailProcessed(email.id);
      return false;
    }

    markEmailClassified(email.id, isJobRelated);

    if (!isJobRelated) {
      markEmailProcessed(email.id);
      return false;
    }

    // ── Step 4: Extract structured data ───────────────────────────────────
    let extraction;
    try {
      extraction = await openAIService.extract({
        subject: parsed.subject,
        fromAddress: parsed.fromAddress,
        fromName: parsed.fromName,
        snippet: parsed.snippet,
        bodyText: parsed.bodyText,
      });
    } catch (err) {
      logger.warn(`[scanner] Extraction failed for ${gmailMessageId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      markEmailProcessed(email.id);
      return true; // still job-related even if extraction failed
    }

    // ── Step 5: Find or create company ────────────────────────────────────
    const company = companyService.findOrCreate(extraction, parsed.fromAddress);

    // ── Step 6: Kick off logo resolution (background) ─────────────────────
    if (company.domain && !company.logo_url) {
      logoService
        .resolveForCompany(company.id, company.domain)
        .catch(() => {});
    }

    // ── Step 7: Create job interaction ────────────────────────────────────
    createJobInteraction({
      company_id: company.id,
      email_id: email.id,
      role: extraction.jobRole,
      status: extraction.status,
      extracted_confidence: extraction.confidence,
      raw_extraction_json: JSON.stringify(extraction),
    });

    // ── Step 8: Refresh company status ────────────────────────────────────
    companyService.refreshCompanyStatus(
      company.id,
      extraction.status,
      parsed.receivedAt ?? new Date().toISOString()
    );

    // ── Step 9: Mark done ─────────────────────────────────────────────────
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

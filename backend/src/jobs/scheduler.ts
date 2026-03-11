/**
 * Scheduler
 *
 * Manages two scan jobs:
 *
 *  1. Startup check (runs once when server starts):
 *     - If historical scan NOT complete → start historical scan
 *     - If historical scan IS complete  → run incremental scan to catch up
 *
 *  2. Daily incremental scan (cron: every 24h at 06:00 local):
 *     - Runs only after historical scan is done
 *     - Guards against duplicate concurrent executions
 *
 * Safety guarantees:
 *  - scannerService.isCurrentlyRunning() prevents overlapping runs
 *  - cron job logs and swallows errors (server stays up)
 */

import cron from 'node-cron';
import { getSyncState } from '../db';
import { scannerService } from '../services/scanner.service';
import { gmailService } from '../services/gmail.service';
import { logger } from '../utils/logger';

export function startScheduler(): void {
  // ── Startup scan ────────────────────────────────────────────────────────
  // Defer slightly to let the HTTP server finish booting
  setTimeout(async () => {
    if (!gmailService.isAuthenticated()) {
      logger.warn('[scheduler] Gmail not authenticated — skipping startup scan');
      logger.warn('[scheduler] Complete OAuth at http://localhost:3001/auth/google');
      return;
    }

    try {
      gmailService.loadTokens();
      const state = getSyncState();

      if (!state.history_scan_completed) {
        logger.info('[scheduler] Starting historical scan on boot');
        scannerService.runHistoricalScan().catch((err) => {
          logger.error('[scheduler] Historical scan threw uncaught error', { error: String(err) });
        });
      } else {
        logger.info('[scheduler] Historical complete — running catch-up incremental scan');
        scannerService.runIncrementalScan().catch((err) => {
          logger.error('[scheduler] Catch-up incremental scan threw', { error: String(err) });
        });
      }
    } catch (err) {
      logger.error('[scheduler] Startup scan failed to initialize', { error: String(err) });
    }
  }, 3_000);

  // ── Daily incremental scan — 06:00 every day ────────────────────────────
  cron.schedule(
    '0 6 * * *',
    async () => {
      logger.info('[scheduler] Daily incremental scan triggered by cron');

      if (!gmailService.isAuthenticated()) {
        logger.warn('[scheduler] Gmail not authenticated — skipping daily scan');
        return;
      }

      const state = getSyncState();
      if (!state.history_scan_completed) {
        logger.warn('[scheduler] Historical scan still in progress — skipping daily cron');
        return;
      }

      if (scannerService.isCurrentlyRunning()) {
        logger.warn('[scheduler] Scan already running — skipping daily cron overlap');
        return;
      }

      try {
        gmailService.loadTokens();
        await scannerService.runIncrementalScan();
      } catch (err) {
        logger.error('[scheduler] Daily cron scan failed', { error: String(err) });
      }
    },
    { timezone: 'America/New_York' }
  );

  logger.info('[scheduler] Scheduler initialized — daily scan cron at 06:00');
}

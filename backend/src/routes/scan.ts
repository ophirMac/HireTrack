import { Router, Request, Response } from 'express';
import {
  getSyncState,
  getActiveScanRun,
  listScanRuns,
} from '../db';
import { scannerService } from '../services/scanner.service';
import { gmailService } from '../services/gmail.service';
import { openAIService } from '../services/openai.service';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/scan/status — full scan dashboard data
router.get('/status', (_req: Request, res: Response) => {
  const syncState = getSyncState();
  const activeRun = getActiveScanRun();
  const recentRuns = listScanRuns(20);

  // Compute progress percentage for historical scan
  let progressPercent: number | null = null;
  if (!syncState.history_scan_completed && syncState.total_estimated_emails > 0) {
    progressPercent = Math.min(
      100,
      Math.round(
        (syncState.total_processed_emails / syncState.total_estimated_emails) * 100
      )
    );
  } else if (syncState.history_scan_completed) {
    progressPercent = 100;
  }

  res.json({
    syncState,
    activeRun: activeRun ?? null,
    progressPercent,
    isRunning: scannerService.isCurrentlyRunning(),
    recentRuns,
  });
});

// POST /api/scan/trigger — manually trigger an incremental scan
router.post('/trigger', async (_req: Request, res: Response) => {
  if (!openAIService.isConfigured()) {
    res.status(503).json({
      error: 'OpenAI is not configured. Set OPENAI_API_KEY to enable scanning.',
    });
    return;
  }

  if (scannerService.isCurrentlyRunning()) {
    res.status(409).json({ error: 'Scan already in progress' });
    return;
  }

  if (!gmailService.isAuthenticated()) {
    res.status(403).json({ error: 'Gmail not authenticated. Complete OAuth first.' });
    return;
  }

  try {
    gmailService.loadTokens();
  } catch (err) {
    res.status(500).json({ error: 'Failed to load Gmail tokens' });
    return;
  }

  const syncState = getSyncState();

  if (!syncState.history_scan_completed) {
    // Queue historical scan
    scannerService.runHistoricalScan().catch((err) => {
      logger.error('[scan/trigger] Historical scan error', { error: String(err) });
    });
    res.json({ message: 'Historical scan started' });
  } else {
    // Queue incremental scan
    scannerService.runIncrementalScan().catch((err) => {
      logger.error('[scan/trigger] Incremental scan error', { error: String(err) });
    });
    res.json({ message: 'Incremental scan started' });
  }
});

// GET /api/scan/runs — paginated scan run history
router.get('/runs', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 100);
  const runs = listScanRuns(limit);
  res.json({ runs });
});

export default router;

import { Router, Request, Response } from 'express';
import { gmailService } from '../services/gmail.service';
import { logger } from '../utils/logger';

const router = Router();

// GET /auth/status — check if OAuth is complete
router.get('/status', (_req: Request, res: Response) => {
  const authenticated = gmailService.isAuthenticated();
  res.json({ authenticated });
});

// GET /auth/google — initiate OAuth2 consent flow
router.get('/google', (_req: Request, res: Response) => {
  const url = gmailService.getAuthUrl();
  res.redirect(url);
});

// GET /auth/callback — OAuth2 redirect handler
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    await gmailService.exchangeCodeForTokens(code);
    logger.info('Gmail OAuth completed successfully');
    // Redirect to frontend success page
    res.redirect(
      `${process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'}?auth=success`
    );
  } catch (err) {
    logger.error('OAuth token exchange failed', { error: String(err) });
    res.redirect(
      `${process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'}?auth=error`
    );
  }
});

export default router;

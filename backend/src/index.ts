import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger';
import { getDb } from './db';
import { startScheduler } from './jobs/scheduler';
import authRouter from './routes/auth';
import companiesRouter from './routes/companies';
import scanRouter from './routes/scan';
import leadsRouter from './routes/leads';
import { errorHandler, notFoundHandler } from './middleware/error';
import { openAIService } from './services/openai.service';
import { BACKEND_PUBLIC_URL, FRONTEND_ORIGIN, PORT } from './config/env';

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/scan', scanRouter);
app.use('/api/leads', leadsRouter);

// ─── Error Handling ───────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Boot ──────────────────────────────────────────────────────────────────────

function main(): void {
  if (!openAIService.isConfigured()) {
    logger.warn('OPENAI_API_KEY is not set — scan jobs are disabled until configured');
  }

  // Initialize database (creates schema if missing)
  getDb();

  app.listen(PORT, () => {
    logger.info(`HireTrack backend running on ${BACKEND_PUBLIC_URL}`);
    logger.info(`Frontend expected at ${FRONTEND_ORIGIN}`);
    logger.info(`OAuth endpoint: ${BACKEND_PUBLIC_URL}/auth/google`);

    // Start scan scheduler
    startScheduler();
  });
}

main();

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

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';

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
  // Initialize database (creates schema if missing)
  getDb();

  app.listen(PORT, () => {
    logger.info(`HireTrack backend running on http://localhost:${PORT}`);
    logger.info(`Frontend expected at ${FRONTEND_ORIGIN}`);
    logger.info(`OAuth endpoint: http://localhost:${PORT}/auth/google`);

    // Start scan scheduler
    startScheduler();
  });
}

main();

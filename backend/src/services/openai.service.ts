/**
 * OpenAIService
 *
 * Two-stage pipeline:
 *  1. classify()  — lightweight check: is this email job-related?
 *  2. extract()   — structured extraction of company/role/status from a job email
 *
 * Both operations use gpt-4o-mini with JSON response format for determinism
 * and low latency. All calls are retried on transient errors and time-boxed.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { withRetry, withTimeout, isTransientError } from '../utils/retry';

export type ApplicationStatus =
  | 'applied'
  | 'confirmation'
  | 'recruiter_reachout'
  | 'interview'
  | 'assignment'
  | 'rejection'
  | 'offer'
  | 'unknown';

export interface ExtractionResult {
  companyName: string | null;
  companyDomain: string | null;
  jobRole: string | null;
  status: ApplicationStatus;
  confidence: number; // 0.0–1.0
}

const ALLOWED_STATUSES: ApplicationStatus[] = [
  'applied',
  'confirmation',
  'recruiter_reachout',
  'interview',
  'assignment',
  'rejection',
  'offer',
  'unknown',
];

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  // ─── Classification ────────────────────────────────────────────────────────

  /**
   * Returns true if the email appears to be a job application-related message.
   * Uses a very cheap / fast prompt — we run this on EVERY email.
   */
  async classify(
    subject: string | null,
    snippet: string | null,
    fromAddress: string | null
  ): Promise<boolean> {
    const prompt = `You are a classifier that detects job-application-related emails.

Consider an email job-related if it involves:
- Job applications (submitted, accepted, rejected)
- Recruiter outreach or sourcing messages
- Interview scheduling or confirmation
- Take-home assignments or coding challenges
- Offer letters or negotiations
- Application status updates from an employer or ATS system

Input:
From: ${fromAddress ?? 'unknown'}
Subject: ${subject ?? '(no subject)'}
Snippet: ${snippet ?? '(empty)'}

Respond with JSON only: {"is_job_related": true} or {"is_job_related": false}
No explanation.`;

    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            this.client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 30,
              temperature: 0,
            }),
          12_000,
          'openai.classify'
        );

        const raw = response.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as { is_job_related?: boolean };
        return parsed.is_job_related === true;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1_500,
        shouldRetry: isTransientError,
        context: 'openai.classify',
      }
    );
  }

  // ─── Extraction ────────────────────────────────────────────────────────────

  /**
   * Extracts structured job-application data from a confirmed job-related email.
   * Uses the full email body if available; falls back to subject + snippet.
   */
  async extract(params: {
    subject: string | null;
    fromAddress: string | null;
    fromName: string | null;
    snippet: string | null;
    bodyText: string | null;
  }): Promise<ExtractionResult> {
    // Truncate body to ~2000 chars to stay within token budget cost-effectively
    const bodyPreview = (params.bodyText ?? params.snippet ?? '').slice(0, 2_000);

    const prompt = `You are an AI that extracts structured data from job-application emails.

Analyze this email and return a JSON object with exactly these fields:
- company_name: string | null — employer company name
- company_domain: string | null — company website domain (e.g. "google.com"), infer from sender domain if possible
- job_role: string | null — the position/role title (e.g. "Senior Software Engineer")
- status: one of exactly: "applied" | "confirmation" | "recruiter_reachout" | "interview" | "assignment" | "rejection" | "offer" | "unknown"
- confidence: number 0.0–1.0 — your confidence in the extraction

Status definitions:
- applied: You submitted an application
- confirmation: Application received/acknowledged by employer
- recruiter_reachout: A recruiter messaged you proactively (cold outreach)
- interview: Interview scheduled or conducted
- assignment: Take-home test, coding challenge, or work assignment
- rejection: Application was declined
- offer: Job offer extended
- unknown: Cannot determine context

Email data:
From: ${params.fromAddress ?? 'unknown'} (${params.fromName ?? 'unknown'})
Subject: ${params.subject ?? '(no subject)'}
Body:
${bodyPreview}

Return JSON only. No explanation.`;

    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            this.client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 200,
              temperature: 0,
            }),
          20_000,
          'openai.extract'
        );

        const raw = response.choices[0]?.message?.content ?? '{}';
        return this.parseExtraction(raw);
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2_000,
        shouldRetry: isTransientError,
        context: 'openai.extract',
      }
    );
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private parseExtraction(raw: string): ExtractionResult {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const status = ALLOWED_STATUSES.includes(parsed.status as ApplicationStatus)
        ? (parsed.status as ApplicationStatus)
        : 'unknown';

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;

      return {
        companyName: typeof parsed.company_name === 'string' ? parsed.company_name : null,
        companyDomain: this.normalizeDomain(
          typeof parsed.company_domain === 'string' ? parsed.company_domain : null
        ),
        jobRole: typeof parsed.job_role === 'string' ? parsed.job_role : null,
        status,
        confidence,
      };
    } catch (err) {
      logger.warn('Failed to parse OpenAI extraction response', { raw, error: String(err) });
      return {
        companyName: null,
        companyDomain: null,
        jobRole: null,
        status: 'unknown',
        confidence: 0,
      };
    }
  }

  private normalizeDomain(raw: string | null): string | null {
    if (!raw) return null;
    try {
      // Strip protocol/path, lowercase
      const cleaned = raw
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase()
        .trim();
      // Basic validation: contains a dot, no spaces
      if (cleaned.includes('.') && !cleaned.includes(' ') && cleaned.length < 253) {
        return cleaned;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export const openAIService = new OpenAIService();

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
  | 'rejected'
  | 'offer';

export interface ExtractionResult {
  companyName: string | null;
  companyDomain: string | null;
  jobRole: string | null;
  status: ApplicationStatus;
  confidence: number; // 0.0–1.0
}

export interface ClassificationResult {
  isJobRelated: boolean;
  confidence: number; // 0.0–1.0
}

const ALLOWED_STATUSES: ApplicationStatus[] = [
  'applied',
  'offer',
  'rejected',
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

  /** Lightweight stage-1 classification using metadata + snippet only. */
  async classifySnippet(
    subject: string | null,
    snippet: string | null,
    fromAddress: string | null
  ): Promise<ClassificationResult> {
    const prompt = `You are a strict classifier for HireTrack.

Classify as job-related ONLY if this is a direct interaction about a real candidacy with a specific employer
(or an ATS email clearly sent on behalf of a specific employer).

Classify as NOT job-related for:
- Job alerts, job matches, digests, newsletters, or recommended jobs
- Emails from job-search tools/automation platforms about account setup, auto-apply activity, or generic progress
- Resume/CV/cover-letter tooling, coaching, billing, or marketing
- Generic account verification/welcome/password-reset messages without employer-specific candidacy context

Input:
From: ${fromAddress ?? 'unknown'}
Subject: ${subject ?? '(no subject)'}
Snippet: ${snippet ?? '(empty)'}

Respond with JSON only and exactly these fields:
{"is_job_related": true|false, "confidence": 0.0-1.0}

Confidence should reflect certainty from snippet-only evidence.
No explanation.`;

    return this.runClassification(prompt, 'openai.classifySnippet');
  }

  /** Stage-2 classification using complete content (authoritative). */
  async classifyFullContent(params: {
    subject: string | null;
    snippet: string | null;
    fromAddress: string | null;
    fromName: string | null;
    bodyText: string | null;
  }): Promise<ClassificationResult> {
    const bodyPreview = (params.bodyText ?? '').slice(0, 4_000);

    const prompt = `You are a strict classifier for HireTrack.

Decide whether this email is job-related using complete content.
Classify as job-related ONLY if this is a direct interaction about a real candidacy with a specific employer
(or an ATS email clearly sent on behalf of that employer).

Classify as NOT job-related for:
- Job alerts, job matches, digests, newsletters, or recommended jobs
- Emails from job-search tools/automation platforms about account setup, auto-apply activity, or generic progress
- Resume/CV/cover-letter tooling, coaching, billing, or marketing
- Generic account verification/welcome/password-reset messages without employer-specific candidacy context

Input:
From: ${params.fromAddress ?? 'unknown'} (${params.fromName ?? 'unknown'})
Subject: ${params.subject ?? '(no subject)'}
Snippet: ${params.snippet ?? '(empty)'}
Body:
${bodyPreview || '(empty)'}

Respond with JSON only and exactly these fields:
{"is_job_related": true|false, "confidence": 0.0-1.0}
No explanation.`;

    return this.runClassification(prompt, 'openai.classifyFullContent');
  }

  private async runClassification(
    prompt: string,
    context: string
  ): Promise<ClassificationResult> {
    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            this.client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 60,
              temperature: 0,
            }),
          12_000,
          context
        );

        const raw = response.choices[0]?.message?.content ?? '{}';
        return this.parseClassification(raw);
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1_500,
        shouldRetry: isTransientError,
        context,
      }
    );
  }

  private parseClassification(raw: string): ClassificationResult {
    try {
      const parsed = JSON.parse(raw) as { is_job_related?: boolean; confidence?: unknown };
      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;
      return {
        isJobRelated: parsed.is_job_related === true,
        confidence,
      };
    } catch (err) {
      logger.warn('Failed to parse OpenAI classification response', { raw, error: String(err) });
      return { isJobRelated: false, confidence: 0 };
    }
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
- status: one of exactly: "applied" | "rejected" | "offer"
- confidence: number 0.0–1.0 — your confidence in the extraction

Status definitions:
- applied: Any non-final application stage (submission, confirmation, recruiter email, interview, assignment, or unclear progress)
- rejected: Application was declined
- offer: Job offer extended

Important rules:
- The employer must be the hiring company, not the platform/tool sending the email.
- Never use a job-search platform (e.g. AIApply, LinkedIn, Indeed) as employer unless the email clearly says the job is at that platform.
- If the real hiring company is unknown, set company_name and company_domain to null.
- If role title is missing, set job_role to null.
- If employer identity is unknown or the email looks like platform/marketing automation, keep confidence <= 0.4.

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

      const normalizedStatus = this.normalizeStatus(parsed.status);
      const status = ALLOWED_STATUSES.includes(normalizedStatus)
        ? normalizedStatus
        : 'applied';

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
        status: 'applied',
        confidence: 0,
      };
    }
  }

  private normalizeStatus(raw: unknown): ApplicationStatus {
    const status = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (status.includes('offer')) return 'offer';
    if (status.includes('reject') || status.includes('declin')) return 'rejected';
    return 'applied';
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

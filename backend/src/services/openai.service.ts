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

export interface JobPageExtractionResult {
  companyName: string;
  role: string;
}

export interface LinkedInProfileExtractionResult {
  name: string;
  role: string;
  bio: string;
  warning?: string;
}

export class OpenAIService {
  private client: OpenAI | null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    return this.client;
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
    const client = this.getClient();

    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            client.chat.completions.create({
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
    const client = this.getClient();

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
            client.chat.completions.create({
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

  // ─── Job Page Extraction ─────────────────────────────────────────────────

  /**
   * Uses AI to extract company name and job role from a job listing page's HTML content.
   */
  async extractFromJobPage(html: string, url: string): Promise<JobPageExtractionResult> {
    const client = this.getClient();

    // Extract useful text: title, meta tags, and first chunk of visible text
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Extract meta tags (og:title, og:site_name, description, etc.)
    const metaTags: string[] = [];
    const metaRegex = /<meta\s+[^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*/gi;
    const metaRegex2 = /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*/gi;
    let m;
    while ((m = metaRegex.exec(html)) !== null) {
      metaTags.push(`${m[1]}: ${m[2]}`);
    }
    while ((m = metaRegex2.exec(html)) !== null) {
      metaTags.push(`${m[2]}: ${m[1]}`);
    }

    // Strip HTML tags to get visible text, take first ~3000 chars
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    const prompt = `You are extracting job listing info from a webpage.

URL: ${url}
Page title: ${title}
Meta tags:
${metaTags.slice(0, 20).join('\n')}

Page text (first 3000 chars):
${textContent}

Extract the following from this job listing page:
1. company_name — The name of the hiring company (NOT the job board like LinkedIn, Indeed, Glassdoor)
2. role — The job title/position being advertised

Return JSON only with exactly these fields:
{"company_name": "...", "role": "..."}

Rules:
- If the page is from a job board (LinkedIn, Indeed, etc.), the company is the one hiring, not the job board itself.
- Use the official company name, not abbreviations.
- Use the exact job title as listed.
- If you can't determine one of the fields, use an empty string "".
No explanation.`;

    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 150,
              temperature: 0,
            }),
          15_000,
          'openai.extractFromJobPage'
        );

        const raw = response.choices[0]?.message?.content ?? '{}';
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return {
            companyName: typeof parsed.company_name === 'string' ? parsed.company_name : '',
            role: typeof parsed.role === 'string' ? parsed.role : '',
          };
        } catch {
          logger.warn('Failed to parse job page extraction', { raw });
          return { companyName: '', role: '' };
        }
      },
      {
        maxAttempts: 2,
        initialDelayMs: 1_000,
        shouldRetry: isTransientError,
        context: 'openai.extractFromJobPage',
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

  // ─── LinkedIn Profile Extraction ──────────────────────────────────────────

  /**
   * Extracts a person's name, current role, and a short bio sentence from a
   * LinkedIn profile URL. Works even when LinkedIn returns an authwall page —
   * og:title / og:description / JSON-LD data is still present in those pages.
   */
  async extractFromLinkedIn(
    url: string,
    pageHtml: string | null
  ): Promise<LinkedInProfileExtractionResult> {
    const slugMatch = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
    const slug = slugMatch?.[1] ?? '';

    // ── Helper: extract a single meta tag value ──
    const getMeta = (html: string, ...props: string[]): string => {
      for (const prop of props) {
        const re = new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
          'i'
        );
        const m = re.exec(html) ||
          new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
            'i'
          ).exec(html);
        if (m) return m[1].trim();
      }
      return '';
    };

    // ── Helper: extract JSON-LD Person block ──
    const getJsonLd = (html: string): string => {
      const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      const chunks: string[] = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        const t = m[1].trim();
        if (/"@type"\s*:\s*"Person"/i.test(t)) chunks.push(t.slice(0, 800));
      }
      return chunks.join('\n').slice(0, 1200);
    };

    // ── Collect all signals from whatever HTML we got ──
    let signals = '';
    if (pageHtml) {
      const titleTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(pageHtml) ?? [])[1]
        ?.replace(/\s+/g, ' ')
        .trim() ?? '';
      const ogTitle       = getMeta(pageHtml, 'og:title');
      const ogDescription = getMeta(pageHtml, 'og:description');
      const twitterTitle  = getMeta(pageHtml, 'twitter:title');
      const twitterDesc   = getMeta(pageHtml, 'twitter:description');
      const description   = getMeta(pageHtml, 'description');
      const jsonLd        = getJsonLd(pageHtml);

      signals = [
        titleTag       && `Page title: ${titleTag}`,
        ogTitle        && `og:title: ${ogTitle}`,
        twitterTitle   && `twitter:title: ${twitterTitle}`,
        ogDescription  && `og:description: ${ogDescription}`,
        twitterDesc    && `twitter:description: ${twitterDesc}`,
        description    && `meta description: ${description}`,
        jsonLd         && `JSON-LD:\n${jsonLd}`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    // ── Use OpenAI if configured ──
    if (this.client && (signals || slug)) {
      const prompt = `You are extracting information about a person from their LinkedIn profile metadata.

LinkedIn URL: ${url}
URL slug: ${slug}

Available page signals:
${signals || '(no page content available — use URL slug only)'}

Extract the following and return JSON with exactly these fields:
- "name": The person's full name (use og:title or JSON-LD "name" field; the format is usually "Full Name - Headline | LinkedIn")
- "role": Their current job title and employer (e.g. "Senior Engineer at Acme Corp"). Look in og:title after the dash, or JSON-LD "jobTitle"/"worksFor".
- "bio": A single short sentence (max 20 words) describing who this person is, written in third person. Derive it from the description/headline. If there is no useful information, return an empty string "".

Rules:
- Strip " | LinkedIn" from the end of titles.
- The part before " - " in og:title is typically the name; the part after is the headline/role.
- Never invent information — only use what is present in the signals.

Return JSON only. No explanation.`;

      try {
        const response = await withTimeout(
          () =>
            this.client!.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 150,
              temperature: 0,
            }),
          12_000,
          'openai.extractFromLinkedIn'
        );

        const raw = response.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        const role = typeof parsed.role === 'string' ? parsed.role.trim() : '';
        const bio  = typeof parsed.bio  === 'string' ? parsed.bio.trim()  : '';
        if (name) {
          return { name, role, bio };
        }
      } catch (err) {
        logger.warn('LinkedIn OpenAI extraction failed, falling back to slug', {
          url,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    // ── Fallback: slug-derived name only ──
    // Only strip suffix if it contains a digit (random LinkedIn IDs like "ab12cd")
    const nameFromSlug = slug
      .replace(/-[a-z0-9]*\d[a-z0-9]*$/i, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    return {
      name: nameFromSlug,
      role: '',
      bio: '',
      warning: 'Could not fetch LinkedIn profile — name inferred from URL. Please verify and add the role manually.',
    };
  }
}

export const openAIService = new OpenAIService();

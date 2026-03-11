/**
 * CompanyService
 *
 * Responsible for intelligent company deduplication and aggregation.
 *
 * Matching strategy (priority order):
 *  1. Exact domain match      — most reliable signal
 *  2. Extracted domain match  — AI-extracted domain
 *  3. Fuzzy name match        — normalized name comparison
 *  4. Create new              — fallback
 *
 * Status progression:
 *  The company's current_status is set to the status of the most
 *  recently-received job email with a non-unknown, non-confirmation status.
 *  If the latest email has a meaningful status, it always wins.
 *
 * This ensures the status accurately reflects the latest state in the
 * hiring pipeline rather than an arbitrary priority ladder.
 */

import {
  Company,
  findCompanyByDomain,
  findCompanyByName,
  createCompany,
  updateCompanyStatus,
  getInteractionsByCompany,
} from '../db';
import { ExtractionResult } from './openai.service';
import { logger } from '../utils/logger';

// Statuses that are meaningful progression signals.
// Everything except 'unknown' and bare 'confirmation' is meaningful.
const MEANINGFUL_STATUSES = new Set([
  'applied',
  'recruiter_reachout',
  'interview',
  'assignment',
  'rejection',
  'offer',
]);

export class CompanyService {
  /**
   * Given extraction results and the sender's email address, finds an existing
   * company or creates a new one.  Returns the resolved company's DB id.
   */
  findOrCreate(
    extraction: ExtractionResult,
    fromAddress: string | null
  ): Company {
    const senderDomain = this.parseDomain(fromAddress);
    const extractedDomain = extraction.companyDomain;

    // ── 1. Try sender domain (most reliable) ──────────────────────────────
    if (senderDomain && !this.isFreemailDomain(senderDomain)) {
      const byDomain = findCompanyByDomain(senderDomain);
      if (byDomain) {
        logger.debug(`Company matched by sender domain: ${senderDomain}`, {
          id: byDomain.id,
        });
        return byDomain;
      }
    }

    // ── 2. Try extracted domain ────────────────────────────────────────────
    if (extractedDomain && extractedDomain !== senderDomain) {
      const byExtracted = findCompanyByDomain(extractedDomain);
      if (byExtracted) {
        logger.debug(`Company matched by extracted domain: ${extractedDomain}`, {
          id: byExtracted.id,
        });
        return byExtracted;
      }
    }

    // ── 3. Fuzzy name match ────────────────────────────────────────────────
    if (extraction.companyName) {
      const byName = findCompanyByName(extraction.companyName);
      if (byName) {
        logger.debug(`Company matched by name: ${extraction.companyName}`, {
          id: byName.id,
        });
        return byName;
      }
    }

    // ── 4. Create new company ──────────────────────────────────────────────
    const resolvedDomain = extractedDomain ?? (
      senderDomain && !this.isFreemailDomain(senderDomain) ? senderDomain : null
    );

    const resolvedName =
      extraction.companyName ??
      this.nameFromDomain(resolvedDomain) ??
      this.nameFromEmail(fromAddress) ??
      'Unknown Company';

    const now = new Date().toISOString();
    const company = createCompany({
      name: resolvedName,
      domain: resolvedDomain,
      current_status: extraction.status,
      first_interaction_at: now,
      last_interaction_at: now,
    });

    logger.info(`Created new company: ${resolvedName}`, {
      id: company.id,
      domain: resolvedDomain,
    });

    return company;
  }

  /**
   * Updates a company's current_status based on the latest interaction's status.
   * Only meaningful statuses override the existing state.
   */
  refreshCompanyStatus(companyId: number, newStatus: string, interactionAt: string): void {
    if (MEANINGFUL_STATUSES.has(newStatus)) {
      updateCompanyStatus(companyId, newStatus, interactionAt);
    } else {
      // Still update last_interaction_at even if status is weak
      updateCompanyStatus(companyId, 'confirmation', interactionAt);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private parseDomain(email: string | null): string | null {
    if (!email) return null;
    const match = email.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
    return match ? match[1].toLowerCase() : null;
  }

  private isFreemailDomain(domain: string): boolean {
    const FREEMAIL = new Set([
      'gmail.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'icloud.com',
      'protonmail.com',
      'mail.com',
      'aol.com',
      'live.com',
      'msn.com',
    ]);
    return FREEMAIL.has(domain);
  }

  private nameFromDomain(domain: string | null): string | null {
    if (!domain) return null;
    // Strip TLD(s) and capitalize first word: "acme.co" → "Acme"
    const parts = domain.split('.');
    const name = parts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return name.length >= 2 ? name : null;
  }

  private nameFromEmail(email: string | null): string | null {
    if (!email) return null;
    const domain = this.parseDomain(email);
    return this.nameFromDomain(domain);
  }
}

export const companyService = new CompanyService();

/**
 * LogoService
 *
 * Resolves company logo URLs through a tiered strategy:
 *  1. SQLite logo_cache lookup (free, instant)
 *  2. logo.dev public CDN (free, reliable, no key required)
 *  3. Clearbit Logo API (free tier, good coverage)
 *  4. Favicon scraping from company homepage
 *  5. null — frontend shows initials avatar
 *
 * Logo resolution is intentionally fire-and-forget: it NEVER blocks
 * the core processing pipeline. Results are cached persistently.
 */

import axios from 'axios';
import { getLogoCache, setLogoCache, updateCompanyLogo } from '../db';
import { logger } from '../utils/logger';

export class LogoService {
  /**
   * Resolves a logo URL for a domain and caches it in the DB.
   * Also updates the company record in the background.
   * Safe to call multiple times — returns cached result immediately.
   */
  async resolveForCompany(companyId: number, domain: string | null): Promise<string | null> {
    if (!domain) return null;

    // Cache hit
    const cached = getLogoCache(domain);
    if (cached !== null) return cached || null;

    // Resolve in background — never await in hot path
    this.resolveAndCache(companyId, domain).catch((err) => {
      logger.debug(`Logo resolution failed for ${domain}`, { error: String(err) });
    });

    return null;
  }

  private async resolveAndCache(companyId: number, domain: string): Promise<void> {
    const logoUrl = await this.resolve(domain);
    setLogoCache(domain, logoUrl ?? ''); // empty string = "tried and failed"
    if (logoUrl) {
      updateCompanyLogo(companyId, logoUrl);
      logger.debug(`Logo resolved for ${domain}`, { url: logoUrl });
    }
  }

  private async resolve(domain: string): Promise<string | null> {
    // Strategy 1: logo.dev CDN (free, no API key)
    const logoDevUrl = `https://img.logo.dev/${domain}?token=pk_public&size=64`;
    if (await this.urlReachable(logoDevUrl)) return logoDevUrl;

    // Strategy 2: Clearbit Logo API
    const clearbitUrl = `https://logo.clearbit.com/${domain}`;
    if (await this.urlReachable(clearbitUrl)) return clearbitUrl;

    // Strategy 3: Favicon
    const faviconUrl = await this.resolveFavicon(domain);
    if (faviconUrl) return faviconUrl;

    return null;
  }

  private async urlReachable(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, {
        timeout: 5_000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { 'User-Agent': 'HireTrack/1.0' },
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private async resolveFavicon(domain: string): Promise<string | null> {
    // Try Google Favicon service as a reliable free fallback
    const googleFavicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    try {
      const res = await axios.head(googleFavicon, {
        timeout: 5_000,
        validateStatus: (s) => s === 200,
        headers: { 'User-Agent': 'HireTrack/1.0' },
      });
      if (res.status === 200) return googleFavicon;
    } catch {
      // ignore
    }
    return null;
  }
}

export const logoService = new LogoService();

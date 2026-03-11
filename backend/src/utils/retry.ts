import { logger } from './logger';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  shouldRetry?: (error: unknown) => boolean;
  context?: string;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (opts.shouldRetry && !opts.shouldRetry(err)) {
        throw err;
      }

      if (attempt === opts.maxAttempts) break;

      const base = opts.initialDelayMs * Math.pow(opts.factor, attempt - 1);
      const jitter = Math.random() * 0.2 * base;
      const delay = Math.min(base + jitter, opts.maxDelayMs);

      logger.warn(
        `[retry] ${opts.context ?? 'operation'} failed (attempt ${attempt}/${opts.maxAttempts}), retrying in ${Math.round(delay)}ms`,
        { error: err instanceof Error ? err.message : String(err) }
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  context = 'operation'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${context} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/** Returns true for transient HTTP/network errors that warrant a retry */
export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const status = (err as { status?: number; statusCode?: number }).status ??
                   (err as { status?: number; statusCode?: number }).statusCode;
    if (status !== undefined) {
      return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
    }
    // Network-level errors
    const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
    const code = (err as { code?: string }).code;
    if (code && networkCodes.includes(code)) return true;
  }
  return false;
}

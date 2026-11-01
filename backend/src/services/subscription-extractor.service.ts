/**
 * SubscriptionExtractor
 *
 * Turns one billing-ish email into a structured subscription event using
 * gpt-4o-mini. Kept separate from the job-search OpenAIService so the two
 * features can evolve independently.
 */
import OpenAI from 'openai';
import { withRetry, withTimeout, isTransientError } from '../utils/retry';
import {
  BILLING_CYCLES,
  CHARGE_EVENTS,
  SUB_CATEGORIES,
  type BillingCycle,
  type ChargeEvent,
  type SubscriptionCategory,
} from '../db/subscriptions';

export interface SubscriptionExtraction {
  is_subscription: boolean;
  event_type: ChargeEvent;
  service_name: string | null;
  plan_name: string | null;
  vendor_domain: string | null;
  category: SubscriptionCategory;
  amount: number | null;
  currency: string | null;
  billing_cycle: BillingCycle;
  occurred_at: string | null;
  next_renewal_at: string | null;
  trial_ends_at: string | null;
  cancel_url: string | null;
  confidence: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

class SubscriptionExtractorService {
  private client: OpenAI | null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async extract(email: {
    subject: string | null;
    fromAddress: string | null;
    fromName: string | null;
    receivedAt: string | null;
    bodyText: string | null;
    snippet: string | null;
  }): Promise<SubscriptionExtraction> {
    if (!this.client) throw new Error('OPENAI_API_KEY is not set');
    const client = this.client;

    const body = (email.bodyText ?? email.snippet ?? '')
      .replace(/[͏​-‍﻿]/g, '') // invisible preheader padding
      .replace(/\s{2,}/g, ' ')
      .slice(0, 5_000);

    const prompt = `You analyze emails to find the user's RECURRING paid subscriptions (SaaS, streaming, cloud storage, memberships, app-store subscriptions, phone plans, etc).

Return JSON with exactly these fields:
- is_subscription: boolean — true ONLY if this email is about a recurring paid subscription/membership the user actually holds (a receipt/charge, renewal notice, trial, price change, failed payment, cancellation or sign-up confirmation). Also true for a one-off add-on purchase that belongs to a subscription the user holds (e.g. "prepaid extra usage" on a plan).
  false for: marketing/promotions/offers ("try X free", "50% off"), newsletters, one-off purchases (food delivery, rides, flights, shop orders, event tickets, single app purchases), bank/card statements, and anything without a real account relationship.
- event_type: one of ${CHARGE_EVENTS.map((e) => `"${e}"`).join(' | ')}
    charge = a payment for the subscription was taken (including the very first one); renewal_notice = upcoming renewal reminder; one_off = one-off add-on tied to a subscription;
    payment_failed = card declined / needs attention / suspended for payment; cancelled = subscription ended/cancelled/expired.
- service_name: the product brand WITHOUT the plan tier, stable across emails (e.g. "Claude", "GitHub Copilot", "iCloud+", "Netflix", "Spotify", "TryHackMe", "Railway", "Google One"). For App Store / Google Play / PayPal / Stripe receipts use the underlying product, never "Apple", "Google Play", "PayPal" or "Stripe".
- plan_name: tier/plan if stated (e.g. "Pro", "200 GB", "Hobby"), else null
- vendor_domain: the product's website domain (e.g. "anthropic.com", "github.com", "icloud.com"), else null
- category: one of ${SUB_CATEGORIES.map((c) => `"${c}"`).join(' | ')}
- amount: number — the recurring price charged/announced in this email (tax included total). For one_off, the add-on amount. null if absent.
- currency: ISO-4217 code ("USD", "ILS" for ₪, "EUR", "GBP", "AUD" for A$ ...). null if absent.
- billing_cycle: one of ${BILLING_CYCLES.map((c) => `"${c}"`).join(' | ')} — infer from "(Monthly)", "/mo", a 1-month service period, "annual", etc.
- occurred_at: ISO date (YYYY-MM-DD) of the payment/event, default to the email date
- next_renewal_at: ISO date of the next renewal/charge if stated or clearly implied by a service period end (e.g. "Oct 29–Nov 29" → "2026-11-29"), else null
- trial_ends_at: ISO date if a free trial end is stated, else null
- cancel_url: a URL for managing/cancelling the subscription if present, else null
- confidence: 0.0-1.0

Email date: ${email.receivedAt ?? 'unknown'}
From: ${email.fromName ?? ''} <${email.fromAddress ?? 'unknown'}>
Subject: ${email.subject ?? '(no subject)'}
Body:
${body || '(empty)'}

JSON only.`;

    return withRetry(
      async () => {
        const response = await withTimeout(
          () =>
            client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              max_tokens: 350,
              temperature: 0,
            }),
          20_000,
          'subscriptions.extract'
        );
        return this.parse(response.choices[0]?.message?.content ?? '{}', email.receivedAt);
      },
      { maxAttempts: 3, initialDelayMs: 2_000, shouldRetry: isTransientError, context: 'subscriptions.extract' }
    );
  }

  private parse(raw: string, receivedAt: string | null): SubscriptionExtraction {
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* fall through with empty object */
    }

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null;
    const date = (v: unknown): string | null => {
      const s = str(v);
      return s && ISO_DATE.test(s) ? s.slice(0, 10) : null;
    };
    const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
      typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

    const amountRaw = typeof p.amount === 'string' ? parseFloat(p.amount.replace(/[^\d.]/g, '')) : p.amount;
    const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw >= 0 ? amountRaw : null;
    const currency = str(p.currency)?.toUpperCase().slice(0, 3) ?? null;
    const domain = str(p.vendor_domain)
      ?.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] ?? null;
    const cancelUrl = str(p.cancel_url);

    return {
      is_subscription: p.is_subscription === true,
      event_type: oneOf(p.event_type, CHARGE_EVENTS, 'other'),
      service_name: str(p.service_name),
      plan_name: str(p.plan_name),
      vendor_domain: domain,
      category: oneOf(p.category, SUB_CATEGORIES, 'other'),
      amount,
      currency,
      billing_cycle: oneOf(p.billing_cycle, BILLING_CYCLES, 'unknown'),
      occurred_at: date(p.occurred_at) ?? (receivedAt ? receivedAt.slice(0, 10) : null),
      next_renewal_at: date(p.next_renewal_at),
      trial_ends_at: date(p.trial_ends_at),
      cancel_url: cancelUrl && /^https?:\/\//.test(cancelUrl) ? cancelUrl : null,
      confidence:
        typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
    };
  }
}

export const subscriptionExtractor = new SubscriptionExtractorService();

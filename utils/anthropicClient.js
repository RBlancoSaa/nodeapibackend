/**
 * utils/anthropicClient.js
 *
 * Centrale Anthropic-client + wrapper voor ALLE Claude-calls in deze backend.
 * Zelfde aanpak als Romy-HQ (lib/ai/anthropic.ts), maar in JS/ESM.
 *
 *   1. Retry met exponential backoff + full jitter bij 429/529/5xx en
 *      verbindingsfouten; respecteert de retry-after header.
 *   2. Client-side throttle: max gelijktijdige calls + max calls/minuut, zodat
 *      we onder de tier-limiet blijven i.p.v. te 429'en.
 *   3. Optioneel: globale RPM-limiet over alle instances heen via Upstash Redis
 *      (REST, dependency-vrij). Deel dezelfde Upstash + ANTHROPIC_GLOBAL_KEY
 *      met de andere apps die dezelfde Anthropic-key gebruiken → één budget.
 *   4. Logging + teller per label, zodat zichtbaar is welk onderdeel de meeste
 *      rate limits raakt.
 *
 * Gebruik:
 *   import { callClaude, withClaude, getAnthropicStats } from '../utils/anthropicClient.js';
 *   const msg = await callClaude('ocr-pdf', { model, max_tokens, messages });
 */

import Anthropic from '@anthropic-ai/sdk';

const envInt = (naam, fallback) => {
  const v = Number(process.env[naam]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const MAX_CONCURRENCY = envInt('ANTHROPIC_MAX_CONCURRENCY', 3);
const MAX_RPM = envInt('ANTHROPIC_MAX_RPM', 40);
const MAX_RETRIES = envInt('ANTHROPIC_MAX_RETRIES', 6);
const BASE_DELAY_MS = envInt('ANTHROPIC_BASE_DELAY_MS', 1000);
const MAX_DELAY_MS = envInt('ANTHROPIC_MAX_DELAY_MS', 30_000);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const GLOBAL_RPM = envInt('ANTHROPIC_GLOBAL_RPM', MAX_RPM);
const GLOBAL_KEY = process.env.ANTHROPIC_GLOBAL_KEY ?? 'anthropic:rpm';

// Wij retryen zelf → SDK-retries uit (geen dubbele retries).
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 0,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ── In-process limiter: concurrency + sliding-window RPM ─────────────────────

class Limiter {
  constructor(maxConcurrency, maxRpm) {
    this.maxConcurrency = maxConcurrency;
    this.maxRpm = maxRpm;
    this.active = 0;
    this.wachtrij = [];
    this.starts = [];
  }

  async acquireSlot() {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.wachtrij.push(resolve));
  }

  releaseSlot() {
    const volgende = this.wachtrij.shift();
    if (volgende) volgende();
    else this.active--;
  }

  async gateRpm() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nu = Date.now();
      this.starts = this.starts.filter((t) => nu - t < 60_000);
      if (this.starts.length < this.maxRpm) {
        this.starts.push(nu);
        return;
      }
      await sleep(60_000 - (nu - this.starts[0]) + 10);
    }
  }
}

const limiter = new Limiter(MAX_CONCURRENCY, MAX_RPM);

async function globalRpmGate() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const venster = Math.floor(now / 60_000);
    const key = `${GLOBAL_KEY}:${venster}`;
    let count = 0;
    try {
      const res = await fetch(`${UPSTASH_URL}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, '70', 'NX'],
        ]),
      });
      if (!res.ok) return; // fail-open
      const data = await res.json();
      count = Number(data?.[0]?.result ?? 0);
    } catch {
      return; // fail-open
    }
    if (count <= GLOBAL_RPM) return;
    await sleep(60_000 - (now % 60_000) + 50);
  }
}

// ── Stats per label ──────────────────────────────────────────────────────────

const stats = new Map();
function statsVoor(label) {
  let s = stats.get(label);
  if (!s) {
    s = { calls: 0, ok: 0, failed: 0, retries: 0, rateLimited: 0 };
    stats.set(label, s);
  }
  return s;
}
export function getAnthropicStats() {
  const out = {};
  stats.forEach((v, k) => {
    out[k] = { ...v };
  });
  return out;
}

// ── Retry-helpers ─────────────────────────────────────────────────────────────

function isRetryable(err) {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (
      status === 408 ||
      status === 409 ||
      status === 429 ||
      status === 529 ||
      (typeof status === 'number' && status >= 500)
    ) {
      return { retry: true, status };
    }
    return { retry: false, status };
  }
  if (
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return { retry: true };
  }
  return { retry: false };
}

function retryAfterMs(err) {
  if (!(err instanceof Anthropic.APIError)) return null;
  const headers = err.headers;
  let raw = null;
  if (headers && typeof headers.get === 'function') {
    raw = headers.get('retry-after');
  } else if (headers && typeof headers === 'object') {
    raw = headers['retry-after'] ?? headers['Retry-After'] ?? null;
  }
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return secs * 1000;
  const datum = Date.parse(raw);
  if (!Number.isNaN(datum)) return Math.max(0, datum - Date.now());
  return null;
}

function backoffMs(attempt) {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

// ── Kern: withClaude / callClaude ─────────────────────────────────────────────

export async function withClaude(label, fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const s = statsVoor(label);
  s.calls++;

  await limiter.acquireSlot();
  try {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await limiter.gateRpm();
      await globalRpmGate();
      try {
        const result = await fn(anthropic);
        s.ok++;
        return result;
      } catch (err) {
        const { retry, status } = isRetryable(err);
        if (status === 429) s.rateLimited++;

        if (!retry || attempt >= maxRetries) {
          s.failed++;
          console.error(
            `[anthropic] ${label} definitief gefaald na ${attempt} retries`,
            { label, status, attempts: attempt + 1, error: err?.message ?? String(err) },
          );
          throw err;
        }

        const ra = retryAfterMs(err);
        const wachtMs = Math.max(ra ?? 0, backoffMs(attempt));
        attempt++;
        s.retries++;
        const fn429 = status === 429 ? console.warn : console.log;
        fn429(
          `[anthropic] ${label} ${status ?? 'conn'} → retry ${attempt}/${maxRetries} over ${wachtMs}ms` +
            (ra != null ? ` (retry-after=${ra}ms)` : '') +
            ` · 429-totaal voor ${label}: ${s.rateLimited}`,
        );
        await sleep(wachtMs);
      }
    }
  } finally {
    limiter.releaseSlot();
  }
}

export async function callClaude(label, params, opts) {
  return withClaude(label, (client) => client.messages.create(params), opts);
}

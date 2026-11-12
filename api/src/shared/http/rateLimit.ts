// api/src/shared/http/rateLimit.ts
//
// Lightweight in-memory, fixed-window rate limiter for a small set of
// sensitive endpoints (login, password reset, email code sending).
//
// No external dependency: the app runs as a single API container, so a
// per-process counter is sufficient. Limits are deliberately generous so
// legitimate users are never affected; they only stop automated abuse
// (brute force, email flooding).
//
// Polling endpoints used by the web client (notifications, activity,
// services) are NOT covered here — only the exact routes listed in RULES.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Bucket = { count: number; resetAt: number };

type Rule = {
  /** Exact request pathname, including the /api prefix. */
  path: string;
  /** HTTP method (upper-case). */
  method: string;
  /** Max requests per window per client IP. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

// Generous limits: well above any real human cadence, low enough to blunt
// automated abuse. Tuneable without touching route handlers.
const RULES: Rule[] = [
  // Login + registration (same route, mode in body).
  { path: "/api/auth/password", method: "POST", max: 20, windowMs: 60_000 },
  // Password reset request (sends an email through SHM).
  { path: "/api/auth/password-reset", method: "POST", max: 5, windowMs: 15 * 60_000 },
  // Password reset confirmation (token guessing).
  { path: "/api/auth/password-reset/confirm", method: "POST", max: 15, windowMs: 15 * 60_000 },
  // Email verification code sending (sends an email through SHM).
  { path: "/api/user/email/send-code", method: "POST", max: 6, windowMs: 10 * 60_000 },
  // Email verification code confirmation (code guessing).
  { path: "/api/user/email/confirm", method: "POST", max: 20, windowMs: 10 * 60_000 },
];

const ruleIndex = new Map<string, Rule>();
for (const r of RULES) ruleIndex.set(`${r.method} ${r.path}`, r);

/**
 * Enabled in production by default; off elsewhere so local dev and the test
 * suite are not throttled. An explicit RATE_LIMIT_ENABLED flag overrides both.
 */
export function rateLimitEnabled(): boolean {
  const v = String(process.env.RATE_LIMIT_ENABLED ?? "").trim().toLowerCase();
  if (v) return v === "1" || v === "true" || v === "on" || v === "yes";
  return process.env.NODE_ENV === "production";
}

// One bucket map per rule key; inner key is the client IP.
const stores = new Map<string, Map<string, Bucket>>();

function storeFor(key: string): Map<string, Bucket> {
  let s = stores.get(key);
  if (!s) {
    s = new Map();
    stores.set(key, s);
  }
  return s;
}

function clientIp(req: FastifyRequest): string {
  // In production trustProxy is enabled, so req.ip reflects the real client
  // via nginx's X-Forwarded-For. Fall back to the socket address otherwise.
  const ip = String(req.ip ?? "").trim();
  if (ip) return ip;
  return String((req.socket as any)?.remoteAddress ?? "unknown");
}

function pathnameOf(req: FastifyRequest): string {
  const raw = String(req.url ?? "");
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

/**
 * Registers a single onRequest hook that enforces the RULES table.
 * Requests to any other route pass through untouched.
 */
export function registerSensitiveRateLimits(app: FastifyInstance): void {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!rateLimitEnabled()) return;
    const rule = ruleIndex.get(`${req.method} ${pathnameOf(req)}`);
    if (!rule) return;

    const now = Date.now();
    const store = storeFor(`${rule.method} ${rule.path}`);
    const ip = clientIp(req);

    let bucket = store.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      store.set(ip, bucket);
    }

    bucket.count += 1;

    if (bucket.count > rule.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header("Retry-After", String(retryAfterSec));
      return reply
        .code(429)
        .send({ ok: false, error: "rate_limited", retry_after_sec: retryAfterSec });
    }

    // Opportunistic cleanup: once a store grows, drop expired IP buckets so
    // memory stays bounded without a background timer.
    if (store.size > 5000) {
      for (const [k, v] of store) {
        if (v.resetAt <= now) store.delete(k);
      }
    }
  });
}

import { resolveMx } from "node:dns/promises";
import bundledDisposableDomains from "../data/disposable-email-domains.json" with { type: "json" };

export type EmailValidationCode =
  | "email_required"
  | "email_invalid_format"
  | "email_local_too_short"
  | "email_local_invalid"
  | "email_domain_invalid"
  | "email_domain_numeric"
  | "email_disposable"
  | "email_domain_unresolvable"
  | "email_check_failed"
  | "email_non_ascii";

export type EmailValidationResult = {
  ok: boolean;
  normalized: string;
  code?: EmailValidationCode;
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASCII_ONLY_RE = /^[\x00-\x7F]+$/;
const LOCAL_ALLOWED_RE = /^[a-z0-9._%+-]+$/i;
const DOMAIN_ALLOWED_RE = /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/i;

const DISPOSABLE_DOMAINS = new Set([
  "10mail.org",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "10minutemail.com",
  "10minutemail.net",
  "10minutemail.org",
  "20minutemail.com",
  "33mail.com",
  "armyspy.com",
  "byom.de",
  "crazymailing.com",
  "cuvox.de",
  "dayrep.com",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "guerrillamail.com",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "grr.la",
  "sharklasers.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.org",
  "temp-mail.io",
  "temp-mail.org",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "yopmail.org",
  "dispostable.com",
  "dropmail.me",
  "einrot.com",
  "emailfake.com",
  "emailnator.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "fleckens.hu",
  "generator.email",
  "getnada.com",
  "gustr.com",
  "huad.ru",
  "inboxkitten.com",
  "jourrapide.com",
  "jmaie.com",
  "mail.cx",
  "mail.gw",
  "mail.tm",
  "mailcatch.com",
  "maildrop.cc",
  "mailforspam.com",
  "mailnesia.com",
  "mailto.plus",
  "mailsac.com",
  "mintemail.com",
  "minuteinbox.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "nada.email",
  "rhyta.com",
  "spam4.me",
  "spambog.com",
  "spamgourmet.com",
  "superrito.com",
  "teleworm.us",
  "tempinbox.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
]);

// Popular mailbox providers are intentionally kept out of third-party
// intelligence checks. This avoids false positives and preserves its quota.
const TRUSTED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "mail.ru", "bk.ru", "inbox.ru", "list.ru",
  "internet.ru", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz", "ya.ru",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "proton.me", "protonmail.com", "icloud.com", "me.com", "mac.com",
  "rambler.ru", "gmx.com", "gmx.de", "zoho.com", "tuta.com", "tutanota.com",
  "fastmail.com",
]);

const ENV_DISPOSABLE_DOMAINS = parseDomainList(process.env.EMAIL_BLOCKED_DOMAINS);
const ENV_ALLOWED_DOMAINS = parseDomainList(process.env.EMAIL_ALLOWED_DOMAINS);
const BUNDLED_DISPOSABLE_DOMAINS = parseDomainList(bundledDisposableDomains);
let REFRESHED_DISPOSABLE_DOMAINS = new Set(BUNDLED_DISPOSABLE_DOMAINS);

const DISPOSABLE_DOMAINS_URL = String(
  process.env.EMAIL_DISPOSABLE_DOMAINS_URL ??
    "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains_strict_mx.json"
).trim();
const DISPOSABLE_DOMAINS_REFRESH_MS = 6 * 60 * 60 * 1000;
const DISPOSABLE_DOMAINS_RETRY_MS = 15 * 60 * 1000;
const DISPOSABLE_DOMAINS_FETCH_TIMEOUT_MS = 4000;
const DISPOSABLE_DOMAINS_MAX_BYTES = 2 * 1024 * 1024;
let disposableDomainsLastAttemptAt = 0;
let disposableDomainsLastSuccessAt = 0;
let disposableDomainsRefreshPromise: Promise<void> | null = null;

// Catch obvious rotating names without rejecting ordinary private domains.
// Keep this deliberately narrow; the exact blocklist can be extended through
// EMAIL_BLOCKED_DOMAINS without a code change.
const DISPOSABLE_DOMAIN_PATTERN = /(?:^|[.-])(?:temp(?:orary)?|trash|throwaway|disposable|burner|fake)(?:-?(?:mail|email|inbox))(?:[.-]|$)|(?:^|[.-])(?:10|20|30|60|minute|hour)-?(?:minute-?)?mail(?:[.-]|$)|(?:^|[.-])mail-?(?:temp|trash|drop|catch)(?:[.-]|$)/i;

const DNS_TIMEOUT_MS = 2500;
const DOMAIN_INTELLIGENCE_URL = String(
  process.env.EMAIL_DOMAIN_INTELLIGENCE_URL ?? "https://api.usercheck.com/domain/"
).trim();
const DOMAIN_INTELLIGENCE_KEY = String(process.env.EMAIL_DOMAIN_INTELLIGENCE_KEY ?? "").trim();
const DOMAIN_INTELLIGENCE_TIMEOUT_MS = 2500;
const DOMAIN_INTELLIGENCE_POSITIVE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const DOMAIN_INTELLIGENCE_NEGATIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const DOMAIN_INTELLIGENCE_ERROR_PAUSE_MS = 15 * 60 * 1000;
const DOMAIN_INTELLIGENCE_RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const DOMAIN_INTELLIGENCE_CACHE_MAX = 5000;
const domainIntelligenceCache = new Map<string, { disposable: boolean; expiresAt: number }>();
let domainIntelligencePausedUntil = 0;

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseDomainList(value: unknown): Set<string> {
  const source = Array.isArray(value)
    ? value.map((item) => String(item ?? ""))
    : String(value ?? "").split(/[\s,;]+/);

  return new Set(
    source
      .map((item) => item.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, ""))
      .filter((item) => DOMAIN_ALLOWED_RE.test(item) && item.includes("."))
  );
}

export async function refreshDisposableEmailDomains(force = false): Promise<void> {
  if (!DISPOSABLE_DOMAINS_URL || DISPOSABLE_DOMAINS_URL.toLowerCase() === "off") return;

  const now = Date.now();
  const retryAfter = disposableDomainsLastSuccessAt
    ? DISPOSABLE_DOMAINS_REFRESH_MS
    : DISPOSABLE_DOMAINS_RETRY_MS;
  if (!force && now - disposableDomainsLastAttemptAt < retryAfter) return;
  if (disposableDomainsRefreshPromise) return disposableDomainsRefreshPromise;

  disposableDomainsLastAttemptAt = now;
  disposableDomainsRefreshPromise = (async () => {
    const response = await withTimeout(
      fetch(DISPOSABLE_DOMAINS_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(DISPOSABLE_DOMAINS_FETCH_TIMEOUT_MS),
      }),
      DISPOSABLE_DOMAINS_FETCH_TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`disposable_domains_http_${response.status}`);

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > DISPOSABLE_DOMAINS_MAX_BYTES) throw new Error("disposable_domains_too_large");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > DISPOSABLE_DOMAINS_MAX_BYTES) throw new Error("disposable_domains_too_large");

    const refreshed = parseDomainList(JSON.parse(new TextDecoder().decode(bytes)));
    if (refreshed.size < 1000) throw new Error("disposable_domains_too_small");

    REFRESHED_DISPOSABLE_DOMAINS = new Set([
      ...BUNDLED_DISPOSABLE_DOMAINS,
      ...refreshed,
    ]);
    disposableDomainsLastSuccessAt = Date.now();
  })()
    .catch(() => {
      // Keep using the bundled snapshot when the remote source is unavailable.
    })
    .finally(() => {
      disposableDomainsRefreshPromise = null;
    });

  return disposableDomainsRefreshPromise;
}

function matchesDomainOrParent(domain: string, domains: Set<string>): boolean {
  let candidate = domain;
  while (candidate) {
    if (domains.has(candidate)) return true;
    const dot = candidate.indexOf(".");
    if (dot < 0) return false;
    candidate = candidate.slice(dot + 1);
  }
  return false;
}

export function isDisposableEmailDomain(value: unknown): boolean {
  const domain = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\.+$/, "");

  if (!domain) return false;
  if (matchesDomainOrParent(domain, ENV_ALLOWED_DOMAINS)) return false;
  if (TRUSTED_MAIL_DOMAINS.has(domain)) return false;
  if (matchesDomainOrParent(domain, ENV_DISPOSABLE_DOMAINS)) return true;
  if (matchesDomainOrParent(domain, DISPOSABLE_DOMAINS)) return true;
  if (matchesDomainOrParent(domain, REFRESHED_DISPOSABLE_DOMAINS)) return true;
  return DISPOSABLE_DOMAIN_PATTERN.test(domain);
}

async function lookupDisposableDomain(domain: string): Promise<boolean | undefined> {
  if (!DOMAIN_INTELLIGENCE_URL || DOMAIN_INTELLIGENCE_URL.toLowerCase() === "off") return undefined;
  if (matchesDomainOrParent(domain, ENV_ALLOWED_DOMAINS) || TRUSTED_MAIL_DOMAINS.has(domain)) {
    return false;
  }

  const now = Date.now();
  const cached = domainIntelligenceCache.get(domain);
  if (cached && cached.expiresAt > now) return cached.disposable;
  if (cached) domainIntelligenceCache.delete(domain);
  if (domainIntelligencePausedUntil > now) return undefined;

  try {
    const base = DOMAIN_INTELLIGENCE_URL.endsWith("/")
      ? DOMAIN_INTELLIGENCE_URL
      : `${DOMAIN_INTELLIGENCE_URL}/`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (DOMAIN_INTELLIGENCE_KEY) headers.Authorization = `Bearer ${DOMAIN_INTELLIGENCE_KEY}`;

    const response = await withTimeout(
      fetch(`${base}${encodeURIComponent(domain)}?include_mx=false`, {
        headers,
        signal: AbortSignal.timeout(DOMAIN_INTELLIGENCE_TIMEOUT_MS),
      }),
      DOMAIN_INTELLIGENCE_TIMEOUT_MS
    );

    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
      domainIntelligencePausedUntil = now + Math.max(
        DOMAIN_INTELLIGENCE_RATE_LIMIT_PAUSE_MS,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 0
      );
      return undefined;
    }
    if (!response.ok) {
      domainIntelligencePausedUntil = now + DOMAIN_INTELLIGENCE_ERROR_PAUSE_MS;
      return undefined;
    }

    const payload = await response.json() as { disposable?: unknown };
    if (typeof payload.disposable !== "boolean") return undefined;

    if (domainIntelligenceCache.size >= DOMAIN_INTELLIGENCE_CACHE_MAX) {
      const oldestKey = domainIntelligenceCache.keys().next().value as string | undefined;
      if (oldestKey) domainIntelligenceCache.delete(oldestKey);
    }
    domainIntelligenceCache.set(domain, {
      disposable: payload.disposable,
      expiresAt: now + (payload.disposable
        ? DOMAIN_INTELLIGENCE_POSITIVE_CACHE_MS
        : DOMAIN_INTELLIGENCE_NEGATIVE_CACHE_MS),
    });
    return payload.disposable;
  } catch {
    domainIntelligencePausedUntil = now + DOMAIN_INTELLIGENCE_ERROR_PAUSE_MS;
    return undefined;
  }
}

export function validateRegistrationEmailBasic(value: unknown): EmailValidationResult {
  const email = normalizeEmail(value);

  if (!email) {
    return {
      ok: false,
      normalized: email,
      code: "email_required",
    };
  }

  if (!ASCII_ONLY_RE.test(email)) {
    return {
      ok: false,
      normalized: email,
      code: "email_non_ascii",
    };
  }

  if (!SIMPLE_EMAIL_RE.test(email)) {
    return {
      ok: false,
      normalized: email,
      code: "email_invalid_format",
    };
  }

  const partsAt = email.split("@");
  if (partsAt.length !== 2) {
    return {
      ok: false,
      normalized: email,
      code: "email_invalid_format",
    };
  }

  const [local, domain] = partsAt;

  if (!local || !domain) {
    return {
      ok: false,
      normalized: email,
      code: "email_invalid_format",
    };
  }

  if (local.length < 2) {
    return {
      ok: false,
      normalized: email,
      code: "email_local_too_short",
    };
  }

  if (
    !LOCAL_ALLOWED_RE.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return {
      ok: false,
      normalized: email,
      code: "email_local_invalid",
    };
  }

  if (!domain.includes(".")) {
    return {
      ok: false,
      normalized: email,
      code: "email_domain_invalid",
    };
  }

  if (
    !DOMAIN_ALLOWED_RE.test(domain) ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return {
      ok: false,
      normalized: email,
      code: "email_domain_invalid",
    };
  }

  const domainParts = domain.split(".");
  const tld = domainParts[domainParts.length - 1] ?? "";

  if (domainParts.length < 2 || tld.length < 2) {
    return {
      ok: false,
      normalized: email,
      code: "email_domain_invalid",
    };
  }

  for (const label of domainParts) {
    if (!label) {
      return {
        ok: false,
        normalized: email,
        code: "email_domain_invalid",
      };
    }

    if (!/^[a-z0-9-]+$/i.test(label)) {
      return {
        ok: false,
        normalized: email,
        code: "email_domain_invalid",
      };
    }

    if (label.startsWith("-") || label.endsWith("-")) {
      return {
        ok: false,
        normalized: email,
        code: "email_domain_invalid",
      };
    }
  }

  if (domainParts.every((label) => /^\d+$/.test(label))) {
    return {
      ok: false,
      normalized: email,
      code: "email_domain_numeric",
    };
  }

  if (isDisposableEmailDomain(domain)) {
    return {
      ok: false,
      normalized: email,
      code: "email_disposable",
    };
  }

  return {
    ok: true,
    normalized: email,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("dns_timeout"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveMailExchanges(domain: string): Promise<string[]> {
  try {
    const mx = await withTimeout(resolveMx(domain), DNS_TIMEOUT_MS);
    return Array.isArray(mx)
      ? mx
          .map((record) => String(record?.exchange ?? "").trim().toLowerCase().replace(/\.$/, ""))
          .filter((exchange) => exchange !== "" && exchange !== ".")
      : [];
  } catch {
    return [];
  }
}

export async function validateRegistrationEmail(value: unknown): Promise<EmailValidationResult> {
  const basic = validateRegistrationEmailBasic(value);

  if (!basic.ok) {
    return basic;
  }

  // Refresh in the background. The bundled snapshot is checked synchronously,
  // so registration never waits for GitHub and remains protected offline.
  void refreshDisposableEmailDomains();

  const [, domain] = basic.normalized.split("@");

  if (!domain) {
    return {
      ok: false,
      normalized: basic.normalized,
      code: "email_domain_invalid",
    };
  }

  try {
    const intelligenceDisposable = await lookupDisposableDomain(domain);
    if (intelligenceDisposable === true) {
      return {
        ok: false,
        normalized: basic.normalized,
        code: "email_disposable",
      };
    }

    const mailExchanges = await resolveMailExchanges(domain);

    if (mailExchanges.length === 0) {
      return {
        ok: false,
        normalized: basic.normalized,
        code: "email_domain_unresolvable",
      };
    }

    if (mailExchanges.some((exchange) => isDisposableEmailDomain(exchange))) {
      return {
        ok: false,
        normalized: basic.normalized,
        code: "email_disposable",
      };
    }

    return {
      ok: true,
      normalized: basic.normalized,
    };
  } catch {
    return {
      ok: false,
      normalized: basic.normalized,
      code: "email_check_failed",
    };
  }
}

export function isSuspiciousEmail(email: string): boolean {
  return !validateRegistrationEmailBasic(email).ok;
}

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
  if (matchesDomainOrParent(domain, ENV_DISPOSABLE_DOMAINS)) return true;
  if (matchesDomainOrParent(domain, DISPOSABLE_DOMAINS)) return true;
  if (matchesDomainOrParent(domain, REFRESHED_DISPOSABLE_DOMAINS)) return true;
  return DISPOSABLE_DOMAIN_PATTERN.test(domain);
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

async function hasMailExchange(domain: string): Promise<boolean> {
  try {
    const mx = await withTimeout(resolveMx(domain), DNS_TIMEOUT_MS);
    return Array.isArray(mx) && mx.some((record) => {
      const exchange = String(record?.exchange ?? "").trim();
      return exchange !== "" && exchange !== ".";
    });
  } catch {
    return false;
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
    const resolvable = await hasMailExchange(domain);

    if (!resolvable) {
      return {
        ok: false,
        normalized: basic.normalized,
        code: "email_domain_unresolvable",
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

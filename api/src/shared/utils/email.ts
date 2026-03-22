import { resolve4, resolve6, resolveMx } from "node:dns/promises";

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
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "yopmail.com",
  "yopmail.net",
  "yopmail.org",
  "dispostable.com",
  "trashmail.com",
]);

const DNS_TIMEOUT_MS = 2500;

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
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

  if (DISPOSABLE_DOMAINS.has(domain)) {
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

async function hasResolvableMailDomain(domain: string): Promise<boolean> {
  try {
    const mx = await withTimeout(resolveMx(domain), DNS_TIMEOUT_MS);
    if (Array.isArray(mx) && mx.length > 0) return true;
  } catch {
    // ignore and fallback
  }

  try {
    const a = await withTimeout(resolve4(domain), DNS_TIMEOUT_MS);
    if (Array.isArray(a) && a.length > 0) return true;
  } catch {
    // ignore and fallback
  }

  try {
    const aaaa = await withTimeout(resolve6(domain), DNS_TIMEOUT_MS);
    if (Array.isArray(aaaa) && aaaa.length > 0) return true;
  } catch {
    // ignore
  }

  return false;
}

export async function validateRegistrationEmail(value: unknown): Promise<EmailValidationResult> {
  const basic = validateRegistrationEmailBasic(value);

  if (!basic.ok) {
    return basic;
  }

  const [, domain] = basic.normalized.split("@");

  if (!domain) {
    return {
      ok: false,
      normalized: basic.normalized,
      code: "email_domain_invalid",
    };
  }

  try {
    const resolvable = await hasResolvableMailDomain(domain);

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
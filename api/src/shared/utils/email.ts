import bundledAllowedDomains from "../data/allowed-email-domains.json" with { type: "json" };

export type EmailValidationCode =
  | "email_required"
  | "email_invalid_format"
  | "email_local_too_short"
  | "email_local_invalid"
  | "email_domain_invalid"
  | "email_domain_numeric"
  | "email_domain_not_allowed"
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

const ALLOWED_EMAIL_DOMAINS = new Set([
  ...parseDomainList(bundledAllowedDomains),
  ...parseDomainList(process.env.EMAIL_ALLOWED_DOMAINS),
]);

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isAllowedEmailDomain(value: unknown): boolean {
  const domain = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\.+$/, "");

  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

export function validateRegistrationEmailBasic(value: unknown): EmailValidationResult {
  const email = normalizeEmail(value);

  if (!email) return { ok: false, normalized: email, code: "email_required" };
  if (!ASCII_ONLY_RE.test(email)) return { ok: false, normalized: email, code: "email_non_ascii" };
  if (!SIMPLE_EMAIL_RE.test(email)) {
    return { ok: false, normalized: email, code: "email_invalid_format" };
  }

  const partsAt = email.split("@");
  if (partsAt.length !== 2) {
    return { ok: false, normalized: email, code: "email_invalid_format" };
  }

  const [local, domain] = partsAt;
  if (!local || !domain) {
    return { ok: false, normalized: email, code: "email_invalid_format" };
  }
  if (local.length < 2) {
    return { ok: false, normalized: email, code: "email_local_too_short" };
  }
  if (
    !LOCAL_ALLOWED_RE.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return { ok: false, normalized: email, code: "email_local_invalid" };
  }

  if (!domain.includes(".")) {
    return { ok: false, normalized: email, code: "email_domain_invalid" };
  }
  if (
    !DOMAIN_ALLOWED_RE.test(domain) ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return { ok: false, normalized: email, code: "email_domain_invalid" };
  }

  const domainParts = domain.split(".");
  const tld = domainParts.at(-1) ?? "";
  if (domainParts.length < 2 || tld.length < 2) {
    return { ok: false, normalized: email, code: "email_domain_invalid" };
  }
  for (const label of domainParts) {
    if (!label || !/^[a-z0-9-]+$/i.test(label) || label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, normalized: email, code: "email_domain_invalid" };
    }
  }
  if (domainParts.every((label) => /^\d+$/.test(label))) {
    return { ok: false, normalized: email, code: "email_domain_numeric" };
  }
  if (!isAllowedEmailDomain(domain)) {
    return { ok: false, normalized: email, code: "email_domain_not_allowed" };
  }

  return { ok: true, normalized: email };
}

export async function validateRegistrationEmail(value: unknown): Promise<EmailValidationResult> {
  return validateRegistrationEmailBasic(value);
}

export function isSuspiciousEmail(email: string): boolean {
  return !validateRegistrationEmailBasic(email).ok;
}

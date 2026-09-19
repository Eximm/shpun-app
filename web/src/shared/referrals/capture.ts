// web/src/shared/referrals/capture.ts
//
// Single source of truth for referral/partner attribution on the client.
//
// Canonical links produced by the admin panel:
//   Web:      https://app.shpun.net/?<alias>            (bare alias, historical)
//             https://app.shpun.net/?ref=<alias>
//   Telegram: https://t.me/<bot>?start=<base64url(referral_alias=..&partner_id=..)>
//
// The value is persisted to localStorage BEFORE any router redirect or network
// resolve so attribution survives `/` -> `/login`, refreshes, SPA navigation and
// a temporarily unavailable resolve API.
//
// This module is intentionally dependency-free (no React, no DOM APIs other than
// window/localStorage guarded with try/catch) so it can run at bootstrap.

export const PARTNER_LS_KEY = "partner_id_pending";
export const REFERRAL_ALIAS_LS_KEY = "referral_alias_pending";

export type CapturedReferral = {
  /** Numeric SHM partner id, 0 when unknown. */
  partnerId: number;
  /** Canonical lowercase alias, "" when absent. */
  alias: string;
};

const ALIAS_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function isValidReferralAlias(v: unknown): boolean {
  return ALIAS_RE.test(String(v ?? "").trim().toLowerCase());
}

function safeGetLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readPendingPartnerId(): number {
  const ls = safeGetLocalStorage();
  if (!ls) return 0;
  try {
    return normalizePartnerId(String(ls.getItem(PARTNER_LS_KEY) ?? "").trim());
  } catch {
    return 0;
  }
}

export function savePendingPartnerId(id: unknown): void {
  const n = normalizePartnerId(id);
  const ls = safeGetLocalStorage();
  if (!ls || n <= 0) return;
  try {
    ls.setItem(PARTNER_LS_KEY, String(n));
  } catch {
    /* ignore */
  }
}

export function clearPendingPartnerId(): void {
  const ls = safeGetLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(PARTNER_LS_KEY);
  } catch {
    /* ignore */
  }
}

export function readPendingReferralAlias(): string {
  const ls = safeGetLocalStorage();
  if (!ls) return "";
  try {
    return String(ls.getItem(REFERRAL_ALIAS_LS_KEY) ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function savePendingReferralAlias(alias: unknown): void {
  const a = String(alias ?? "").trim().toLowerCase();
  const ls = safeGetLocalStorage();
  if (!ls || !a) return;
  try {
    ls.setItem(REFERRAL_ALIAS_LS_KEY, a);
  } catch {
    /* ignore */
  }
}

export function clearPendingReferralAlias(): void {
  const ls = safeGetLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(REFERRAL_ALIAS_LS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Replace the referral part of the current URL (used when the user applies a
 * code manually, so the URL and the persisted attribution stay in sync and the
 * manual choice wins over the original link).
 */
export function replaceReferralInUrl(kind: "partner" | "alias", value: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    for (const key of ["partner_id", "ref", "referral", "alias"]) url.searchParams.delete(key);
    for (const [key, val] of [...url.searchParams.entries()]) {
      if (val) continue;
      if (key === "partner_id") continue;
      if (isValidReferralAlias(key.trim().toLowerCase())) url.searchParams.delete(key);
    }
    if (kind === "partner") {
      const n = normalizePartnerId(value);
      if (n > 0) url.searchParams.set("partner_id", String(n));
    } else {
      const a = String(value ?? "").trim().toLowerCase();
      if (isValidReferralAlias(a)) url.searchParams.set("ref", a);
    }
    window.history?.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

/**
 * Parse a referral out of a query string (without the leading "?").
 *
 * Priority:
 *   1. numeric `partner_id` (legacy user invite links)
 *   2. explicit alias params: `ref`, `referral`, `alias`
 *   3. compact bare key: `?druni4` (admin-generated campaign/partner links)
 */
export function parseReferralFromSearch(search: string): CapturedReferral {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  } catch {
    return { partnerId: 0, alias: "" };
  }

  const partnerId = normalizePartnerId(params.get("partner_id"));

  const explicitRaw = params.get("ref") ?? params.get("referral") ?? params.get("alias") ?? "";
  const explicit = String(explicitRaw).trim().toLowerCase();
  if (isValidReferralAlias(explicit)) return { partnerId, alias: explicit };

  for (const [key, value] of params.entries()) {
    if (value) continue;
    if (key === "partner_id") continue;
    const candidate = key.trim().toLowerCase();
    if (isValidReferralAlias(candidate)) return { partnerId, alias: candidate };
  }

  return { partnerId, alias: "" };
}

/** Parse a referral from a full URL/href (query string and hash-query supported). */
export function parseReferralFromHref(href: string): CapturedReferral {
  let url: URL;
  try {
    url = new URL(String(href ?? ""), "http://localhost");
  } catch {
    return { partnerId: 0, alias: "" };
  }

  const fromSearch = parseReferralFromSearch(url.search);
  if (fromSearch.partnerId > 0 || fromSearch.alias) return fromSearch;

  const hash = String(url.hash ?? "");
  const q = hash.indexOf("?");
  if (q >= 0) return parseReferralFromSearch(hash.slice(q + 1));

  return { partnerId: 0, alias: "" };
}

/**
 * Read the referral from the current URL and persist it (last-touch).
 *
 * Only writes when the URL actually carries a referral, so an ordinary visit
 * never clobbers a previously captured attribution.
 */
export function captureReferralFromLocation(href?: string): CapturedReferral {
  const target = href ?? (typeof window !== "undefined" ? window.location.href : "");
  const captured = parseReferralFromHref(target);
  if (captured.alias) savePendingReferralAlias(captured.alias);
  if (captured.partnerId > 0) savePendingPartnerId(captured.partnerId);

  // Development/test diagnostics only. Never logs secrets (alias is a public id).
  try {
    if (import.meta.env?.DEV && (captured.alias || captured.partnerId > 0)) {
      console.info(JSON.stringify({
        event: "REFERRAL_CAPTURE",
        source: "web",
        alias: captured.alias || undefined,
        partnerId: captured.partnerId > 0 ? captured.partnerId : undefined,
      }));
    }
  } catch {
    /* ignore */
  }

  return captured;
}

/** Canonical payload sent to the backend during registration. */
export function buildReferralPayload(partnerId: number, alias: string): Record<string, string | number> {
  const id = normalizePartnerId(partnerId);
  const a = String(alias ?? "").trim().toLowerCase();
  return {
    ...(id > 0 ? { partner_id: id } : {}),
    ...(isValidReferralAlias(a) ? { referral_alias: a } : {}),
  };
}
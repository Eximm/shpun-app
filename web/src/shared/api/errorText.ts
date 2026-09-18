// web/src/shared/api/errorText.ts
//
// Normalizes any API/network error into a human-readable, localized
// title/description. Raw codes are preserved in `code` for logs/debug only
// and are never shown to the user.

import { tGlobal } from "../i18n/runtime";

export type NormalizedError = {
  title: string;
  description?: string;
  code?: string;
  status?: number;
  suppressToast?: boolean;
};

type AnyObj = Record<string, any>;

function isObj(v: unknown): v is AnyObj {
  return typeof v === "object" && v !== null;
}

function pickString(...vals: Array<unknown>): string | undefined {
  for (const v of vals) {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return s;
    }
  }
  return undefined;
}

/**
 * Tries to extract a "code/message/status" from anything:
 * - Error
 * - API payloads
 * - fetch-like errors
 * - nested wrappers (err.response / err.data / err.body)
 */
function extract(err: unknown): { code?: string; message?: string; status?: number } {
  if (typeof err === "string") return { message: err };

  if (err instanceof Error) {
    const anyErr = err as any;
    const status =
      typeof anyErr.status === "number"
        ? anyErr.status
        : typeof anyErr.statusCode === "number"
          ? anyErr.statusCode
          : typeof anyErr.httpStatus === "number"
            ? anyErr.httpStatus
            : undefined;

    const code = pickString(anyErr.code, anyErr.name, anyErr.error);
    const message = pickString(err.message);

    return { code, message, status };
  }

  if (!isObj(err)) return {};

  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : typeof err.httpStatus === "number"
          ? err.httpStatus
          : typeof err.response?.status === "number"
            ? err.response.status
            : undefined;

  const code = pickString(
    err.error,
    err.code,
    err.name,

    err?.data?.error,
    err?.data?.code,
    err?.data?.error_code,

    err?.body?.error,
    err?.body?.code,
    err?.body?.error_code,

    err?.response?.error,
    err?.response?.code,
    err?.response?.data?.error,
    err?.response?.data?.code
  );

  const message = pickString(
    err.message,

    err?.data?.message,
    err?.data?.details,

    err?.body?.message,
    err?.body?.details,

    err?.response?.message,
    err?.response?.data?.message,
    err?.response?.data?.details
  );

  return { code, message, status };
}

function lc(s?: string) {
  return (s || "").toLowerCase();
}

function hasShmToken(s?: string) {
  const v = lc(s);
  if (!v) return false;
  return /\bshm[_-][a-z0-9_]+\b/.test(v) || v === "shm_error" || v === "shm_fail" || v.startsWith("shm_");
}

function isShmCode(code?: string, message?: string) {
  return hasShmToken(code) || hasShmToken(message);
}

function isAuth(code?: string, status?: number, message?: string) {
  const c = lc(code);
  const m = lc(message);
  return (
    status === 401 ||
    status === 403 ||
    c === "not_authenticated" ||
    c.includes("bad_session") ||
    c.includes("unauthorized") ||
    c.includes("forbidden") ||
    m.includes("bad_session") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("not_authenticated")
  );
}

function isNetwork(message?: string, code?: string) {
  const m = lc(message);
  const c = lc(code);
  return (
    c.includes("network") ||
    c.includes("fetch") ||
    c.includes("timeout") ||
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("timeout") ||
    m.includes("econn") ||
    m.includes("enotfound") ||
    m.includes("eai_again") ||
    m.includes("socket") ||
    m.includes("connection")
  );
}

function looksLikeHtml(s?: string) {
  const t = String(s || "").trim();
  if (!t) return false;
  return /^<!doctype html/i.test(t) || /^<html/i.test(t) || /<\/[a-z]+>/i.test(t);
}

function looksLikeJsonBlob(s?: string) {
  const t = String(s || "").trim();
  if (!t) return false;
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}

function looksLikeTechGarbage(s?: string) {
  const t = (s || "").trim();
  if (!t) return false;

  if (
    /^shm[_-][a-z0-9_]+$/i.test(t) ||
    /^not_authenticated$/i.test(t) ||
    /^bad_session$/i.test(t) ||
    /^unauthorized$/i.test(t) ||
    /^forbidden$/i.test(t)
  ) {
    return true;
  }

  if (/^[A-Z0-9_]{6,}$/.test(t)) return true;
  if (/^fetch failed/i.test(t)) return true;
  if (/status code\s+\d{3}/i.test(t)) return true;
  if (looksLikeHtml(t)) return true;
  if (looksLikeJsonBlob(t)) return true;

  return false;
}

/**
 * Normalize any error into user-friendly title/description.
 * - Never expose raw codes like shm_error/shm_fail to user.
 * - Prefer backend "message" ONLY if it doesn't look technical.
 */
export function normalizeError(err: unknown, ctx?: { title?: string }): NormalizedError {
  const { code, message, status } = extract(err);

  if (isAuth(code, status, message)) {
    return {
      title: ctx?.title || tGlobal("error.auth.title"),
      description: tGlobal("error.auth.desc"),
      code,
      status,
    };
  }

  if (isNetwork(message, code)) {
    return {
      title: ctx?.title || tGlobal("error.network.title"),
      description: tGlobal("error.network.desc"),
      code,
      status,
    };
  }

  if (isShmCode(code, message)) {
    return {
      title: ctx?.title || tGlobal("error.service_unavailable.title"),
      description: tGlobal("error.service_unavailable.desc"),
      code: code || "shm_error",
      status,
    };
  }

  if (status === 429) {
    return {
      title: ctx?.title || tGlobal("error.rate_limit.title"),
      description: tGlobal("error.rate_limit.desc"),
      code,
      status,
    };
  }

  if (status && status >= 500) {
    return {
      title: ctx?.title || tGlobal("error.server.title"),
      description: tGlobal("error.server.desc"),
      code,
      status,
    };
  }

  if (status === 404) {
    return {
      title: ctx?.title || tGlobal("error.not_found.title"),
      description: tGlobal("error.not_found.desc"),
      code,
      status,
    };
  }

  if (status === 400 || status === 422) {
    if (message && !looksLikeTechGarbage(message)) {
      return {
        title: ctx?.title || tGlobal("error.action.title"),
        description: message,
        code,
        status,
      };
    }

    return {
      title: ctx?.title || tGlobal("error.bad_request.title"),
      description: tGlobal("error.bad_request.desc"),
      code,
      status,
    };
  }

  if (message && !looksLikeTechGarbage(message)) {
    return {
      title: ctx?.title || tGlobal("error.action.title"),
      description: message,
      code,
      status,
    };
  }

  return {
    title: ctx?.title || tGlobal("error.generic.title"),
    description: tGlobal("error.generic.desc"),
    code,
    status,
  };
}
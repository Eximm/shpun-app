// web/src/shared/api/errorText.ts

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
    // some libs put custom fields into Error object
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

    // Error.message sometimes equals technical code: "shm_fail"
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

  // Common API payloads in your project:
  // - { ok:false, error:"shm_error", message?: "..." }
  // - { ok:false, error:"not_authenticated" }
  // - fastify-like: { statusCode, error, message }
  // - client wrapper: { status, data:{...} } / { response:{...} }
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
  // catches: shm_fail, shm_error, shm-foo, "… shm_fail …"
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
    m.includes("bad_session") ||
    m.includes("unauthorized") ||
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

function looksLikeTechGarbage(s?: string) {
  const t = (s || "").trim();
  if (!t) return false;

  // pure tokens/codes → not for user
  if (
    /^shm[_-][a-z0-9_]+$/i.test(t) ||
    /^not_authenticated$/i.test(t) ||
    /^bad_session$/i.test(t) ||
    /^unauthorized$/i.test(t)
  ) {
    return true;
  }

  // screaming snake / opaque codes
  if (/^[A-Z0-9_]{6,}$/.test(t)) return true;

  // typical fetch noisy strings
  if (/^fetch failed/i.test(t)) return true;

  // "Request failed with status code 502" style
  if (/status code\s+\d{3}/i.test(t)) return true;

  return false;
}

/**
 * Normalize any error into user-friendly title/description.
 * - Never expose raw codes like shm_error/shm_fail to user.
 * - Prefer backend "message" ONLY if it doesn't look technical.
 */
export function normalizeError(err: unknown, ctx?: { title?: string }): NormalizedError {
  const { code, message, status } = extract(err);

  // Auth/session
  if (isAuth(code, status, message)) {
    return {
      title: ctx?.title || "Нужно войти заново",
      description: "Сессия устарела. Пожалуйста, перезайдите в приложение.",
      code,
      status,
    };
  }

  // Network
  if (isNetwork(message, code)) {
    return {
      title: ctx?.title || "Проблема с соединением",
      description: "Проверьте интернет и попробуйте ещё раз.",
      code,
      status,
    };
  }

  // SHM upstream
  if (isShmCode(code, message)) {
    return {
      title: ctx?.title || "Сервис временно недоступен",
      description: "Попробуйте ещё раз чуть позже.",
      code: code || "shm_error",
      status,
    };
  }

  // Generic HTTP
  if (status && status >= 500) {
    return {
      title: ctx?.title || "Ошибка сервера",
      description: "Попробуйте ещё раз чуть позже.",
      code,
      status,
    };
  }

  if (status === 404) {
    return {
      title: ctx?.title || "Не найдено",
      description: "Запрошенный ресурс не найден.",
      code,
      status,
    };
  }

  // Use backend message if it's not a technical token
  if (message && !looksLikeTechGarbage(message)) {
    return {
      title: ctx?.title || "Не удалось выполнить действие",
      description: message,
      code,
      status,
    };
  }

  // If code looks like a real domain error (not shm/auth) but no good message:
  // don't show the code — show generic.
  return {
    title: ctx?.title || "Что-то пошло не так",
    description: "Попробуйте ещё раз.",
    code,
    status,
  };
}
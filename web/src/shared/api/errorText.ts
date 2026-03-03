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

function extract(err: unknown): { code?: string; message?: string; status?: number } {
  if (typeof err === "string") return { message: err };

  if (err instanceof Error) {
    return { message: err.message };
  }

  if (!isObj(err)) return {};

  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : typeof err.httpStatus === "number"
          ? err.httpStatus
          : undefined;

  // Common API payloads in your project:
  // - { ok:false, error:"shm_error", message?: "..." }
  // - { ok:false, error:"not_authenticated" }
  // - fastify-like: { statusCode, error, message }
  const code = pickString(
    err.error,
    err.code,
    err.name,
    err?.data?.error,
    err?.data?.code,
    err?.body?.error,
    err?.body?.code,
    err?.response?.error,
    err?.response?.code
  );

  const message = pickString(
    err.message,
    err?.data?.message,
    err?.body?.message,
    err?.response?.message
  );

  return { code, message, status };
}

function lc(s?: string) {
  return (s || "").toLowerCase();
}

function isShmCode(code?: string, message?: string) {
  const c = lc(code);
  const m = lc(message);
  return c.startsWith("shm_") || c === "shm_error" || c === "shm_fail" || m.includes("shm_");
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
    m.includes("unauthorized")
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
    m.includes("eai_again")
  );
}

function looksLikeTechGarbage(s?: string) {
  const t = (s || "").trim();
  if (!t) return false;
  // don't show pure codes as "description"
  return (
    /^shm_[a-z0-9_]+$/i.test(t) ||
    /^not_authenticated$/i.test(t) ||
    /^bad_session$/i.test(t) ||
    /^unauthorized$/i.test(t) ||
    /^[A-Z0-9_]{6,}$/.test(t) // generic screaming snake
  );
}

/**
 * Normalize any error into user-friendly title/description.
 * - Never expose raw codes like shm_error to user.
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

  return {
    title: ctx?.title || "Что-то пошло не так",
    description: "Попробуйте ещё раз.",
    code,
    status,
  };
}
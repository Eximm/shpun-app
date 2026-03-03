// web/src/shared/api/client.ts

const API_BASE = "/api";

/**
 * ApiError — normalized error for UX
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;

  constructor(message: string, opts: { status: number; code?: string; data?: any }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.data = opts.data;
  }
}

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

export function isNotAuthenticated(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403) && e.code === "not_authenticated";
}

// ✅ Our own init type: allow body to be an object (we will serialize it)
export type ApiFetchInit = Omit<RequestInit, "body"> & {
  body?: unknown;
};

function isJsonBodyCandidate(x: unknown): boolean {
  if (x === null || x === undefined) return false;

  // Bodies we should pass through as-is
  try {
    if (typeof FormData !== "undefined" && x instanceof FormData) return false;
    if (typeof Blob !== "undefined" && x instanceof Blob) return false;
    if (typeof ArrayBuffer !== "undefined" && x instanceof ArrayBuffer) return false;
    if (typeof URLSearchParams !== "undefined" && x instanceof URLSearchParams) return false;
  } catch {
    // ignore env-specific instanceof issues
  }

  // Any object (including arrays) should be JSON-serialized
  if (typeof x === "object") return true;

  return false;
}

function looksLikeJsonString(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function looksLikeTechGarbage(s?: string) {
  const t = String(s || "").trim();
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

  if (/status code\s+\d{3}/i.test(t)) return true;

  return false;
}

function defaultMessageByStatus(status: number) {
  if (status === 401 || status === 403) return "Нужно войти заново.";
  if (status === 404) return "Не найдено.";
  if (status >= 500) return "Ошибка сервера. Попробуйте ещё раз чуть позже.";
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}

function pickUserMessage(data: any, fallback: string) {
  // We NEVER use `data.error` as a user-visible message (it's a code)
  const m1 = isObj(data) && typeof data.message === "string" ? data.message.trim() : "";
  const m2 = isObj(data) && typeof data.details === "string" ? data.details.trim() : "";
  const m = m1 || m2;

  if (m && !looksLikeTechGarbage(m)) return m;
  return fallback;
}

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  let body: BodyInit | null | undefined;

  const rawBody = init.body;

  // If body is an object/array — send JSON
  if (isJsonBodyCandidate(rawBody)) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    body = JSON.stringify(rawBody);
  } else if (typeof rawBody === "string") {
    // If caller pre-serialized JSON string — keep it, but set JSON content-type automatically
    if (!headers.has("Content-Type") && looksLikeJsonString(rawBody)) {
      headers.set("Content-Type", "application/json");
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
    }
    body = rawBody;
  } else {
    // Otherwise pass through as-is (null/undefined/FormData/Blob/etc)
    body = rawBody as any;
  }

  // DEV helper: catch accidental JSON.stringify usage early
  try {
    // @ts-ignore
    if (import.meta?.env?.DEV && typeof rawBody === "string" && looksLikeJsonString(rawBody)) {
      // eslint-disable-next-line no-console
      console.warn("apiFetch: body is JSON string; pass an object instead", { path });
    }
  } catch {
    // ignore
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      body,
      headers,
      credentials: "include",
    });
  } catch (e: any) {
    // network-level errors (no HTTP response)
    // Do NOT leak "Failed to fetch" etc to UI by default.
    throw new ApiError("Проблема с соединением. Проверьте интернет и попробуйте ещё раз.", {
      status: 0,
      code: "network_error",
      data: { cause: String(e?.message || e) },
    });
  }

  if (res.status === 204) return null as T;

  const text = await res.text();

  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // keep plain text, but wrap
      data = { message: text };
    }
  }

  // Some APIs may return 200 with { ok:false, error:"..." }
  const logicalOk = !(isObj(data) && data.ok === false);

  if (!res.ok || !logicalOk) {
    const status = res.status;
    const fallback = defaultMessageByStatus(status);

    const code =
      isObj(data) && typeof data.error === "string"
        ? String(data.error).trim()
        : isObj(data) && typeof data.code === "string"
          ? String(data.code).trim()
          : undefined;

    const userMsg = pickUserMessage(data, fallback);

    throw new ApiError(userMsg, {
      status,
      code,
      data,
    });
  }

  return data as T;
}
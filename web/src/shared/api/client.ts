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
  return e instanceof ApiError && e.status === 401;
}

export function isNotAuthenticated(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && e.code === "not_authenticated";
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
  // (won't affect prod build if import.meta.env.DEV is replaced by bundler)
  try {
    // @ts-ignore
    if (import.meta?.env?.DEV && typeof rawBody === "string" && looksLikeJsonString(rawBody)) {
      // eslint-disable-next-line no-console
      console.warn("apiFetch: body is JSON string; pass an object instead", { path });
    }
  } catch {
    // ignore
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    body,
    headers,
    credentials: "include",
  });

  if (res.status === 204) return null as T;

  const text = await res.text();

  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === "object"
        ? (data.error as string | undefined) || (data.message as string | undefined)
        : undefined;

    // нормализуем код ошибки (важно для UX)
    const code =
      data && typeof data === "object" && typeof data.error === "string" ? String(data.error) : undefined;

    throw new ApiError(errMsg || `Request failed: ${res.status}`, {
      status: res.status,
      code,
      data,
    });
  }

  return data as T;
}

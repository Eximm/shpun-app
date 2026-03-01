// web/src/shared/api/client.ts

const API_BASE = "/api";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object") return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

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

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  let body: BodyInit | null | undefined;

  const rawBody = init.body;

  // If body is a plain object, send it as JSON
  if (rawBody !== undefined && rawBody !== null && isPlainObject(rawBody)) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    body = JSON.stringify(rawBody);
  } else {
    // Otherwise pass through as-is (string/FormData/Blob/URLSearchParams/etc)
    body = rawBody as any;
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
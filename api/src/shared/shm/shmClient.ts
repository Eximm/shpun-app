// api/src/shared/shm/shmClient.ts

/**
 * Важно:
 * SHM_BASE должен указывать на /shm/ (с любым количеством слешей на конце — мы нормализуем)
 * Пример:
 *   SHM_BASE="https://bill.shpyn.online/shm/"
 */

export type ShmResult<T = unknown> = {
  ok: boolean;
  status: number;
  json?: T;
  text?: string;
};

function normalizeBase(raw: string) {
  let s = String(raw || "").trim();
  if (!s) s = "https://bill.shpyn.online/shm/";
  if (!s.endsWith("/")) s += "/";
  return s;
}

export const SHM_BASE = normalizeBase(
  process.env.SHM_BASE ?? "https://bill.shpyn.online/shm/"
);

export function toFormUrlEncoded(obj: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) p.set(k, String(v ?? ""));
  return p.toString();
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type ShmFetchOpts = {
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  body?: string | Record<string, any> | null;
  signal?: AbortSignal;
};

export async function shmFetch<T = unknown>(
  sessionId: string | null,
  path: string, // path без ведущего слеша, например "v1/user"
  opts?: ShmFetchOpts
): Promise<ShmResult<T>> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(cleanPath, SHM_BASE);

  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts?.headers ?? {}),
  };

  if (sessionId) headers["session-id"] = sessionId;

  let body: any = opts?.body ?? undefined;

  // если body объект — отправляем JSON
  if (body && typeof body === "object" && !(body instanceof String)) {
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), {
    method: opts?.method ?? "GET",
    headers,
    body,
    signal: opts?.signal,
  });

  const text = await res.text().catch(() => "");

  // SHM иногда отдаёт JSON без корректного content-type — парсим мягко всегда
  const parsed = safeJsonParse(text);
  const json = parsed !== null ? (parsed as T) : undefined;

  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Удобный helper для мест, где нужно “взорваться” на ошибке
 * (опционально использовать, не обязателен).
 */
export function assertOk<T>(r: ShmResult<T>, label = "shm_request_failed"): T {
  if (r.ok && r.json !== undefined) return r.json;
  const detail = String(r.text || "").slice(0, 200);
  throw new Error(`${label}:${r.status}:${detail}`);
}

// =====================
// AUTH
// =====================

// Auth via login/password -> /shm/user/auth.cgi
export async function shmAuthWithPassword(login: string, password: string) {
  const body = toFormUrlEncoded({ login, password });

  return await shmFetch<{
    session_id?: string;
    user_id?: number;
    status?: number;
    msg?: string;
  }>(null, "user/auth.cgi", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

/**
 * Канон:
 * Telegram Mini App (WebApp) initData -> SHM -> session_id
 *
 * GET /shm/v1/telegram/webapp/auth?initData=...
 * Ответ: { session_id: string }
 */
export async function shmTelegramWebAppAuth(initData: string) {
  const clean = String(initData ?? "").trim();
  return await shmFetch<{ session_id?: string }>(
    null,
    "v1/telegram/webapp/auth",
    {
      method: "GET",
      query: { initData: clean },
    }
  );
}

/**
 * Канон:
 * Telegram Login Widget -> SHM -> session_id
 *
 * POST /shm/v1/telegram/web/auth
 * Ответ: { session_id: string }
 *
 * Payload: объект, который отдаёт Telegram widget (id, first_name, auth_date, hash, ...)
 * SHM сам валидирует подпись — мы не проверяем.
 */
export async function shmTelegramWebAuth(widgetPayload: Record<string, any>) {
  return await shmFetch<{ session_id?: string }>(null, "v1/telegram/web/auth", {
    method: "POST",
    body: widgetPayload ?? {},
  });
}

// =====================
// USER
// =====================

export async function shmGetMe(sessionId: string) {
  return await shmFetch<any>(sessionId, "v1/user", {
    method: "GET",
    query: { limit: 1, offset: 0 },
  });
}

export async function shmGetUserServices(
  sessionId: string,
  opts?: { limit?: number; offset?: number; filter?: unknown }
) {
  const limit = opts?.limit ?? 25;
  const offset = opts?.offset ?? 0;
  const filterObj = (opts?.filter ?? {}) as any;
  const filter = JSON.stringify(filterObj);

  return await shmFetch<any>(sessionId, "v1/user/service", {
    method: "GET",
    query: { limit, offset, filter },
  });
}

// =====================
// PAYMENTS
// =====================

export async function shmGetPaySystems(
  sessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return await shmFetch<any>(sessionId, "v1/user/pay/paysystems", {
    method: "GET",
    query: { limit, offset },
  });
}

export async function shmGetPayForecast(
  sessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  const limit = opts?.limit ?? 25;
  const offset = opts?.offset ?? 0;
  return await shmFetch<any>(sessionId, "v1/user/pay/forecast", {
    method: "GET",
    query: { limit, offset },
  });
}

export async function shmGetPays(
  sessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  const limit = opts?.limit ?? 25;
  const offset = opts?.offset ?? 0;
  return await shmFetch<any>(sessionId, "v1/user/pay", {
    method: "GET",
    query: { limit, offset },
  });
}

export async function shmGetWithdraws(
  sessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  const limit = opts?.limit ?? 25;
  const offset = opts?.offset ?? 0;
  return await shmFetch<any>(sessionId, "v1/user/withdraw", {
    method: "GET",
    query: { limit, offset },
  });
}

export async function shmDeleteAutopayment(sessionId: string) {
  return await shmFetch<any>(sessionId, "v1/user/autopayment", {
    method: "DELETE",
  });
}

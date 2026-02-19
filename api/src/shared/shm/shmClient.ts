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

function envBool(name: string, def = false): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const SHM_DEBUG = envBool("SHM_DEBUG", false) || envBool("AUTH_DEBUG", false);

function dbg(label: string, data: Record<string, any>) {
  if (!SHM_DEBUG) return;
  // Логируем коротко и безопасно (не выводим session-id/пароли)
  try {
    console.debug(
      JSON.stringify({
        level: "debug",
        time: Date.now(),
        shm: { label, ...data },
      })
    );
  } catch {
    // ignore
  }
}

function clip(s: string, n = 400) {
  const t = String(s ?? "");
  if (t.length <= n) return t;
  return t.slice(0, n) + "…";
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toFormUrlEncoded(obj: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) p.set(k, String(v ?? ""));
  return p.toString();
}

type ShmFetchOpts = {
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  body?: string | Record<string, any> | null;
  signal?: AbortSignal;
};

function sanitizeUrlForLog(u: URL): string {
  // Не логируем гигантские/чувствительные query целиком.
  // Оставим только ключи и первые символы значений.
  const safe = new URL(u.toString());
  for (const [k, v] of safe.searchParams.entries()) {
    const vv = String(v ?? "");
    // initData может быть большим — режем
    safe.searchParams.set(k, vv.length > 32 ? vv.slice(0, 32) + "…" : vv);
  }
  return safe.toString();
}

function isProbablyHtml(text: string, contentType: string) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const t = (text || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

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

  const method = String(opts?.method ?? "GET").toUpperCase();

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts?.headers ?? {}),
  };

  // session-id не логируем
  if (sessionId) headers["session-id"] = sessionId;

  let body: any = opts?.body ?? undefined;

  // если body объект — отправляем JSON
  if (body && typeof body === "object" && !(body instanceof String)) {
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const startedAt = Date.now();
  dbg("request", {
    method,
    url: sanitizeUrlForLog(url),
    hasSessionId: !!sessionId,
    contentType: headers["Content-Type"] || "",
  });

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: opts?.signal,
    });

    const contentType = String(res.headers.get("content-type") ?? "");
    const text = await res.text().catch(() => "");
    const ms = Date.now() - startedAt;

    // SHM иногда отдаёт JSON без корректного content-type — парсим мягко всегда
    const parsed = safeJsonParse(text);
    const json = parsed !== null ? (parsed as T) : undefined;

    dbg("response", {
      method,
      url: sanitizeUrlForLog(url),
      status: res.status,
      ok: res.ok,
      ms,
      contentType,
      looksHtml: isProbablyHtml(text, contentType),
      text: clip(text, 400),
      parsedJson: parsed !== null,
    });

    return { ok: res.ok, status: res.status, json, text };
  } catch (e: any) {
    const ms = Date.now() - startedAt;
    const msg = String(e?.message ?? e ?? "unknown_fetch_error");
    dbg("fetch_error", {
      method,
      url: sanitizeUrlForLog(url),
      ms,
      error: clip(msg, 300),
    });
    return { ok: false, status: 502, text: `fetch_error:${msg}` };
  }
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
  return await shmFetch<{ session_id?: string }>(null, "v1/telegram/webapp/auth", {
    method: "GET",
    query: { initData: clean },
  });
}

/**
 * Канон:
 * Telegram Login Widget -> SHM -> session_id
 *
 * POST /shm/v1/telegram/web/auth
 * Ответ: { session_id: string }
 *
 * Payload: объект, который отдаёт Telegram widget (id, first_name, auth_date, hash, ...).
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

// =====================
// TEMPLATE: ShpunApp
// =====================

/**
 * Унифицированный вызов TT2-шаблона приложения в биллинге.
 * ВАЖНО: отправляем form-urlencoded, потому что TT2 читает request.params надёжно в таком режиме.
 */
export async function shmShpunAppTemplate<T = any>(
  shmSessionId: string,
  action: string,
  extraParams?: Record<string, any>
) {
  const flat: Record<string, any> = {
    session_id: shmSessionId,
    action,
    ...(extraParams ?? {}),
  };

  return await shmFetch<T>(null, "v1/template/shpun_app", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toFormUrlEncoded(flat),
  });
}

/** Короткий хелпер: статус (в т.ч. password_set) */
export async function shmShpunAppStatus(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, "status");
}

/** Рефералы: статус (процент/кол-во/бонусы) */
export async function shmShpunAppReferralsStatus(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, "referrals.status");
}

/** Рефералы: список приглашённых (limit/offset) */
export async function shmShpunAppReferralsList(
  shmSessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  return await shmShpunAppTemplate<any>(shmSessionId, "referrals.list", {
    limit: opts?.limit ?? 7,
    offset: opts?.offset ?? 0,
  });
}

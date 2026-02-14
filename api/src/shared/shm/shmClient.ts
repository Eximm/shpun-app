// api/src/shared/shm/shmClient.ts

/**
 * Важно:
 * SHM_BASE должен указывать на /shm/ (с любым количеством слешей на конце — мы нормализуем)
 * Пример:
 *   SHM_BASE="https://bill.shpyn.online/shm/"
 */
function normalizeBase(raw: string) {
  // убираем пробелы и приводим к виду ".../shm/"
  let s = (raw || '').trim()
  if (!s) s = 'https://bill.shpyn.online/shm/'

  // если кто-то передал ".../shm" без слеша — добавим
  if (!s.endsWith('/')) s += '/'

  return s
}

const SHM_BASE = normalizeBase(process.env.SHM_BASE ?? 'https://bill.shpyn.online/shm/')

export type ShmResult<T = any> = {
  ok: boolean
  status: number
  json?: T
  text?: string
}

export function toFormUrlEncoded(obj: Record<string, string>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) p.set(k, v ?? '')
  return p.toString()
}

export async function shmFetch<T = any>(
  sessionId: string | null,
  path: string, // path должен быть БЕЗ ведущего слеша, например "v1/user"
  opts?: {
    method?: string
    query?: Record<string, string | number | boolean | null | undefined>
    headers?: Record<string, string>
    body?: string
  }
): Promise<ShmResult<T>> {
  // Если вдруг кто-то передал "/v1/user" — аккуратно нормализуем
  const cleanPath = path.startsWith('/') ? path.slice(1) : path

  const url = new URL(cleanPath, SHM_BASE)

  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts?.headers ?? {}),
  }

  if (sessionId) headers['session-id'] = sessionId

  const res = await fetch(url.toString(), {
    method: opts?.method ?? 'GET',
    headers,
    body: opts?.body,
  })

  const text = await res.text()

  // Пытаемся понять, JSON ли это
  let json: any = undefined
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(text)
    } catch {
      // бывают случаи "битого" json от backend — оставим text
    }
  } else {
    // fallback: иногда SHM может вернуть json без корректного content-type
    try {
      json = JSON.parse(text)
    } catch {
      // not json
    }
  }

  return { ok: res.ok, status: res.status, json, text }
}

// =====================
// AUTH
// =====================

// Auth via login/password -> /shm/user/auth.cgi
export async function shmAuthWithPassword(login: string, password: string) {
  const body = toFormUrlEncoded({ login, password })

  return await shmFetch<{ session_id?: string; user_id?: number; status?: number; msg?: string }>(
    null,
    'user/auth.cgi',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  )
}

/**
 * Auth via Telegram WebApp initData -> /shm/v1/telegram/webapp/auth?initData=...
 * По Swagger: GET /telegram/webapp/auth (security: [])
 * Ответ: { session_id: string }
 */
export async function shmAuthWithTelegramWebApp(initData: string) {
  const clean = String(initData ?? '').trim()

  return await shmFetch<{ session_id?: string; user_id?: number }>(
    null,
    'v1/telegram/webapp/auth',
    {
      method: 'GET',
      query: { initData: clean },
    }
  )
}

// =====================
// USER
// =====================

// GET /shm/v1/user (returns { data:[{...}], ... })
export async function shmGetMe(sessionId: string) {
  return await shmFetch<any>(sessionId, 'v1/user', {
    method: 'GET',
    query: { limit: 1, offset: 0 },
  })
}

// GET /shm/v1/user/service
export async function shmGetUserServices(
  sessionId: string,
  opts?: { limit?: number; offset?: number; filter?: any }
) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0

  // SHM ожидает filter как JSON-строку, как у тебя в логах: filter=%7B%7D
  const filterObj = opts?.filter ?? {}
  const filter = JSON.stringify(filterObj)

  return await shmFetch<any>(sessionId, 'v1/user/service', {
    method: 'GET',
    query: { limit, offset, filter },
  })
}

// =====================
// PAYMENTS
// =====================

export async function shmGetPaySystems(sessionId: string, opts?: { limit?: number; offset?: number }) {
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  return await shmFetch<any>(sessionId, 'v1/user/pay/paysystems', {
    method: 'GET',
    query: { limit, offset },
  })
}

export async function shmGetPayForecast(sessionId: string, opts?: { limit?: number; offset?: number }) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0
  return await shmFetch<any>(sessionId, 'v1/user/pay/forecast', {
    method: 'GET',
    query: { limit, offset },
  })
}

export async function shmGetPays(sessionId: string, opts?: { limit?: number; offset?: number }) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0
  return await shmFetch<any>(sessionId, 'v1/user/pay', {
    method: 'GET',
    query: { limit, offset },
  })
}

// ✅ NEW: withdrawals (charges)
// GET /shm/v1/user/withdraw
export async function shmGetWithdraws(sessionId: string, opts?: { limit?: number; offset?: number }) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0
  return await shmFetch<any>(sessionId, 'v1/user/withdraw', {
    method: 'GET',
    query: { limit, offset },
  })
}

export async function shmDeleteAutopayment(sessionId: string) {
  return await shmFetch<any>(sessionId, 'v1/user/autopayment', { method: 'DELETE' })
}

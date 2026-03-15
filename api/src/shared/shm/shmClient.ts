// FILE: api/src/shared/shm/shmClient.ts

export type ShmResult<T = unknown> = {
  ok: boolean
  status: number
  json?: T
  text?: string
}

function normalizeBase(raw: string) {
  let s = String(raw || '').trim()
  if (!s) s = 'https://bill.shpyn.online/shm/'
  if (!s.endsWith('/')) s += '/'
  return s
}

export const SHM_BASE = normalizeBase(process.env.SHM_BASE ?? 'https://bill.shpyn.online/shm/')

function envBool(name: string, def = false): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase()
  if (!v) return def
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

const SHM_DEBUG = envBool('SHM_DEBUG', false) || envBool('AUTH_DEBUG', false)

function dbg(label: string, data: Record<string, any>) {
  if (!SHM_DEBUG) return
  try {
    console.debug(
      JSON.stringify({
        level: 'debug',
        time: Date.now(),
        shm: { label, ...data },
      })
    )
  } catch {}
}

function clip(s: string, n = 400) {
  const t = String(s ?? '')
  if (t.length <= n) return t
  return t.slice(0, n) + '…'
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function toFormUrlEncoded(obj: Record<string, unknown>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) p.set(k, String(v ?? ''))
  return p.toString()
}

type ShmFetchOpts = {
  method?: string
  query?: Record<string, string | number | boolean | null | undefined>
  headers?: Record<string, string>
  body?: string | Record<string, any> | null
  signal?: AbortSignal
}

function sanitizeUrlForLog(u: URL): string {
  const safe = new URL(u.toString())
  for (const [k, v] of safe.searchParams.entries()) {
    const vv = String(v ?? '')
    safe.searchParams.set(k, vv.length > 32 ? vv.slice(0, 32) + '…' : vv)
  }
  return safe.toString()
}

function isProbablyHtml(text: string, contentType: string) {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('text/html')) return true
  const t = (text || '').trim().toLowerCase()
  return t.startsWith('<!doctype html') || t.startsWith('<html')
}

export async function shmFetch<T = unknown>(
  sessionId: string | null,
  path: string,
  opts?: ShmFetchOpts
): Promise<ShmResult<T>> {

  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const url = new URL(cleanPath, SHM_BASE)

  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }

  const method = String(opts?.method ?? 'GET').toUpperCase()

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts?.headers ?? {}),
  }

  if (sessionId) headers['session-id'] = sessionId

  let body: any = opts?.body ?? undefined

  if (body && typeof body === 'object' && !(body instanceof String)) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }

  const startedAt = Date.now()

  dbg('request', {
    method,
    url: sanitizeUrlForLog(url),
    hasSessionId: !!sessionId,
    contentType: headers['Content-Type'] || '',
  })

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: opts?.signal,
    })

    const contentType = String(res.headers.get('content-type') ?? '')
    const text = await res.text().catch(() => '')
    const ms = Date.now() - startedAt

    const parsed = safeJsonParse(text)
    const json = parsed !== null ? (parsed as T) : undefined

    dbg('response', {
      method,
      url: sanitizeUrlForLog(url),
      status: res.status,
      ok: res.ok,
      ms,
      contentType,
      looksHtml: isProbablyHtml(text, contentType),
      text: clip(text, 400),
      parsedJson: parsed !== null,
    })

    return { ok: res.ok, status: res.status, json, text }

  } catch (e: any) {

    const ms = Date.now() - startedAt
    const msg = String(e?.message ?? e ?? 'unknown_fetch_error')

    dbg('fetch_error', {
      method,
      url: sanitizeUrlForLog(url),
      ms,
      error: clip(msg, 300),
    })

    return { ok: false, status: 502, text: `fetch_error:${msg}` }
  }
}

export function assertOk<T>(r: ShmResult<T>, label = 'shm_request_failed'): T {
  if (r.ok && r.json !== undefined) return r.json
  const detail = String(r.text || '').slice(0, 200)
  throw new Error(`${label}:${r.status}:${detail}`)
}

export function assertOkVoid(r: ShmResult<any>, label = 'shm_request_failed'): void {
  if (r.ok) return
  const detail = String(r.text || '').slice(0, 200)
  throw new Error(`${label}:${r.status}:${detail}`)
}

function ipHeaders(clientIp?: string) {
  if (!clientIp) return undefined
  return {
    'X-Real-IP': clientIp,
    'X-Forwarded-For': clientIp,
  }
}

// =====================
// AUTH
// =====================

export async function shmAuthWithPassword(login: string, password: string, clientIp?: string) {

  const body = toFormUrlEncoded({ login, password })

  return await shmFetch<{
    session_id?: string
    user_id?: number
    status?: number
    msg?: string
  }>(null, 'user/auth.cgi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(ipHeaders(clientIp) ?? {})
    },
    body,
  })
}

export async function shmTelegramWebAppAuth(initData: string, clientIp?: string) {

  const clean = String(initData ?? '').trim()

  return await shmFetch<{ session_id?: string }>(null, 'v1/telegram/webapp/auth', {
    method: 'GET',
    headers: ipHeaders(clientIp),
    query: { initData: clean },
  })
}

export async function shmTelegramWebAuth(widgetPayload: Record<string, any>, clientIp?: string) {

  return await shmFetch<{ session_id?: string }>(null, 'v1/telegram/web/auth', {
    method: 'POST',
    headers: ipHeaders(clientIp),
    body: widgetPayload ?? {},
  })
}

// =====================
// USER
// =====================

export async function shmGetMe(sessionId: string) {
  return await shmFetch<any>(sessionId, 'v1/user', {
    method: 'GET',
    query: { limit: 1, offset: 0 },
  })
}

export async function shmGetUserServices(sessionId: string, opts?: { limit?: number; offset?: number; filter?: unknown }) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0
  const filterObj = (opts?.filter ?? {}) as any
  const filter = JSON.stringify(filterObj)

  return await shmFetch<any>(sessionId, 'v1/user/service', {
    method: 'GET',
    query: { limit, offset, filter },
  })
}

export async function shmStopUserService(sessionId: string, user_service_id: number) {
  const usi = Number(user_service_id ?? 0)
  return await shmFetch<any>(sessionId, 'v1/user/service/stop', {
    method: 'POST',
    body: { user_service_id: usi },
  })
}

export async function shmDeleteUserService(sessionId: string, user_service_id: number) {
  const usi = Number(user_service_id ?? 0)
  return await shmFetch<any>(sessionId, 'v1/user/service', {
    method: 'DELETE',
    query: { user_service_id: usi },
  })
}

// =====================
// SERVICE ORDER
// =====================

export type ShmServiceOrderItem = {
  service_id: number
  category: string
  name: string
  descr: string | null
  cost: number
  real_cost?: number
  period: number | string
  allow_to_order?: 0 | 1
  deleted?: 0 | 1
  config?: Record<string, any>
  [k: string]: any
}

export type ShmGetServiceOrderResp = {
  status?: number
  data?: ShmServiceOrderItem[]
  error?: string
  [k: string]: any
}

export async function shmGetServiceOrder(sessionId: string) {
  return await shmFetch<ShmGetServiceOrderResp>(sessionId, 'v1/service/order', {
    method: 'GET',
  })
}

export type ShmCreateServiceOrderResp = {
  status?: number | string
  data?: any
  error?: string
  message?: string
  [k: string]: any
}

export async function shmCreateServiceOrder(sessionId: string, service_id: number) {
  return await shmFetch<ShmCreateServiceOrderResp>(sessionId, 'v1/service/order', {
    method: 'PUT',
    body: { service_id },
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

export async function shmGetWithdraws(sessionId: string, opts?: { limit?: number; offset?: number }) {
  const limit = opts?.limit ?? 25
  const offset = opts?.offset ?? 0
  return await shmFetch<any>(sessionId, 'v1/user/withdraw', {
    method: 'GET',
    query: { limit, offset },
  })
}

export async function shmDeleteAutopayment(sessionId: string) {
  return await shmFetch<any>(sessionId, 'v1/user/autopayment', {
    method: 'DELETE',
  })
}

// =====================
// STORAGE (text/plain)
// =====================

/**
 * Read storage item as plain text via:
 * GET /shm/v1/storage/manage/{name}
 * (Swagger: returns text/plain)
 */
export async function shmStorageManageGetText(sessionId: string, name: string) {
  const n = String(name ?? '').trim()
  return await shmFetch<any>(sessionId, `v1/storage/manage/${encodeURIComponent(n)}`, {
    method: 'GET',
    headers: { Accept: 'text/plain' },
  })
}

// =====================
// TEMPLATE: ShpunApp
// =====================

export async function shmShpunAppTemplate<T = any>(
  shmSessionId: string,
  action: string,
  extraParams?: Record<string, any>
) {
  const flat: Record<string, any> = {
    session_id: shmSessionId,
    action,
    ...(extraParams ?? {}),
  }

  return await shmFetch<T>(null, 'v1/template/shpun_app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toFormUrlEncoded(flat),
  })
}

export async function shmShpunAppStatus(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'status')
}

export async function shmShpunAppAdminStatus(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'admin.status')
}

export async function shmShpunAppReferralsStatus(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'referrals.status')
}

export async function shmShpunAppReferralsList(
  shmSessionId: string,
  opts?: { limit?: number; offset?: number }
) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'referrals.list', {
    limit: opts?.limit ?? 7,
    offset: opts?.offset ?? 0,
  })
}

export async function shmShpunAppReferralsLink(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'referrals.link')
}

/**
 * ✅ NEW: Payments requisites via shpun_app template (private, authed)
 *
 * В TT2 шапке shpun_app нужно реализовать action: "payments.requisites"
 * который вернёт JSON с ok=1 и данными реквизитов.
 *
 * Пример ожидаемого ответа:
 * { ok:1, requisites:{ bank, holder, card, comment, title, updated_at } }
 */
export async function shmShpunAppPaymentsRequisites(shmSessionId: string) {
  return await shmShpunAppTemplate<any>(shmSessionId, 'payments.requisites')
}

// =====================
// ROUTERS via ShpunApp template
// =====================

export type ShpunAppRouterItem = {
  code?: string
  clean_code?: string
  status?: string
  created_at?: number
  last_seen_at?: number
}

export type ShpunAppRouterListResp = {
  ok?: number
  ver?: string
  action?: string
  routers?: ShpunAppRouterItem[]
  error?: string
  [k: string]: any
}

export type ShpunAppRouterBindResp = {
  ok?: number
  ver?: string
  action?: string
  clean_code?: string
  pair_key?: string
  error?: string
  [k: string]: any
}

export type ShpunAppRouterUnbindResp = {
  ok?: number
  ver?: string
  action?: string
  clean_code?: string
  unbound?: number
  error?: string
  [k: string]: any
}

export async function shmShpunAppRouterList(shmSessionId: string, usi: number) {
  return await shmShpunAppTemplate<ShpunAppRouterListResp>(shmSessionId, 'router.list', {
    usi,
    user_service_id: usi,
    us_id: usi,
  })
}

export async function shmShpunAppRouterBind(shmSessionId: string, usi: number, code: string, tg_id?: string | number) {
  return await shmShpunAppTemplate<ShpunAppRouterBindResp>(shmSessionId, 'router.bind', {
    usi,
    user_service_id: usi,
    us_id: usi,
    code,
    ...(tg_id != null ? { tg_id } : {}),
  })
}

export async function shmShpunAppRouterUnbind(shmSessionId: string, usi: number, code: string, tg_id?: string | number) {
  return await shmShpunAppTemplate<ShpunAppRouterUnbindResp>(shmSessionId, 'router.unbind', {
    usi,
    user_service_id: usi,
    us_id: usi,
    code,
    ...(tg_id != null ? { tg_id } : {}),
  })
}

// =====================
// CONNECT via ShpunApp template (универсально)
// =====================

export type ShpunAppConnectGetResp = {
  ok?: number
  ver?: string
  action?: string
  kind?: string
  usi?: number
  subscription_url?: string
  config_url?: string
  qr_payload?: string
  error?: string
  [k: string]: any
}

export async function shmShpunAppConnectGet(shmSessionId: string, usi: number, kind: string) {
  return await shmShpunAppTemplate<ShpunAppConnectGetResp>(shmSessionId, 'connect.get', {
    usi,
    user_service_id: usi,
    us_id: usi,
    kind,
  })
}

export function shmShpunAppMarzbanGet(shmSessionId: string, usi: number) {
  return shmShpunAppConnectGet(shmSessionId, usi, 'marzban')
}

export function shmShpunAppAmneziaWGGet(shmSessionId: string, usi: number) {
  return shmShpunAppConnectGet(shmSessionId, usi, 'amneziawg')
}
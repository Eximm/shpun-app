import crypto from 'node:crypto'

export type TelegramInitDataUser = {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

export type VerifyInitDataOk = {
  ok: true
  data: Record<string, string>
  user: TelegramInitDataUser | null
}

export type VerifyInitDataFail = {
  ok: false
  error: string
}

export type VerifyInitDataResult = VerifyInitDataOk | VerifyInitDataFail

function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData)
  const obj: Record<string, string> = {}
  for (const [k, v] of params.entries()) obj[k] = v
  return obj
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

/**
 * Telegram WebApp initData verification
 * Spec: data_check_string + secret_key=HMAC_SHA256("WebAppData", bot_token)
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60
): VerifyInitDataResult {
  if (!initData) return { ok: false, error: 'initData is empty' }
  if (!botToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is missing on server' }

  const data = parseInitData(initData)

  const receivedHash = data.hash
  if (!receivedHash) return { ok: false, error: 'hash is missing' }

  const authDate = Number(data.auth_date || '0')
  if (!authDate) return { ok: false, error: 'auth_date is missing' }

  const now = Math.floor(Date.now() / 1000)
  const age = now - authDate
  if (age < -60) return { ok: false, error: 'auth_date is in the future' }
  if (age > maxAgeSeconds) return { ok: false, error: 'initData is too old' }

  // data_check_string: sort keys excluding hash
  const pairs: string[] = []
  for (const k of Object.keys(data).sort()) {
    if (k === 'hash') continue
    pairs.push(`${k}=${data[k]}`)
  }
  const dataCheckString = pairs.join('\n')

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  const a = Buffer.from(computedHash, 'hex')
  const b = Buffer.from(receivedHash, 'hex')
  if (a.length !== b.length) return { ok: false, error: 'hash length mismatch' }

  const ok = crypto.timingSafeEqual(a, b)
  if (!ok) return { ok: false, error: 'hash mismatch' }

  const user = data.user ? safeJsonParse<TelegramInitDataUser>(data.user) : null

  return { ok: true, data, user }
}

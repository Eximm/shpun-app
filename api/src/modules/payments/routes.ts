// api/src/modules/payments/routes.ts

import type { FastifyInstance, FastifyRequest } from 'fastify'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { getSessionFromRequest } from '../../shared/session/sessionStore.js'
import { shmFetch, shmGetMe } from '../../shared/shm/shmClient.js'

type ReceiptRecord = {
  id: string
  user_id: number
  created_at: string
  amount: number
  filename: string
  mime: string
  size: number
  status: 'RECEIVED' | 'SENT_ADMIN' | 'SENT_USER' | 'ERROR'
  error?: string
  tg_admin?: { ok: boolean; message_id?: number; description?: string }
  tg_user?: { ok: boolean; message_id?: number; description?: string }
}

const DATA_DIR = process.env.RECEIPTS_DIR || path.resolve(process.cwd(), 'data', 'receipts')

// ✅ template name in SHM (you create it in billing)
const REQUISITES_TEMPLATE = String(process.env.PAYMENTS_REQUISITES_TEMPLATE || 'billing_requisites').trim()

function nowIso() {
  return new Date().toISOString()
}

function safeExtFromMime(mime: string) {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  return 'bin'
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const s = await fs.readFile(file, 'utf8')
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: any) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
}

async function sendTelegramDocument(params: {
  botToken: string
  chatId: string | number
  threadId?: string | number
  caption: string
  filePath: string
  filename: string
}) {
  const { botToken, chatId, threadId, caption, filePath, filename } = params
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`

  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  if (threadId) fd.append('message_thread_id', String(threadId))
  fd.append('caption', caption)

  const buf = await fs.readFile(filePath)
  const blob = new Blob([new Uint8Array(buf)])
  // @ts-ignore - filename supported by undici FormData
  fd.append('document', blob, filename)

  const res = await fetch(url, { method: 'POST', body: fd as any })
  const json = await res.json().catch(() => null)
  return json as any
}

function requireSession(req: FastifyRequest, reply: any) {
  const s = getSessionFromRequest(req)
  if (!s) {
    reply.code(401).send({ ok: false, error: 'not_authenticated' })
    return null
  }
  return s
}

function requireUserId(s: any, reply: any) {
  const userId = Number(s?.shmUserId ?? 0)
  if (!userId) {
    reply.code(401).send({ ok: false, error: 'not_authenticated' })
    return null
  }
  return userId
}

function isOkFlag(v: any) {
  return v === true || v === 1 || v === '1' || v === 'true'
}

function toStr(v: any, def = '') {
  const s = String(v ?? '').trim()
  return s || def
}

function pickObj(x: any, keys: string[]) {
  for (const k of keys) {
    const v = x?.[k]
    if (v && typeof v === 'object') return v
  }
  return null
}

/**
 * ✅ Private template call (auth ONLY via header "session-id")
 * SHM отвечает 401 если пытаться авторизоваться через query.
 */
async function shmPrivateTemplateGet(sessionId: string, name: string, params?: Record<string, any>) {
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new Error('bad_template_name')

  return await shmFetch<any>(sessionId, `v1/template/${encodeURIComponent(cleanName)}`, {
    method: 'GET',
    query: {
      format: 'json',
      ...(params ?? {}),
    },
  })
}

export async function paymentsRoutes(app: FastifyInstance) {
  // GET /api/payments/paysystems
  app.get('/payments/paysystems', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    const r = await shmFetch<any>(s.shmSessionId, 'v1/user/pay/paysystems', {
      method: 'GET',
      query: { limit: 50, offset: 0 },
    })

    if (!r.ok) {
      return reply.code(r.status).send({ ok: false, error: 'shm_error', raw: r.json ?? r.text })
    }

    const items = (r.json?.data || []) as any[]
    return reply.send({ ok: true, items, raw: r.json })
  })

  // GET /api/payments/forecast
  app.get('/payments/forecast', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    const r = await shmFetch<any>(s.shmSessionId, 'v1/user/pay/forecast', {
      method: 'GET',
      query: { limit: 25, offset: 0 },
    })

    if (!r.ok) {
      return reply.code(r.status).send({ ok: false, error: 'shm_error', raw: r.json ?? r.text })
    }

    return reply.send({ ok: true, raw: r.json })
  })

  // ✅ GET /api/payments/requisites
  app.get('/payments/requisites', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    try {
      const r = await shmPrivateTemplateGet(s.shmSessionId, REQUISITES_TEMPLATE)
      if (!r.ok) {
        return reply.code(r.status || 502).send({ ok: false, error: 'shm_error', raw: r.json ?? r.text })
      }

      const j: any = r.json ?? {}
      if (!isOkFlag(j?.ok)) {
        const err = toStr(j?.error || j?.message, 'requisites_not_configured')
        return reply.send({ ok: false, error: err, raw: j })
      }

      const item = pickObj(j, ['item', 'requisites']) || pickObj(j?.data, ['item', 'requisites']) || null
      if (!item) return reply.send({ ok: false, error: 'requisites_not_configured', raw: j })

      const requisites = {
        title: toStr((item as any)?.title || (item as any)?.name, 'Перевод по реквизитам'),
        bank: toStr((item as any)?.bank),
        holder: toStr((item as any)?.holder || (item as any)?.recipient),
        card: toStr((item as any)?.card || (item as any)?.pan),
        comment: toStr((item as any)?.comment || (item as any)?.note),
        updated_at: toStr((item as any)?.updated_at || j?.updated_at || j?.ts || ''),
      }

      const hasAny = Boolean(requisites.holder || requisites.card)
      if (!hasAny) return reply.send({ ok: false, error: 'requisites_not_configured', raw: j })

      return reply.send({ ok: true, requisites })
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e?.message || 'requisites_failed' })
    }
  })

  // DELETE /api/payments/autopayment
  app.delete('/payments/autopayment', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    const r = await shmFetch<any>(s.shmSessionId, 'v1/user/autopayment', { method: 'DELETE' })
    if (!r.ok) return reply.code(r.status).send({ ok: false, error: 'shm_error', raw: r.json ?? r.text })
    return reply.send({ ok: true })
  })

  // GET /api/payments/receipts
  app.get('/payments/receipts', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    const userId = requireUserId(s, reply)
    if (!userId) return

    const idxFile = path.join(DATA_DIR, String(userId), 'index.json')
    const list = await readJson<ReceiptRecord[]>(idxFile, [])
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return reply.send({ ok: true, items: list })
  })

  // ✅ POST /api/payments/receipt — fix "hang" by consuming file stream inside parts loop
  app.post('/payments/receipt', async (req, reply) => {
    const s = requireSession(req, reply)
    if (!s) return

    const userId = requireUserId(s, reply)
    if (!userId) return

    let amountRaw = ''

    // prepare file save slot
    const id = crypto.randomBytes(12).toString('hex')
    const userDir = path.join(DATA_DIR, String(userId))
    await ensureDir(userDir)

    let filePath = ''
    let filename = ''
    let mime = 'application/octet-stream'

    const parts = (req as any).parts()

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'amount') amountRaw = String(part.value ?? '').trim()
        continue
      }

      if (part.type === 'file' && part.fieldname === 'file') {
        mime = String(part.mimetype || 'application/octet-stream')
        const ext = safeExtFromMime(mime)

        filename = `receipt_${id}.${ext}`
        filePath = path.join(userDir, filename)

        // ✅ IMPORTANT: consume the file stream NOW (otherwise request may hang)
        await new Promise<void>((resolve, reject) => {
          const ws = fssync.createWriteStream(filePath)
          part.file.pipe(ws)
          part.file.on('error', reject)
          ws.on('error', reject)
          ws.on('finish', () => resolve())
        })

        continue
      }

      // unknown parts: ignore
    }

    if (!filePath || !filename) return reply.code(400).send({ ok: false, error: 'file_required' })

    const amount = Math.round(Number(String(amountRaw).replace(',', '.')))
    if (!Number.isFinite(amount) || amount < 1) {
      // cleanup saved file if amount is bad
      try { await fs.unlink(filePath) } catch {}
      return reply.code(400).send({ ok: false, error: 'bad_amount' })
    }

    const st = await fs.stat(filePath)

    const record: ReceiptRecord = {
      id,
      user_id: userId,
      created_at: nowIso(),
      amount,
      filename,
      mime,
      size: st.size,
      status: 'RECEIVED',
    }

    let shmUser: any = null
    try {
      const me = await shmGetMe(s.shmSessionId)
      if (me.ok) shmUser = me.json?.data?.[0] ?? null
    } catch {}

    const fullName = String(shmUser?.full_name || 'Client')
    const login = String(shmUser?.login || '')
    const tgId = shmUser?.settings?.telegram?.id || shmUser?.settings?.telegram?.user_id || null
    const tgLogin = shmUser?.settings?.telegram?.login || ''

    const botToken = String(process.env.TG_BOT_TOKEN || '').trim()
    const adminChatId = String(process.env.RECEIPTS_CHAT_ID || '').trim()
    const adminThreadIdRaw = String(process.env.RECEIPTS_THREAD_ID || '').trim()
    const adminThreadId = adminThreadIdRaw ? Number(adminThreadIdRaw) : undefined

    try {
      if (botToken && adminChatId) {
        const captionAdmin =
          `🧾 Квитанция (перевод по реквизитам)\n` +
          `Клиент: ${fullName}\n` +
          `ID: ${userId}\n` +
          (login ? `Логин: ${login}\n` : '') +
          (tgLogin ? `TG: @${tgLogin}\n` : '') +
          `Сумма: ${amount} ₽\n` +
          `ISO: ${record.created_at}`

        const tgRes = await sendTelegramDocument({
          botToken,
          chatId: adminChatId,
          threadId: adminThreadId,
          caption: captionAdmin,
          filePath,
          filename,
        })

        record.tg_admin = {
          ok: !!tgRes?.ok,
          message_id: tgRes?.result?.message_id,
          description: tgRes?.description,
        }

        record.status = tgRes?.ok ? 'SENT_ADMIN' : 'ERROR'
        if (!tgRes?.ok) record.error = tgRes?.description || 'telegram_admin_failed'
      }
    } catch (e: any) {
      record.status = 'ERROR'
      record.error = e?.message || 'telegram_admin_exception'
    }

    try {
      if (botToken && tgId) {
        const captionUser =
          `🧾 Квитанция отправлена на проверку\n` +
          `Сумма: ${amount} ₽\n\n` +
          `Мы уведомим, когда платеж будет зачислен.`

        const tgResU = await sendTelegramDocument({
          botToken,
          chatId: tgId,
          caption: captionUser,
          filePath,
          filename,
        })

        record.tg_user = {
          ok: !!tgResU?.ok,
          message_id: tgResU?.result?.message_id,
          description: tgResU?.description,
        }

        if (tgResU?.ok && record.status !== 'ERROR') record.status = 'SENT_USER'
      }
    } catch {
      // ignore
    }

    const idxFile = path.join(userDir, 'index.json')
    const list = await readJson<ReceiptRecord[]>(idxFile, [])
    list.push(record)
    await writeJson(idxFile, list)

    return reply.send({ ok: true, id, record })
  })
}
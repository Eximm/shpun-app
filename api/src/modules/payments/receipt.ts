// api/src/modules/payments/receipt.ts

import type { FastifyInstance } from 'fastify'
import { getSession } from '../../shared/session/sessionStore.js'

const TG_TOKEN = process.env.TG_BOT_TOKEN || ''
const RECEIPTS_CHAT_ID = Number(process.env.TG_RECEIPTS_CHAT_ID || '0')
const RECEIPTS_THREAD_ID = Number(process.env.TG_RECEIPTS_THREAD_ID || '0')

function getShmSessionId(req: any) {
  // ✅ getSession теперь ожидает REQUEST (cookie sid достаётся внутри sessionStore)
  const s = getSession(req)
  return (s as any)?.shmSessionId ?? null
}

function fmtTs(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function tgSendDocument(args: {
  chat_id: string | number
  caption: string
  filename: string
  buffer: Buffer
  mime?: string
  thread_id?: number
}) {
  if (!TG_TOKEN) throw new Error('TG_BOT_TOKEN is not set')

  const fd = new FormData()
  fd.append('chat_id', String(args.chat_id))
  if (args.thread_id && args.thread_id > 0) fd.append('message_thread_id', String(args.thread_id))
  fd.append('caption', args.caption)

  // ✅ TS-safe: BlobPart не принимает Buffer в типах, поэтому конвертим в Uint8Array
  const u8 = new Uint8Array(args.buffer)
  const blob = new Blob([u8], { type: args.mime || 'application/octet-stream' })
  // @ts-ignore — filename поддерживается в undici FormData
  fd.append('document', blob, args.filename)

  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
    method: 'POST',
    body: fd as any,
  })

  const j: any = await r.json().catch(() => null)

  if (!r.ok || !j?.ok) {
    throw new Error(j?.description || `Telegram sendDocument failed (${r.status})`)
  }

  return j
}

export async function paymentsReceiptRoutes(app: FastifyInstance) {
  app.post('/payments/receipt', async (req, reply) => {
    const shmSessionId = getShmSessionId(req)
    if (!shmSessionId) return reply.code(401).send({ ok: false, error: 'not_authenticated' })

    const mp = await (req as any).file()
    if (!mp) return reply.code(400).send({ ok: false, error: 'no_file' })

    // multipart поля лежат в mp.fields
    const amountRaw = String(mp?.fields?.amount?.value ?? '').trim()
    const safeAmount = /^\d+$/.test(amountRaw) ? amountRaw : '—'

    const buf: Buffer = await mp.toBuffer()
    const filename = mp.filename || 'receipt'
    const mime = mp.mimetype || 'application/octet-stream'

    const captionAdmin =
      `🧾 Квитанция из Shpun App\n` +
      `Сумма: ${safeAmount} ₽\n` +
      `Время: ${fmtTs()}\n` +
      `Источник: PWA`

    let tgOk = false
    let tgError: string | null = null

    try {
      if (!RECEIPTS_CHAT_ID) throw new Error('TG_RECEIPTS_CHAT_ID is not set')
      await tgSendDocument({
        chat_id: RECEIPTS_CHAT_ID,
        thread_id: RECEIPTS_THREAD_ID > 0 ? RECEIPTS_THREAD_ID : undefined,
        caption: captionAdmin,
        filename,
        buffer: buf,
        mime,
      })
      tgOk = true
    } catch (e: any) {
      tgError = e?.message || 'telegram_error'
    }

    // Даже если Telegram временно недоступен — квитанция дошла до нашего сервера.
    // Следующий шаг: хранить на сервере + отдавать в историю платежей в приложении.
    return reply.send({ ok: true, tgOk, tgError })
  })
}

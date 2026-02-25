// api/src/modules/notifications/inbox.ts

export type BillingPushEvent = {
  event_id: string
  ts?: number
  type?: string
  level?: 'info' | 'success' | 'error'
  title?: string
  message?: string
  target?: 'all' | 'user'
  user_id?: number
}

type StoredEvent = BillingPushEvent & { ts: number }

const MAX_EVENTS = 2000
const events: StoredEvent[] = []
const seen = new Set<string>()

export function putEvent(e: BillingPushEvent) {
  const id = String(e?.event_id || '').trim()
  if (!id) return { ok: false as const, error: 'missing_event_id' }

  if (seen.has(id)) return { ok: true as const, dedup: true as const }

  const ts = Number.isFinite(Number(e.ts)) ? Number(e.ts) : Math.floor(Date.now() / 1000)

  const ev: StoredEvent = {
    ...e,
    event_id: id,
    ts,
  }

  events.push(ev)
  seen.add(id)

  if (events.length > MAX_EVENTS) {
    const drop = events.splice(0, events.length - MAX_EVENTS)
    for (const d of drop) seen.delete(d.event_id)
  }

  return { ok: true as const, dedup: false as const }
}

export function listEvents(params: { afterTs?: number; userId?: number }) {
  const after = Number.isFinite(Number(params.afterTs)) ? Number(params.afterTs) : 0
  const uid = params.userId ?? 0

  const items = events.filter((e) => {
    if (e.ts <= after) return false
    if (e.target === 'all' || !e.target) return true
    if (e.target === 'user') return !!uid && e.user_id === uid
    return true
  })

  const nextCursor = items.length ? items[items.length - 1].ts : after
  return { items, nextCursor }
}
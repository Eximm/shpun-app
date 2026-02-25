import { useEffect, useRef } from 'react'
import { apiFetch } from '../../shared/api/client'
import { toast } from '../../shared/ui/toast'

type BillingPushEvent = {
  event_id: string
  ts: number
  level?: 'info' | 'success' | 'error'
  title?: string
  message?: string
}

type Resp = { ok: true; items: BillingPushEvent[]; nextCursor: number }

const CURSOR_KEY = 'notif.cursor.ts.v1'

function readCursor(): number {
  try {
    const v = Number(localStorage.getItem(CURSOR_KEY) || 0)
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

function saveCursor(ts: number) {
  try {
    localStorage.setItem(CURSOR_KEY, String(ts || 0))
  } catch {
    // ignore
  }
}

export function useBillingNotifications(enabled: boolean) {
  const cursorRef = useRef<number>(readCursor())
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    let stopped = false

    async function tick() {
      if (stopped) return

      try {
        const after = cursorRef.current || 0
        const r = await apiFetch<Resp>(`/notifications?afterTs=${encodeURIComponent(String(after))}`)

        const next = Number(r.nextCursor || after || 0)
        if (Number.isFinite(next) && next >= after) {
          cursorRef.current = next
          saveCursor(next)
        }

        for (const ev of r.items || []) {
          const title = ev.title || 'Уведомление'
          const desc = ev.message || ''
          const lvl = ev.level || 'info'

          if (lvl === 'success') toast.success(title, { description: desc })
          else if (lvl === 'error') toast.error(title, { description: desc })
          else toast.info(title, { description: desc })
        }
      } catch {
        // тихо: уведомления не должны ломать UI
      } finally {
        if (!stopped) timerRef.current = window.setTimeout(tick, 8000) // 8s
      }
    }

    tick()

    return () => {
      stopped = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [enabled])
}
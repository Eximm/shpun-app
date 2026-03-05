import { useEffect, useMemo, useState } from "react"
import { toast } from "../../shared/ui/toast"
import {
  enablePushByUserGesture,
  ensurePushSubscribed,
  getPushState,
  isPushDisabledByUser,
  isPushSupported,
  isStandalonePwa,
} from "./push"

const LS_SEEN_KEY = "push.onboarding.seen.v1"

function readSeen(): boolean {
  try {
    return localStorage.getItem(LS_SEEN_KEY) === "1"
  } catch {
    return false
  }
}

function writeSeen() {
  try {
    localStorage.setItem(LS_SEEN_KEY, "1")
  } catch {}
}

export function usePushOnboarding(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [state, setState] = useState<{
    supported: boolean
    permission: NotificationPermission | "unsupported"
    hasSubscription: boolean
    standalone: boolean
  }>({
    supported: false,
    permission: "unsupported",
    hasSubscription: false,
    standalone: false
  })

  const shouldShow = useMemo(() => {
    if (!enabled) return false
    if (readSeen()) return false

    if (!isPushSupported()) return false
    if (isPushDisabledByUser()) return false

    const enabledNow =
      state.permission === "granted" && state.hasSubscription

    if (enabledNow) return false

    return true
  }, [enabled, state.permission, state.hasSubscription])

  async function refresh() {
    try {
      const s = await getPushState()
      setState(s)
    } catch {}
  }

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled])

  useEffect(() => {
    if (shouldShow) {
      setTimeout(() => setOpen(true), 1200)
    }
  }, [shouldShow])

  async function accept() {
    if (busy) return

    setBusy(true)

    try {
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description: "Откройте меню браузера и выберите «Установить приложение»"
        })

        writeSeen()
        setOpen(false)
        return
      }

      const ok = await enablePushByUserGesture()

      if (ok) {
        await ensurePushSubscribed()

        toast.success("Уведомления включены", {
          description: "Теперь вы будете получать важные события"
        })

        writeSeen()
        setOpen(false)
      } else {
        toast.info("Уведомления не включены")

        writeSeen()
        setOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    writeSeen()
    setOpen(false)
  }

  return {
    open,
    busy,
    state,
    accept,
    dismiss
  }
}
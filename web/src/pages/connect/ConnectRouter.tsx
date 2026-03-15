import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "../../shared/api/client"
import { toast } from "../../shared/ui/toast"
import { useI18n } from "../../shared/i18n"

type ApiRouterItem = {
  code?: string
  clean_code?: string
  status?: string
  created_at?: number
  last_seen_at?: number

  cleanCode?: string
  createdAt?: number
  lastSeenAt?: number
  router_code?: string
}

type Props = {
  usi: number
  onDone?: () => void
}

function fmtTs(ts?: number) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString()
}

function normOne(x: any): ApiRouterItem | null {
  if (!x || typeof x !== "object") return null
  return {
    code: x.code ?? x.router_code ?? x.routerCode ?? undefined,
    clean_code: x.clean_code ?? x.cleanCode ?? undefined,
    status: x.status ?? x.state ?? undefined,
    created_at: x.created_at ?? x.createdAt ?? undefined,
    last_seen_at: x.last_seen_at ?? x.lastSeenAt ?? undefined,
  }
}

function extractRouters(resp: any): ApiRouterItem[] {
  const r = resp ?? {}
  const arr = r.routers ?? r.items ?? r.data ?? r.list ?? r.result ?? null
  if (Array.isArray(arr)) {
    return arr.map(normOne).filter(Boolean) as ApiRouterItem[]
  }

  const one =
    r.router ??
    r.binding ??
    r.bound ??
    r.item ??
    (r.data && !Array.isArray(r.data) ? r.data : null)

  const n = normOne(one)
  return n ? [n] : []
}

function toClean8(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
}

function toPretty9(raw: string) {
  const c = toClean8(raw)
  if (!c) return ""
  if (c.length <= 4) return c
  return c.slice(0, 4) + "-" + c.slice(4)
}

function statusView(status?: string) {
  const s = String(status || "").trim().toLowerCase()

  if (!s) return { label: "unknown", tone: "muted" as const }

  if (s === "bound" || s === "active" || s === "ok")
    return { label: s, tone: "good" as const }

  if (s === "unbound" || s === "removed" || s === "none" || s === "new")
    return { label: s, tone: "muted" as const }

  if (s === "error" || s === "fail" || s === "failed")
    return { label: s, tone: "bad" as const }

  return { label: s, tone: "muted" as const }
}

export default function ConnectRouter({ usi, onDone }: Props) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [routers, setRouters] = useState<ApiRouterItem[]>([])
  const [code, setCode] = useState("")

  const first = routers?.[0]

  const shownClean = String(first?.clean_code || first?.cleanCode || "").trim()
  const shownCode = String(first?.code || first?.router_code || "").trim()

  const shownPretty = useMemo(() => {
    const base = shownClean || shownCode
    return base ? toPretty9(base) : ""
  }, [shownClean, shownCode])

  const st = useMemo(() => statusView(first?.status), [first?.status])

  const hasBound = useMemo(() => {
    if (!first) return false

    const normalized = String(first.status || "").toLowerCase()

    if (normalized === "bound" || normalized === "active" || normalized === "ok")
      return true

    if (
      normalized === "unbound" ||
      normalized === "removed" ||
      normalized === "none" ||
      normalized === "new"
    )
      return false

    return !!(shownClean || shownCode)
  }, [first, shownClean, shownCode])

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent

    setLoading(true)
    setError(null)

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/router`,
        { method: "GET" }
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setRouters(extractRouters(r))

      if (!silent) {
        toast.info(t("router.status_updated"), {
          description: t("router.status_updated_desc"),
        })
      }
    } catch (e: any) {
      const msg = e?.message || t("router.load_error")

      setError(msg)
      setRouters([])

      if (!silent) {
        toast.error(t("router.status_error"), {
          description: msg,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  async function bind() {
    const clean = toClean8(code)

    if (!clean) return

    if (clean.length !== 8) {
      const msg = t("router.code_invalid_desc")

      setError(msg)

      toast.error(t("router.code_invalid"), { description: msg })

      return
    }

    setBusy(true)
    setError(null)

    toast.info(t("router.binding"), {
      description: t("router.binding_desc"),
    })

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/router/bind`,
        {
          method: "POST",
          body: { code: clean },
        } as any
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      setCode("")
      await load({ silent: true })

      onDone?.()

      toast.success(t("router.bind_ok"), {
        description: t("router.bind_ok_desc"),
      })
    } catch (e: any) {
      const msg = e?.message || t("router.bind_error")

      setError(msg)

      toast.error(t("router.bind_error"), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  async function unbind() {
    const v = String(
      first?.clean_code ||
        first?.cleanCode ||
        first?.code ||
        first?.router_code ||
        ""
    ).trim()

    const clean = toClean8(v)

    if (!clean) return

    setBusy(true)
    setError(null)

    toast.info(t("router.unbinding"), {
      description: t("router.unbinding_desc"),
    })

    try {
      const r = (await apiFetch(
        `/services/${encodeURIComponent(String(usi))}/router/unbind`,
        {
          method: "POST",
          body: { code: clean },
        } as any
      )) as any

      if (r && (r.ok === false || r.ok === 0) && (r.error || r.message)) {
        throw new Error(String(r.error || r.message))
      }

      await load({ silent: true })

      onDone?.()

      toast.success(t("router.unbind_ok"), {
        description: t("router.unbind_ok_desc"),
      })
    } catch (e: any) {
      const msg = e?.message || t("router.unbind_error")

      setError(msg)

      toast.error(t("router.unbind_error"), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load({ silent: true })
  }, [usi])

  const inputValue = toPretty9(code)
  const cleanLen = toClean8(code).length
  const canBind = !busy && !hasBound && cleanLen === 8

  const statusToneClass =
    st.tone === "good"
      ? "cr__badge--good"
      : st.tone === "bad"
      ? "cr__badge--bad"
      : "cr__badge--muted"

  return (
    <div className="cr">
      <div className="p cr__hintTop">
        {t("router.hint")}
      </div>

      {loading && <div className="p">{t("router.loading")}</div>}

      {error && <div className="pre cr__mt10">{error}</div>}

      {!loading && (
        <div className="pre cr__mt10 cr__state">
          <div className="cr__stateMain">
            {hasBound ? (
              <>
                <div>
                  {t("router.bound")} <b>{shownPretty || "—"}</b>
                </div>

                {first?.created_at && (
                  <div className="cr__meta cr__mt6">
                    {t("router.bound_at")} <b>{fmtTs(first.created_at)}</b>
                  </div>
                )}

                {first?.last_seen_at && (
                  <div className="cr__meta">
                    {t("router.last_seen")} <b>{fmtTs(first.last_seen_at)}</b>
                  </div>
                )}
              </>
            ) : (
              <div>{t("router.not_bound")}</div>
            )}
          </div>

          {first && (
            <span className={`cr__badge ${statusToneClass}`}>
              <span className="cr__badgeK">status</span>
              <b className="cr__badgeV">{st.label}</b>
            </span>
          )}
        </div>
      )}

      {!hasBound && (
        <div className="cr__form">
          <input
            value={inputValue}
            onChange={(e) => {
              setError(null)
              setCode(e.target.value)
            }}
            onBlur={() => setCode((cur) => toPretty9(cur))}
            placeholder={t("router.input_placeholder")}
            className="input cr__input"
            disabled={busy}
            inputMode="text"
            lang="en"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            pattern="[A-Za-z0-9-]*"
          />
        </div>
      )}

      <div className="cr__actionsGrid cr__actionsGrid--2 cr__mt12">
        {!hasBound ? (
          <button
            className="btn btn--primary cr__btnFull"
            onClick={bind}
            disabled={!canBind}
          >
            {busy ? t("common.wait") : t("router.bind")}
          </button>
        ) : (
          <button
            className="btn btn--danger cr__btnFull"
            onClick={unbind}
            disabled={busy}
          >
            {busy ? t("common.wait") : t("router.unbind")}
          </button>
        )}

        <button
          className="btn cr__btnFull"
          onClick={() => load({ silent: false })}
          disabled={busy}
        >
          {t("common.refresh")}
        </button>
      </div>

      {hasBound ? (
        <div className="cr__note cr__mt10">
          {t("router.one_device")}
        </div>
      ) : (
        <div className="cr__note cr__mt10">
          {t("router.code_format")}
        </div>
      )}
    </div>
  )
}
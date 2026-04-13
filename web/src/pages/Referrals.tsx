// web/src/pages/Referrals.tsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type RefItem = {
  id?: number;
  full_name?: string;
  username?: string;
  created_at?: string;
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

function isTelegramMiniApp(): boolean {
  try {
    const tg = getTelegramWebApp();
    return typeof tg?.initData === "string" && tg.initData.trim().length > 0;
  } catch { return false; }
}

function toNum(v: any, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function toStr(v: any, def = "") { return String(v ?? "").trim() || def; }

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function Referrals() {
  const { t } = useI18n();
  const { me, loading, error } = useMe();

  const [telegramLink, setTelegramLink] = useState("");
  const [webLink,      setWebLink]      = useState("");
  const [linkLoading,  setLinkLoading]  = useState(false);
  const [linkError,    setLinkError]    = useState<string | null>(null);

  const [incomePercent, setIncomePercent] = useState(0);
  const [refCount,      setRefCount]      = useState(0);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError,   setStatusError]   = useState<string | null>(null);

  const [items,       setItems]       = useState<RefItem[]>([]);
  const [total,       setTotal]       = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError,   setListError]   = useState<string | null>(null);

  const inMiniApp = isTelegramMiniApp();

  const referralUrl = useMemo(() => {
    const tg  = telegramLink.trim();
    const web = webLink.trim();
    return inMiniApp ? (tg || web) : (web || tg);
  }, [telegramLink, webLink, inMiniApp]);

  const shareUrl = useMemo(() => {
    return referralUrl ? `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}` : "";
  }, [referralUrl]);

  // ── Load ──────────────────────────────────────────────────────────────────
  async function loadStatus() {
    setStatusLoading(true); setStatusError(null);
    try {
      const r = await apiFetch("/referrals/status", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setIncomePercent(toNum(refs.income_percent));
      setRefCount(toNum(refs.referrals_count));
    } catch (e: any) {
      setStatusError(e?.message || "error");
      setIncomePercent(0); setRefCount(0);
    } finally { setStatusLoading(false); }
  }

  async function loadList() {
    setListLoading(true); setListError(null);
    try {
      const r = await apiFetch("/referrals/list?limit=10&offset=0", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setItems(Array.isArray(refs.items) ? refs.items : []);
      setTotal(toNum(refs.total));
    } catch (e: any) {
      setListError(e?.message || "error");
      setItems([]); setTotal(0);
    } finally { setListLoading(false); }
  }

  async function loadLink() {
    setLinkLoading(true); setLinkError(null);
    try {
      const r = await apiFetch("/referrals/link", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setTelegramLink(toStr(refs.telegram_link));
      setWebLink(toStr(refs.web_link));
    } catch (e: any) {
      setLinkError(e?.message || "error");
      setTelegramLink(""); setWebLink("");
    } finally { setLinkLoading(false); }
  }

  useEffect(() => {
    if ((me as any)?.ok) {
      void loadStatus();
      void loadList();
      void loadLink();
    }
  }, [(me as any)?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────────────────
  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard?.writeText(referralUrl)
      .then(() => {
        toast.success(t("home.ref.link.k"), { description: referralUrl });
        try {
          getTelegramWebApp()?.showPopup?.({
            title: t("home.ref.link.k"),
            message: referralUrl,
            buttons: [{ type: "ok" }],
          });
        } catch { /* ignore */ }
      })
      .catch(() => toast.error(t("home.services.error")));
  }

  function shareLink() {
    if (!shareUrl) return;
    const tg = getTelegramWebApp();
    try {
      if (tg?.openTelegramLink) { tg.openTelegramLink(shareUrl); return; }
      if (tg?.openLink)         { tg.openLink(shareUrl, { try_instant_view: false }); return; }
    } catch { /* ignore */ }
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">{t("home.loading.text")}</div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !(me as any)?.ok) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.ref.title")}</h1>
            <p className="p">{t("home.error.text")}</p>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <Link className="btn btn--primary" to="/login">{t("home.actions.login")}</Link>
              <Link className="btn" to="/">{t("bottomNav.home")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="section">

      {/* Заголовок + ссылка */}
      <div className="card">
        <div className="card__body">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 className="h1">🤝 {t("home.ref.title")}</h1>
              <p className="p">{t("home.ref.sub")}</p>
            </div>
            <Link className="btn" to="/">{t("bottomNav.home")}</Link>
          </div>

          {/* Метрики */}
          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
            <div className="chip chip--soft">
              👥 {t("home.ref.list.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : refCount}</b>
            </div>
            <div className="chip chip--soft">
              💸 {t("home.ref.percent.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : `${incomePercent}%`}</b>
            </div>
          </div>
          {statusError && <p className="p" style={{ marginTop: 6, opacity: 0.6 }}>{statusError}</p>}

          {/* Реферальная ссылка */}
          <div style={{ marginTop: 16 }}>
            <div className="pre" style={{ userSelect: "text", wordBreak: "break-all" }}>
              {linkLoading ? "…" : referralUrl || "—"}
            </div>
            {linkError && <p className="p" style={{ marginTop: 6, opacity: 0.6 }}>{linkError}</p>}
          </div>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <button className="btn btn--primary" onClick={shareLink} disabled={!shareUrl} type="button">
              {t("home.ref.link.v")}
            </button>
            <button className="btn" onClick={copyLink} disabled={!referralUrl} type="button">
              {t("connect.copy_link")}
            </button>
          </div>
        </div>
      </div>

      {/* Список приглашённых */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">📃 {t("home.ref.list.k")}</h1>
            <p className="p">
              {listLoading
                ? t("home.loading.text")
                : total
                  ? `${t("home.ref.list.v")} · ${total}`
                  : t("home.ref.link.v")}
            </p>

            {listError && <div className="pre" style={{ marginTop: 12 }}>{listError}</div>}

            <div className="list" style={{ marginTop: 10 }}>
              {listLoading ? (
                <>
                  <div className="skeleton h1" />
                  <div className="skeleton p" />
                </>
              ) : items.length ? (
                items.map((r, idx) => {
                  const name    = toStr(r?.full_name, "—");
                  const uname   = toStr(r?.username);
                  const created = toStr(r?.created_at);
                  return (
                    <div className="list__item" key={`${r?.id ?? "x"}-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">
                          {name}
                          {uname && <span style={{ opacity: 0.65, marginLeft: 6 }}>@{uname}</span>}
                        </div>
                        <div className="list__sub">{created ? fmtDate(created) : "—"}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">{t("home.news.empty.title")}</div>
                    <div className="list__sub">{t("home.ref.link.v")}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default Referrals;
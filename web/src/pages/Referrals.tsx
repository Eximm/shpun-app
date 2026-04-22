// FILE: web/src/pages/Referrals.tsx

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

/* ─── Referrals ──────────────────────────────────────────────────────────── */

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

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const r = await apiFetch("/referrals/status", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setIncomePercent(toNum(refs.income_percent));
      setRefCount(toNum(refs.referrals_count));
    } catch { /* ignore */ }
    finally { setStatusLoading(false); }
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
    } finally { setLinkLoading(false); }
  }

  useEffect(() => {
    if ((me as any)?.ok) {
      void loadStatus();
      void loadList();
      void loadLink();
    }
  }, [(me as any)?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard?.writeText(referralUrl)
      .then(() => toast.success(t("home.ref.link.k"), { description: referralUrl }))
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

  if (error || !(me as any)?.ok) {
    return (
      <div className="section">
        <div className="card"><div className="card__body">
          <h1 className="h1">🤝 {t("home.ref.title")}</h1>
          <p className="p">{t("home.error.text")}</p>
          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <Link className="btn btn--primary" to="/login">{t("home.actions.login")}</Link>
            <Link className="btn" to="/">{t("bottomNav.home")}</Link>
          </div>
        </div></div>
      </div>
    );
  }

  return (
    <div className="section">

      {/* ── Заголовок + ссылка ── */}
      <div className="card" style={{
        background: "linear-gradient(135deg, rgba(124,92,255,0.12), rgba(77,215,255,0.07))",
        borderColor: "rgba(124,92,255,0.22)",
      }}>
        <div className="card__body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h1 className="h1">🤝 {t("home.ref.title")}</h1>
              <p className="p">{t("home.ref.sub")}</p>
            </div>
            <Link className="btn" to="/" style={{ flexShrink: 0 }}>{t("bottomNav.home")}</Link>
          </div>

          {/* Метрики */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <span className="chip chip--accent">
              👥 {t("home.ref.list.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : refCount}</b>
            </span>
            <span className="chip chip--ok">
              💸 {t("home.ref.percent.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : `${incomePercent}%`}</b>
            </span>
          </div>

          {/* Реферальная ссылка */}
          <div style={{ marginTop: 14 }}>
            <div className="pre" style={{ userSelect: "text", wordBreak: "break-all", fontSize: 13 }}>
              {linkLoading ? "Загружаем ссылку…" : referralUrl || "—"}
            </div>
            {linkError && <p className="p" style={{ marginTop: 6, opacity: 0.6 }}>{linkError}</p>}
          </div>

          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <button className="btn btn--primary" onClick={shareLink} disabled={!shareUrl} type="button">
              📤 {t("home.ref.link.v")}
            </button>
            <button className="btn" onClick={copyLink} disabled={!referralUrl} type="button">
              📋 {t("connect.copy_link")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Список приглашённых ── */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>👥</span>
              <h1 className="h1">{t("home.ref.list.k")}</h1>
              {total > 0 && <span className="chip chip--soft">{total}</span>}
            </div>
            <p className="p" style={{ marginTop: 0 }}>
              {listLoading ? t("home.loading.text") : total ? t("home.ref.list.v") : t("home.ref.link.v")}
            </p>

            {listError && <div className="pre" style={{ marginTop: 10 }}>{listError}</div>}

            <div className="list" style={{ marginTop: 12 }}>
              {listLoading ? (
                <><div className="skeleton h1" /><div className="skeleton p" /></>
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
                          {uname && <span style={{ opacity: 0.55, marginLeft: 8, fontWeight: 600, fontSize: 13 }}>@{uname}</span>}
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
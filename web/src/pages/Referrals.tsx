// FILE: web/src/pages/Referrals.tsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { getMood } from "../shared/payments-mood";
import { ensureTelegramWebAppSdk, getTelegramWebApp, isTelegramMiniAppEnv } from "../shared/telegram/sdk";

type RefItem = {
  id?: number;
  full_name?: string;
  username?: string;
  created_at?: string;
};

function toNum(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toStr(v: any, def = "") {
  return String(v ?? "").trim() || def;
}

function firstStr(...values: any[]) {
  for (const value of values) {
    const s = toStr(value);
    if (s) return s;
  }
  return "";
}

function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function isTelegramUrl(raw: string): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return host === "t.me" || host === "telegram.me" || host.endsWith(".telegram.me");
  } catch {
    return /^https?:\/\/(?:t\.me|telegram\.me)\//i.test(value);
  }
}

function partnerIdFromText(raw: unknown): number {
  const value = String(raw ?? "").trim();
  if (!value) return 0;

  const direct = normalizePartnerId(value);
  if (direct > 0) return direct;

  try {
    const u = new URL(value);
    const params = [
      u.searchParams.get("partner_id"),
      u.searchParams.get("partnerId"),
      u.searchParams.get("ref"),
      u.searchParams.get("start"),
      u.searchParams.get("startapp"),
    ];
    for (const param of params) {
      const id = partnerIdFromText(param);
      if (id > 0) return id;
    }
  } catch {
    /* continue with plain text parsing */
  }

  const tagged = value.match(/(?:partner[_-]?id|partner|ref|startapp|start)[=:_-]?(\d{1,12})/i);
  if (tagged) return normalizePartnerId(tagged[1]);

  return 0;
}

function extractPartnerId(refs: any, fallback: unknown): number {
  const candidates = [
    refs?.partner_id,
    refs?.partnerId,
    refs?.referral_id,
    refs?.referralId,
    refs?.ref_id,
    refs?.refId,
    refs?.id,
    refs?.user_id,
    refs?.userId,
    refs?.data?.partner_id,
    refs?.data?.partnerId,
    refs?.links?.partner_id,
    refs?.links?.partnerId,
    refs?._telegramLink,
    refs?._webLink,
    refs?.telegram_link,
    refs?.telegramLink,
    refs?.tg_link,
    refs?.tgLink,
    refs?.bot_link,
    refs?.botLink,
    refs?.bot_url,
    refs?.botUrl,
    refs?.web_link,
    refs?.webLink,
    refs?.app_link,
    refs?.appLink,
    refs?.web_url,
    refs?.webUrl,
    refs?.url,
    refs?.links?.telegram,
    refs?.links?.tg,
    refs?.links?.bot,
    refs?.links?.web,
    refs?.links?.app,
    refs?.telegram?.link,
    refs?.telegram?.url,
    refs?.bot?.link,
    refs?.bot?.url,
    refs?.web?.link,
    refs?.web?.url,
    refs?.app?.link,
    refs?.app?.url,
    fallback,
  ];
  for (const value of candidates) {
    const id = partnerIdFromText(value);
    if (id > 0) return id;
  }
  return 0;
}

function webReferralUrl(partnerId: number, rawWebLink = ""): string {
  const existing = rawWebLink.trim();
  if (existing && !isTelegramUrl(existing)) {
    try {
      const origin = window.location.origin;
      if (/^https?:\/\//i.test(existing)) return existing;
      if (/^https?:\/\//i.test(origin)) return new URL(existing, origin).toString();
    } catch {
      return existing;
    }
    return existing;
  }
  if (partnerId <= 0) return "";

  try {
    const origin = window.location.origin;
    if (!/^https?:\/\//i.test(origin)) return "";
    const u = new URL("/login", origin);
    u.searchParams.set("partner_id", String(partnerId));
    return u.toString();
  } catch {
    return "";
  }
}

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function Referrals() {
  const { t } = useI18n();
  const { me, loading, error } = useMe();

  const [telegramLink, setTelegramLink] = useState("");
  const [webLink, setWebLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [incomePercent, setIncomePercent] = useState(0);
  const [refCount, setRefCount] = useState(0);
  const [statusLoading, setStatusLoading] = useState(false);

  const [items, setItems] = useState<RefItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [telegramEnv, setTelegramEnv] = useState(() => isTelegramMiniAppEnv());

  const inMiniApp = telegramEnv;

  const referralUrl = useMemo(() => {
    const tg = telegramLink.trim();
    const web = webLink.trim();
    return inMiniApp ? (tg || web) : (web || tg);
  }, [telegramLink, webLink, inMiniApp]);

  const telegramShareUrl = useMemo(() => {
    if (!referralUrl) return "";
    return `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent(t("home.ref.share.text"))}`;
  }, [referralUrl, t]);

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const r = await apiFetch("/referrals/status", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setIncomePercent(toNum(refs.income_percent));
      setRefCount(toNum(refs.referrals_count));
    } catch {
      /* ignore */
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadList() {
    setListLoading(true);
    setListError(null);
    try {
      const r = await apiFetch("/referrals/list?limit=10&offset=0", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? {};
      setItems(Array.isArray(refs.items) ? refs.items : []);
      setTotal(toNum(refs.total));
    } catch (e: any) {
      setListError(e?.message || "error");
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }

  async function loadLink() {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const r = await apiFetch("/referrals/link", { method: "GET" }) as any;
      const refs = r?.data?.referrals ?? r?.referrals ?? r?.data ?? r ?? {};
      const nextTelegramLink = firstStr(
        refs.telegram_link,
        refs.telegramLink,
        refs.tg_link,
        refs.tgLink,
        refs.bot_link,
        refs.botLink,
        refs.bot_url,
        refs.botUrl,
        refs.links?.telegram,
        refs.links?.tg,
        refs.links?.bot,
        refs.telegram?.link,
        refs.telegram?.url,
        refs.bot?.link,
        refs.bot?.url
      );
      const rawWebLink = firstStr(
        refs.web_link,
        refs.webLink,
        refs.app_link,
        refs.appLink,
        refs.web_url,
        refs.webUrl,
        refs.url,
        refs.links?.web,
        refs.links?.app,
        refs.web?.link,
        refs.web?.url,
        refs.app?.link,
        refs.app?.url
      );
      const partnerId = extractPartnerId(
        {
          ...refs,
          _telegramLink: nextTelegramLink,
          _webLink: rawWebLink,
        },
        (me as any)?.profile?.id
      );

      setTelegramLink(nextTelegramLink);
      setWebLink(webReferralUrl(partnerId, rawWebLink));
    } catch (e: any) {
      setLinkError(e?.message || "error");
    } finally {
      setLinkLoading(false);
    }
  }

  useEffect(() => {
    if ((me as any)?.ok) {
      void loadStatus();
      void loadList();
      void loadLink();
    }
  }, [(me as any)?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (isTelegramMiniAppEnv()) {
      setTelegramEnv(true);
      return;
    }
    void ensureTelegramWebAppSdk(1200).then(() => {
      if (!cancelled && isTelegramMiniAppEnv()) setTelegramEnv(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function copyReferralLink(showSuccess = true) {
    if (!referralUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(referralUrl);
      if (showSuccess) {
        toast.success(getMood("copied") ?? t("home.ref.copy_ok"), { description: t("home.ref.copy_ok.desc") });
      }
    } catch {
      toast.error(t("home.services.error"));
    }
  }

  function copyLink() {
    void copyReferralLink(true);
  }

  async function shareLink() {
    if (!referralUrl) return;

    if (!inMiniApp && navigator.share) {
      try {
        await navigator.share({
          title: t("home.ref.share.title"),
          text: t("home.ref.share.text"),
          url: referralUrl,
        });
        return;
      } catch (e: any) {
        if (String(e?.name || "").toLowerCase() === "aborterror") return;
      }
    }

    if (!inMiniApp) {
      await copyReferralLink(false);
      toast.info(t("home.ref.share.copied"), { description: t("home.ref.share.copied.desc") });
      return;
    }

    const tg = (await ensureTelegramWebAppSdk(1200)) ?? getTelegramWebApp();
    try {
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(telegramShareUrl);
        return;
      }
      if (tg?.openLink) {
        tg.openLink(telegramShareUrl, { try_instant_view: false });
        return;
      }
    } catch {
      /* ignore */
    }
    window.location.href = telegramShareUrl;
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
      <div className="section miniPage referrals-page">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">🤝 {t("home.ref.title")}</h1>
            <p className="p">{t("home.error.text")}</p>
            <div className="actions actions--2 miniPage__actions">
              <Link className="btn btn--primary" to="/login">{t("home.actions.login")}</Link>
              <Link className="btn" to="/">{t("bottomNav.home")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section miniPage referrals-page">
      <div className="card miniPage__hero referrals-hero" style={{
        background: "linear-gradient(135deg, rgba(124,92,255,0.12), rgba(77,215,255,0.07))",
        borderColor: "rgba(124,92,255,0.22)",
      }}>
        <div className="card__body">
          <div className="miniPage__head">
            <div>
              <h1 className="h1">🤝 {t("home.ref.title")}</h1>
              <p className="p miniPage__subtitle">{t("home.ref.sub")}</p>
            </div>
            <Link className="btn miniPage__back" to="/" style={{ flexShrink: 0 }}>{t("bottomNav.home")}</Link>
          </div>

          <div className="referrals-metrics">
            <span className="chip chip--accent">
              👥 {t("home.ref.list.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : refCount}</b>
            </span>
            <span className="chip chip--ok">
              💸 {t("home.ref.percent.k")}: <b style={{ marginLeft: 4 }}>{statusLoading ? "…" : `${incomePercent}%`}</b>
            </span>
          </div>

          <div className="referrals-linkBox">
            <div className="referrals-linkBox__label">
              {inMiniApp ? t("home.ref.link.telegram") : t("home.ref.link.web")}
            </div>
            <div className="pre referrals-linkBox__value">
              {linkLoading ? t("home.ref.link.loading") : referralUrl || "—"}
            </div>
            {linkError && <p className="p referrals-linkBox__error">{linkError}</p>}
          </div>

          <div className="actions actions--2 miniPage__actions">
            <button className="btn btn--primary" onClick={() => void shareLink()} disabled={!referralUrl} type="button">
              📤 {t("home.ref.link.v")}
            </button>
            <button className="btn" onClick={copyLink} disabled={!referralUrl} type="button">
              📋 {t("connect.copy_link")}
            </button>
          </div>
        </div>
      </div>

      <div className="miniPage__section">
        <div className="card miniPage__panel">
          <div className="card__body">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>👥</span>
              <h1 className="h1">{t("home.ref.list.k")}</h1>
              {total > 0 && <span className="chip chip--soft">{total}</span>}
            </div>
            <p className="p miniPage__sectionText">
              {listLoading ? t("home.loading.text") : total ? t("home.ref.list.v") : t("home.ref.link.v")}
            </p>

            {listError && <div className="pre" style={{ marginTop: 10 }}>{listError}</div>}

            <div className="list miniPage__list">
              {listLoading ? (
                <>
                  <div className="skeleton h1" />
                  <div className="skeleton p" />
                </>
              ) : items.length ? (
                items.map((r, idx) => {
                  const name = toStr(r?.full_name, "—");
                  const uname = toStr(r?.username);
                  const created = toStr(r?.created_at);
                  return (
                    <div className="list__item miniPage__item miniPage__item--ref" key={`${r?.id ?? "x"}-${idx}`}>
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
                <div className="list__item miniPage__item miniPage__empty">
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

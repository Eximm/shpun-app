// web/src/pages/Referrals.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { toast } from "../shared/ui/toast";

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

function isTelegramMiniApp(): boolean {
  try {
    const tg = getTelegramWebApp();
    return typeof tg?.initData === "string" && tg.initData.length > 0;
  } catch {
    return false;
  }
}

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

type RefStatusResp = {
  ok: number | boolean;
  data?: {
    referrals?: {
      income_percent?: number;
      referrals_count?: number;
    };
  };
};

type RefListResp = {
  ok: number | boolean;
  data?: {
    referrals?: {
      total?: number;
      items?: Array<{
        id?: number;
        full_name?: string;
        username?: string;
        created_at?: string;
      }>;
    };
  };
};

type RefLinkResp = {
  ok: number | boolean;
  data?: {
    referrals?: {
      partner_id?: number;
      telegram_link?: string;
      web_link?: string;
    };
  };
};

function toNum(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toStr(v: any, def = "") {
  const s = String(v ?? "").trim();
  return s || def;
}

export function Referrals() {
  const { me, loading, error } = useMe();

  const [telegramLink, setTelegramLink] = useState("");
  const [webLink, setWebLink] = useState("");

  const [incomePercent, setIncomePercent] = useState(0);
  const [refCount, setRefCount] = useState(0);

  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const debugIsMiniApp = isTelegramMiniApp();

  const referralUrl = useMemo(() => {
    const tg = telegramLink.trim();
    const web = webLink.trim();

    if (debugIsMiniApp) return tg || web;
    return web || tg;
  }, [telegramLink, webLink, debugIsMiniApp]);

  const shareUrl = useMemo(() => {
    if (!referralUrl) return "";
    return `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}`;
  }, [referralUrl]);

  async function loadStatus() {
    try {
      const r = (await (await fetch(`/api/referrals/status`)).json()) as RefStatusResp;
      const refs = (r as any)?.data?.referrals ?? {};
      setIncomePercent(toNum(refs.income_percent));
      setRefCount(toNum(refs.referrals_count));
    } catch {
      setIncomePercent(0);
      setRefCount(0);
    }
  }

  async function loadList() {
    try {
      const r = (await (await fetch(`/api/referrals/list?limit=10&offset=0`)).json()) as RefListResp;
      const refs = (r as any)?.data?.referrals ?? {};
      setItems(Array.isArray(refs.items) ? refs.items : []);
      setTotal(toNum(refs.total));
    } catch {
      setItems([]);
      setTotal(0);
    }
  }

  async function loadLink() {
    setRefLoading(true);
    setRefError(null);

    try {
      const r = (await (await fetch(`/api/referrals/link`)).json()) as RefLinkResp;

      const refs = (r as any)?.data?.referrals ?? {};

      setTelegramLink(toStr(refs.telegram_link));
      setWebLink(toStr(refs.web_link));
    } catch (e: any) {
      setRefError(e?.message || "Failed to load link");
      setTelegramLink("");
      setWebLink("");
    } finally {
      setRefLoading(false);
    }
  }

  useEffect(() => {
    if ((me as any)?.ok) {
      loadStatus();
      loadList();
      loadLink();
    }
  }, [(me as any)?.ok]);

  function copyLink() {
    if (!referralUrl) return;

    navigator.clipboard.writeText(referralUrl);

    toast.success("Ссылка скопирована", {
      description: "Отправьте её другу.",
    });

    const tg = getTelegramWebApp();
    try {
      tg?.showPopup?.({
        title: "Готово",
        message: "Ссылка скопирована. Отправьте её другу.",
        buttons: [{ type: "ok" }],
      });
    } catch {}
  }

  function shareLink() {
    if (!shareUrl) return;

    const tg = getTelegramWebApp();

    try {
      if (tg?.openTelegramLink) return tg.openTelegramLink(shareUrl);
      if (tg?.openLink) return tg.openLink(shareUrl);
    } catch {}

    window.open(shareUrl, "_blank");
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Рефералы</div>
            <div className="p">Загрузка…</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !(me as any)?.ok) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Рефералы</div>
            <div className="p">Нужно войти в аккаунт.</div>

            <div className="actions actions--2">
              <Link className="btn btn--primary" to="/login">
                Войти
              </Link>

              <Link className="btn" to="/app">
                На главную
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section">

      <div className="card">
        <div className="card__body">

          <div className="home-block-head">
            <div>
              <div className="h1">🤝 Партнёрская программа</div>
              <div className="p">
                Приглашай друзей и получай процент с их пополнений
              </div>
            </div>

            <Link className="btn" to="/app">
              Главная
            </Link>
          </div>

          <div style={{ marginTop: 12 }}>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Твоя реферальная ссылка
            </div>

            <div className="pre">
              {referralUrl || "Ссылка недоступна"}
            </div>

            <div className="actions actions--2" style={{ marginTop: 10 }}>
              <button className="btn btn--primary" onClick={shareLink}>
                Поделиться
              </button>

              <button className="btn" onClick={copyLink}>
                Скопировать
              </button>
            </div>

            {/* DEBUG BLOCK */}
            <div
              className="pre"
              style={{
                marginTop: 10,
                fontSize: 12,
                opacity: 0.8,
                userSelect: "text",
              }}
            >
miniapp: {debugIsMiniApp ? "yes" : "no"}
telegram_link: {telegramLink || "(empty)"}
web_link: {webLink || "(empty)"}
selected: {referralUrl || "(empty)"}
            </div>

          </div>

          <div style={{ marginTop: 12 }}>
            👥 Приглашено: <b>{refCount}</b> &nbsp;&nbsp;
            💸 Процент: <b>{incomePercent}%</b>
          </div>

        </div>
      </div>

      <div className="card">
        <div className="card__body">

          <div className="h1">📃 Список приглашённых</div>

          {items.length ? (
            items.map((r, i) => {
              const name = toStr(r?.full_name, "Без имени");
              const uname = toStr(r?.username);
              const created = toStr(r?.created_at);

              return (
                <div className="list__item" key={i}>
                  <div className="list__main">
                    <div className="list__title">
                      {name} {uname ? `@${uname}` : ""}
                    </div>

                    <div className="list__sub">
                      {created ? `Присоединился: ${fmtDate(created)}` : ""}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="list__item">
              Пока приглашённых нет
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default Referrals;
// web/src/pages/Referrals.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
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
      enabled?: number;
      kind?: string;
      income_percent?: number;
      referrals_count?: number;
      bonus?: number;
    };
  };
};

type RefListResp = {
  ok: number | boolean;
  data?: {
    referrals?: {
      enabled?: number;
      kind?: string;
      total?: number;
      limit?: number;
      offset?: number;
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
      enabled?: number;
      kind?: string;
      partner_id?: number;
      income_percent?: number;
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

  // links (server-driven)
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [telegramLink, setTelegramLink] = useState<string>("");
  const [webLink, setWebLink] = useState<string>("");
  const [partnerId, setPartnerId] = useState<number>(0);

  function isTelegramMiniApp() {
    return !!getTelegramWebApp();
  }

  const referralUrl = useMemo(() => {
    const tg = telegramLink.trim();
    const web = webLink.trim();
    if (isTelegramMiniApp()) return tg || web;
    return web || tg;
  }, [telegramLink, webLink]);

  const shareUrl = useMemo(() => {
    if (!referralUrl) return "";
    return `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}`;
  }, [referralUrl]);

  // status
  const [stLoading, setStLoading] = useState(false);
  const [stError, setStError] = useState<string | null>(null);
  const [incomePercent, setIncomePercent] = useState<number>(0);
  const [refCount, setRefCount] = useState<number>(0);

  // list
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<any>>([]);
  const [total, setTotal] = useState<number>(0);
  const [limit] = useState<number>(10);
  const [offset, setOffset] = useState<number>(0);

  async function loadStatus() {
    setStLoading(true);
    setStError(null);
    try {
      const r = (await (await fetch(`/api/referrals/status`, { method: "GET" })).json()) as RefStatusResp;
      const refs = (r as any)?.data?.referrals ?? {};
      setIncomePercent(toNum(refs.income_percent, 0));
      setRefCount(toNum(refs.referrals_count, 0));
    } catch (e: any) {
      setStError(e?.message || "Failed to load status");
      setIncomePercent(0);
      setRefCount(0);
    } finally {
      setStLoading(false);
    }
  }

  async function loadList(nextOffset: number) {
    setListLoading(true);
    setListError(null);
    try {
      const r = (await (
        await fetch(`/api/referrals/list?limit=${limit}&offset=${nextOffset}`, {
          method: "GET",
        })
      ).json()) as RefListResp;

      const refs = (r as any)?.data?.referrals ?? {};
      setItems(Array.isArray(refs.items) ? refs.items : []);
      setTotal(toNum(refs.total, 0));
      setOffset(nextOffset);
    } catch (e: any) {
      setListError(e?.message || "Failed to load list");
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }

  async function loadLink() {
    setRefLoading(true);
    setRefError(null);
    try {
      const r = (await (await fetch(`/api/referrals/link`, { method: "GET" })).json()) as RefLinkResp;
      const refs = (r as any)?.data?.referrals ?? {};
      setTelegramLink(toStr(refs.telegram_link, ""));
      setWebLink(toStr(refs.web_link, ""));
      setPartnerId(toNum(refs.partner_id, 0));
    } catch (e: any) {
      setRefError(e?.message || "Failed to load link");
      setTelegramLink("");
      setWebLink("");
      setPartnerId(0);
    } finally {
      setRefLoading(false);
    }
  }

  useEffect(() => {
    if ((me as any)?.ok) {
      loadStatus();
      loadList(0);
      loadLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(me as any)?.ok]);

  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard?.writeText(referralUrl).catch(() => {});
    const tg = getTelegramWebApp();
    try {
      tg?.showPopup?.({
        title: "Готово",
        message: "Ссылка скопирована",
        buttons: [{ type: "ok" }],
      });
    } catch {
      // ignore
    }
  }

  function shareLink() {
    if (!shareUrl) return;
    const tg = getTelegramWebApp();
    try {
      if (tg?.openTelegramLink) return tg.openTelegramLink(shareUrl);
      if (tg?.openLink) return tg.openLink(shareUrl, { try_instant_view: false });
    } catch {
      // ignore
    }
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Рефералы</div>
            <div className="p" style={{ marginTop: 6 }}>
              Загрузка…
            </div>
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
            <div className="p" style={{ marginTop: 6 }}>
              Нужно войти в аккаунт.
            </div>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
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

  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="section">
      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">🤝 Партнёрская программа</div>
              <div className="p" style={{ marginTop: 6 }}>
                Приглашай друзей и получай процент с их пополнений
              </div>
            </div>

            <Link className="btn" to="/app">
              Главная
            </Link>
          </div>

          {/* Link box */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.72, marginBottom: 6 }}>
              Твоя реферальная ссылка
            </div>

            <div className="pre" style={{ marginTop: 0, userSelect: "text" }}>
              {referralUrl || "Ссылка недоступна (не удалось получить из биллинга)"}
            </div>

            <div className="actions actions--2" style={{ marginTop: 10 }}>
              <button className="btn btn--primary" onClick={shareLink} disabled={!shareUrl}>
                Поделиться
              </button>
              <button className="btn" onClick={copyLink} disabled={!referralUrl}>
                Скопировать
              </button>
            </div>

            {refLoading ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>Генерируем ссылку…</div>
            ) : refError ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>
                Не удалось получить ссылку. Обнови страницу.
              </div>
            ) : null}

            {stError ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>
                Не удалось загрузить статус. Обнови страницу или нажми “⟳” на главной.
              </div>
            ) : null}

            {/* optional: keep for quick debugging, can remove later */}
            {partnerId ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.5 }}>
                Partner ID: {partnerId}
              </div>
            ) : null}
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <div className="chip chip--soft">
              👥 Приглашено: <b style={{ marginLeft: 6 }}>{stLoading ? "…" : refCount}</b>
            </div>
            <div className="chip chip--soft">
              💸 Процент: <b style={{ marginLeft: 6 }}>{stLoading ? "…" : `${incomePercent || 0}%`}</b>
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="home-block-head">
              <div>
                <div className="h1">📃 Список приглашённых</div>
                <div className="p" style={{ marginTop: 6 }}>
                  {listLoading ? "Загрузка…" : total ? `Всего: ${total}` : "Пока никого нет — поделись ссылкой 🙂"}
                </div>
              </div>
            </div>

            {listError ? (
              <div className="pre" style={{ marginTop: 12 }}>
                Ошибка загрузки списка: {String(listError)}
              </div>
            ) : null}

            <div className="list" style={{ marginTop: 10 }}>
              {listLoading ? (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Загружаем…</div>
                    <div className="list__sub">Подождите</div>
                  </div>
                </div>
              ) : items.length ? (
                items.map((r, idx) => {
                  const name = toStr(r?.full_name, "Без имени");
                  const uname = toStr(r?.username, "");
                  const created = toStr(r?.created_at, "");
                  return (
                    <div className="list__item" key={`${r?.id ?? "x"}-${idx}`}>
                      <div className="list__main">
                        <div className="list__title">
                          {name}
                          {uname ? (
                            <span style={{ opacity: 0.75, fontWeight: 600 }}>
                              {" "}
                              @{uname}
                            </span>
                          ) : null}
                        </div>
                        <div className="list__sub">{created ? `Присоединился: ${fmtDate(created)}` : "—"}</div>
                      </div>

                      {/* ✅ ID intentionally not shown */}
                    </div>
                  );
                })
              ) : (
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Пока приглашённых нет</div>
                    <div className="list__sub">Нажми “Поделиться” — и отправь ссылку друзьям</div>
                  </div>
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn" disabled={!hasPrev || listLoading} onClick={() => loadList(Math.max(0, offset - limit))}>
                ⬅️ Назад
              </button>
              <button className="btn" disabled={!hasNext || listLoading} onClick={() => loadList(offset + limit)}>
                Ещё ➡️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Referrals;
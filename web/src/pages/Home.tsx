import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import React, { useEffect, useMemo, useState } from "react";

function Money({ amount, currency }: { amount: number; currency: string }) {
  const formatted =
    currency === "RUB"
      ? new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
      : new Intl.NumberFormat("ru-RU").format(amount) + ` ${currency}`;
  return <>{formatted}</>;
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

type TransferState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; consumeUrl: string; expiresAt?: number }
  | { status: "error"; message: string };

type PromoState =
  | { status: "idle" }
  | { status: "applying" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

// for TS only: minimal BeforeInstallPromptEvent
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

function isTelegramWebApp(): boolean {
  return !!(window as any)?.Telegram?.WebApp;
}

function openInBrowser(url: string) {
  // Внутри Telegram WebApp: открыть внешний браузер
  const tg = (window as any)?.Telegram?.WebApp;
  if (tg?.openLink) {
    try {
      tg.openLink(url);
      return;
    } catch {
      // fallback ниже
    }
  }
  // Обычный браузер / fallback
  window.open(url, "_blank", "noopener,noreferrer");
}

export function Home() {
  const { me, loading, error, refetch } = useMe();

  const [transfer, setTransfer] = useState<TransferState>({ status: "idle" });
  const [showTransferLink, setShowTransferLink] = useState(false);

  // Promo scaffold (will connect later)
  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  // PWA install CTA (works only when browser supports it)
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installState, setInstallState] = useState<
    "idle" | "prompting" | "done"
  >("idle");

  const profile = me?.profile;
  const balance = me?.balance;

  const displayName = profile?.displayName || profile?.login || "";

  useEffect(() => {
    const handler = (e: Event) => {
      // Chrome/Android: allows us to show our own "Install" button
      (e as any).preventDefault?.();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler as any);
    return () =>
      window.removeEventListener("beforeinstallprompt", handler as any);
  }, []);

  const canInstall = !!installEvt && installState !== "done";

  async function runInstall() {
    if (!installEvt) return;
    try {
      setInstallState("prompting");
      await installEvt.prompt();
      const choice = await installEvt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        setInstallState("done");
        setInstallEvt(null);
      } else {
        setInstallState("idle");
      }
    } catch {
      setInstallState("idle");
    }
  }

  const transferHint = useMemo(() => {
    if (transfer.status !== "ready") return "";
    if (!transfer.expiresAt) return "Код одноразовый и быстро истекает.";
    const leftMs = transfer.expiresAt - Date.now();
    const leftSec = Math.max(0, Math.floor(leftMs / 1000));
    if (leftSec <= 0) return "Срок действия кода истёк. Нажми ещё раз.";
    return `Код одноразовый. Действует примерно ${leftSec} сек.`;
  }, [transfer]);

  async function startTransferAndOpen() {
    try {
      setTransfer({ status: "loading" });
      setShowTransferLink(false);

      const res = await fetch("/api/auth/transfer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        const msg =
          json?.error === "not_authenticated"
            ? "Нужен вход. Открой Shpun App внутри Telegram и войди."
            : String(json?.error || "transfer_start_failed");
        setTransfer({ status: "error", message: msg });
        return;
      }

      const consumeUrl = String(json.consume_url || "").trim();
      if (!consumeUrl) {
        setTransfer({
          status: "error",
          message: "Сервер не вернул ссылку входа (consume_url).",
        });
        return;
      }

      const expiresAt = Number(json.expires_at || 0) || undefined;

      setTransfer({
        status: "ready",
        consumeUrl,
        expiresAt,
      });

      // ✅ Главное: сразу открываем внешний браузер
      openInBrowser(consumeUrl);
    } catch (e: any) {
      setTransfer({
        status: "error",
        message: e?.message || "Не удалось открыть приложение на компьютере.",
      });
    }
  }

  async function copyTransferUrl() {
    if (transfer.status !== "ready") return;
    const url = transfer.consumeUrl;

    try {
      await navigator.clipboard.writeText(url);
      alert("Ссылка скопирована 👍");
    } catch {
      window.prompt("Скопируй ссылку:", url);
    }
  }

  async function applyPromoStub() {
    const code = promo.code.trim();
    if (!code) {
      setPromo((p) => ({
        ...p,
        state: { status: "error", message: "Введите промокод." },
      }));
      return;
    }

    setPromo((p) => ({ ...p, state: { status: "applying" } }));
    await new Promise((r) => setTimeout(r, 450));

    setPromo((p) => ({
      ...p,
      state: {
        status: "done",
        message: "Промокоды скоро будут доступны прямо в приложении ✨",
      },
    }));
  }

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Shpun</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !me?.ok) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Shpun</h1>
            <p className="p">Ошибка загрузки профиля.</p>

            <ActionGrid>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                Повторить
              </button>
              <Link className="btn" to="/app/profile">
                Профиль
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      {/* User hero */}
      <div className="card">
        <div className="card__body">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <h1 className="h1">
                Привет{displayName ? `, ${displayName}` : ""} 👋
              </h1>
              <p className="p">SDN System — баланс, услуги и управление подпиской.</p>
            </div>

            <button className="btn" onClick={() => refetch?.()} title="Обновить">
              ⟳ Обновить
            </button>
          </div>

          {/* Balance / bonus / discount */}
          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">Баланс</div>
              <div className="kv__v">
                {balance ? (
                  <Money amount={balance.amount} currency={balance.currency} />
                ) : (
                  "—"
                )}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Бонусы</div>
              <div className="kv__v">
                {typeof me.bonus === "number" ? me.bonus : 0}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">Скидка</div>
              <div className="kv__v">
                {typeof me.discount === "number" ? `${me.discount}%` : "—"}
              </div>
            </div>
          </div>

          {/* Main actions (auto-equal width) */}
          <ActionGrid>
            <Link className="btn btn--primary" to="/app/payments">
              Оплата
            </Link>
            <Link className="btn" to="/app/services">
              Услуги
            </Link>
            <Link className="btn" to="/app/profile">
              Профиль
            </Link>
            {canInstall && (
              <button
                className="btn"
                onClick={runInstall}
                disabled={installState === "prompting"}
                title="Установить Shpun App на устройство"
              >
                {installState === "prompting" ? "Открываем…" : "Установить"}
              </button>
            )}
          </ActionGrid>

          {/* Account meta (symmetric) */}
          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">Пароль</div>
              <div className="kv__v">
                {profile?.passwordSet ? "установлен" : "не установлен"}
              </div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Создан</div>
              <div className="kv__v">{fmtDate(profile?.created)}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">Последний вход</div>
              <div className="kv__v">{fmtDate(profile?.lastLogin)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* News preview */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div className="h1" style={{ fontSize: 18 }}>
                  Новости
                </div>
                <p className="p">Коротко и по делу. Полная лента — в “Новости”.</p>
              </div>
              <Link className="btn" to="/app/feed">
                Открыть
              </Link>
            </div>

            <div className="list">
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">✅ Система стабильна — всё работает</div>
                  <div className="list__sub">
                    Обновления без простоев. Если видишь “Can’t connect” — просто обнови
                    страницу.
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--ok">today</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">🧭 Cabinet переехал в “Новости”</div>
                  <div className="list__sub">
                    Главная — витрина. Новости — лента. Дальше подключим реальные данные в
                    “Услугах”.
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">new</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">🔐 Вход с рабочего стола через Telegram</div>
                  <div className="list__sub">
                    Теперь это одна кнопка: откроем браузер и перенесём авторизацию автоматически.
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--warn">new</span>
                </div>
              </div>
            </div>

            <ActionGrid>
              <Link className="btn" to="/app/feed">
                Открыть новости
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>

      {/* Desktop transfer login */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Открыть на компьютере
            </div>

            <p className="p">
              Нажми кнопку — мы откроем внешний браузер и перенесём вход в Shpun App.
              Ничего копировать не нужно.
            </p>

            <ActionGrid>
              <button
                className="btn btn--primary"
                onClick={startTransferAndOpen}
                disabled={transfer.status === "loading"}
              >
                {transfer.status === "loading"
                  ? "Открываем…"
                  : "Открыть приложение на компьютере"}
              </button>

              {/* Install CTA рядом (если доступно) */}
              {canInstall && (
                <button
                  className="btn"
                  onClick={runInstall}
                  disabled={installState === "prompting"}
                  title="Установить Shpun App на рабочий стол"
                >
                  {installState === "prompting" ? "Установка…" : "Установить"}
                </button>
              )}

              {/* Fallback: показать ссылку */}
              {transfer.status === "ready" && (
                <button
                  className="btn"
                  onClick={() => setShowTransferLink((v) => !v)}
                  title="Если браузер не открылся автоматически"
                >
                  {showTransferLink ? "Скрыть ссылку" : "Показать ссылку"}
                </button>
              )}
            </ActionGrid>

            {transfer.status === "ready" && showTransferLink && (
              <div className="pre">
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  Резервный вариант (если авто-открытие не сработало)
                </div>

                <div style={{ wordBreak: "break-word" }}>{transfer.consumeUrl}</div>

                <div style={{ marginTop: 10, opacity: 0.85 }}>{transferHint}</div>

                <div style={{ marginTop: 10 }}>
                  <button className="btn" onClick={copyTransferUrl}>
                    Скопировать
                  </button>
                </div>
              </div>
            )}

            {transfer.status === "error" && (
              <div className="pre">
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Не получилось</div>
                <div style={{ opacity: 0.85 }}>{transfer.message}</div>

                <div style={{ marginTop: 10, opacity: 0.85 }}>
                  Подсказка: transfer-login работает только если ты уже вошёл в Shpun App внутри Telegram.
                </div>
              </div>
            )}

            {!canInstall && !isTelegramWebApp() && (
              <div className="pre" style={{ marginTop: 12, opacity: 0.9 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Установка</div>
                <div style={{ opacity: 0.85 }}>
                  Если кнопки “Установить” нет — браузер не выдал запрос установки.
                  Открой приложение в Chrome/Edge и попробуй снова.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Promo codes (bottom) */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Промокоды
            </div>
            <p className="p">Есть промокод? Введи его здесь — бонусы или скидка применятся к аккаунту.</p>

            <div className="actions actions--2">
              <div>
                <input
                  className="input"
                  value={promo.code}
                  onChange={(e) =>
                    setPromo((p) => ({
                      ...p,
                      code: e.target.value,
                      state: { status: "idle" },
                    }))
                  }
                  placeholder="Например: SHPUN-2026"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>

              <button
                className="btn btn--primary"
                onClick={applyPromoStub}
                disabled={promo.state.status === "applying"}
              >
                {promo.state.status === "applying" ? "Применяем…" : "Применить"}
              </button>
            </div>

            {promo.state.status === "done" && <div className="pre">{promo.state.message}</div>}
            {promo.state.status === "error" && <div className="pre">{promo.state.message}</div>}

            <ActionGrid>
              <Link className="btn" to="/app/profile">
                История / статус
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>
    </div>
  );
}

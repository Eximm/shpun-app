// web/src/pages/Home.tsx
import { Link } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../shared/i18n";

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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function ActionGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const n = Math.max(1, Math.min(5, items.length));
  return <div className={`actions actions--${n}`}>{items}</div>;
}

function getTelegramWebApp(): any | null {
  return (window as any)?.Telegram?.WebApp ?? null;
}

/**
 * Важно различать:
 * - настоящий MiniApp (есть initData) -> можно transfer/start (есть сессия TG)
 * - "встроенный браузер/вьюер" (TG объект может быть, но initData нет) -> transfer бессмысленен
 */
function hasTelegramInitData(): boolean {
  const tg = getTelegramWebApp();
  const initData = String(tg?.initData ?? "").trim();
  return initData.length > 0;
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent || "");
}

/**
 * consume_url может приходить абсолютным на другом домене (например app.shpyn.online).
 * Для миграции нужно всегда открывать consume на текущем origin (app.sdnonline.online),
 * иначе cookie sid окажется не там и в браузере будет 401.
 */
function normalizeConsumeUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;

  const origin = window.location.origin;

  // relative -> absolute on current origin
  if (s.startsWith("/")) return origin + s;

  try {
    const u = new URL(s);
    const cur = new URL(origin);

    // rewrite host to current host if differs
    if (u.host !== cur.host) {
      u.protocol = cur.protocol;
      u.host = cur.host;
    }
    return u.toString();
  } catch {
    return s;
  }
}

/**
 * Пытаемся максимально надёжно открыть внешний браузер из Telegram (Android часто капризничает).
 * 1) tg.openLink(url, try_instant_view:false)
 * 2) через 300мс tg.close() (часто помогает не "вложить миниапп в миниапп")
 * 3) Android fallback: intent:// на Chrome
 * 4) fallback: window.open
 */
function openInBrowser(url: string) {
  const tg = getTelegramWebApp();
  const android = isAndroid();

  if (tg?.openLink) {
    try {
      tg.openLink(url, { try_instant_view: false });
      if (android) {
        setTimeout(() => {
          try {
            tg.close();
          } catch {
            // ignore
          }
        }, 300);
      }
      return;
    } catch {
      // continue fallbacks
    }
  }

  // Android hard fallback: intent to Chrome
  if (android) {
    try {
      const u = new URL(url);
      const scheme = u.protocol.replace(":", "");
      const intentUrl =
        `intent://${u.host}${u.pathname}${u.search}${u.hash}` +
        `#Intent;scheme=${scheme};package=com.android.chrome;end`;
      window.location.href = intentUrl;
      return;
    } catch {
      // ignore
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function detectInstallHint(): { title: string; text: string } {
  const ua = (navigator.userAgent || "").toLowerCase();

  // very rough, but good enough for UX
  const isSamsung = ua.includes("samsungbrowser");
  const isFirefox = ua.includes("firefox");
  const isEdge = ua.includes("edg/");
  const isChrome =
    ua.includes("chrome") && !isEdge && !isSamsung && !ua.includes("opr/");

  if (isAndroid()) {
    if (isSamsung) {
      return {
        title: "Как установить",
        text: "В Samsung Internet: меню ☰ → “Добавить страницу на” → “Главный экран”.",
      };
    }
    if (isFirefox) {
      return {
        title: "Как установить",
        text: "В Firefox: меню ⋮ → “Установить” или “Добавить на главный экран”.",
      };
    }
    if (isChrome || isEdge) {
      return {
        title: "Как установить",
        text: "В Chrome/Edge: меню ⋮ → “Установить приложение” (или “Добавить на главный экран”).",
      };
    }
    return {
      title: "Как установить",
      text: "Откройте меню браузера и выберите “Установить приложение” / “Добавить на главный экран”.",
    };
  }

  // iOS / desktop fallback
  return {
    title: "Как установить",
    text: "Откройте меню браузера и выберите “Установить” / “Добавить на главный экран”.",
  };
}

export function Home() {
  const { t } = useI18n();
  const { me, loading, error, refetch } = useMe();

  const [transfer, setTransfer] = useState<TransferState>({ status: "idle" });
  const [showTransferLink, setShowTransferLink] = useState(false);

  const [promo, setPromo] = useState<{ code: string; state: PromoState }>({
    code: "",
    state: { status: "idle" },
  });

  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installState, setInstallState] = useState<"idle" | "prompting" | "done">(
    "idle"
  );

  // ✅ “в Telegram MiniApp” только если initData реально есть
  const inTelegramMiniApp = hasTelegramInitData();
  const hasTelegramObject = !!getTelegramWebApp();
  const transferBusy = transfer.status === "loading";

  const profile = me?.profile;
  const balance = me?.balance;
  const displayName = profile?.displayName || profile?.login || "";

  useEffect(() => {
    const handler = (e: Event) => {
      (e as any).preventDefault?.();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler as any);
    return () => window.removeEventListener("beforeinstallprompt", handler as any);
  }, []);

  // Настоящая PWA-установка (prompt) — только в браузере, не в Telegram WebApp
  const canInstallPrompt =
    !inTelegramMiniApp && !!installEvt && installState !== "done";

  const shouldShowInstallHelper =
    !inTelegramMiniApp && !canInstallPrompt && installState !== "done";

  // ✅ ВАЖНО: хуки должны вызываться ВСЕГДА, поэтому useMemo — ДО ранних return
  const installHint = useMemo(() => detectInstallHint(), []);

  const transferHint = useMemo(() => {
    if (transfer.status !== "ready") return "";
    if (!transfer.expiresAt)
      return t("home.install.hint.default", "Ссылка одноразовая и быстро истекает.");
    const leftMs = transfer.expiresAt - Date.now();
    const leftSec = Math.max(0, Math.floor(leftMs / 1000));
    if (leftSec <= 0)
      return t("home.install.hint.expired", "Срок действия истёк. Нажми ещё раз.");
    return t(
      "home.install.hint.left",
      `Ссылка одноразовая. Действует примерно ${leftSec} сек.`
    ).replace("{sec}", String(leftSec));
  }, [transfer, t]);

  async function runInstallPrompt() {
    if (!installEvt || inTelegramMiniApp) return;

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

  async function startTransferAndOpen() {
    // Если это Telegram-окружение без initData (встроенный браузер),
    // то transfer не сработает: нет telegram initData-сессии.
    if (hasTelegramObject && !inTelegramMiniApp) {
      setTransfer({
        status: "error",
        message: t(
          "error.open_in_tg",
          "Откройте приложение внутри Telegram (в Mini App), чтобы перенести вход в браузер."
        ),
      });
      setShowTransferLink(true);
      return;
    }

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
            ? t(
                "error.open_in_tg",
                "Откройте приложение внутри Telegram, чтобы войти."
              )
            : String(json?.error || "transfer_start_failed");
        setTransfer({ status: "error", message: msg });
        setShowTransferLink(true);
        return;
      }

      const rawConsumeUrl = String(json.consume_url || "").trim();
      if (!rawConsumeUrl) {
        setTransfer({
          status: "error",
          message:
            t("home.install.error", "Не получилось открыть установку.") +
            ": consume_url",
        });
        setShowTransferLink(true);
        return;
      }

      const consumeUrl = normalizeConsumeUrl(rawConsumeUrl);
      const expiresAt = Number(json.expires_at || 0) || undefined;

      setTransfer({ status: "ready", consumeUrl, expiresAt });

      // Пытаемся открыть внешний браузер
      openInBrowser(consumeUrl);

      // ✅ fallback UX: даже если открылось “не туда”, пользователь сразу видит ссылку
      window.setTimeout(() => setShowTransferLink(true), 600);
    } catch (e: any) {
      setTransfer({
        status: "error",
        message:
          e?.message ||
          t("home.install.error", "Не получилось открыть установку."),
      });
      setShowTransferLink(true);
    }
  }

  async function copyTransferUrl() {
    if (transfer.status !== "ready") return;
    const url = transfer.consumeUrl;

    try {
      await navigator.clipboard.writeText(url);
      alert(t("home.install.copy_ok", "Ссылка скопирована 👍"));
    } catch {
      window.prompt(t("home.install.copy_prompt", "Скопируй ссылку:"), url);
    }
  }

  async function applyPromoStub() {
    const code = promo.code.trim();
    if (!code) {
      setPromo((p) => ({
        ...p,
        state: {
          status: "error",
          message: t("promo.err.empty", "Введите промокод."),
        },
      }));
      return;
    }

    setPromo((p) => ({ ...p, state: { status: "applying" } }));
    await new Promise((r) => setTimeout(r, 450));

    setPromo((p) => ({
      ...p,
      state: {
        status: "done",
        message: t(
          "promo.done.stub",
          "Промокоды скоро будут доступны прямо в приложении ✨"
        ),
      },
    }));
  }

  // ✅ Ранние return теперь НЕ меняют количество хуков (все хуки выше уже вызваны)
  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">{t("home.loading.title", "ShpunApp")}</h1>
            <p className="p">{t("home.loading.text", "Загрузка…")}</p>
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
            <h1 className="h1">{t("home.error.title", "ShpunApp")}</h1>
            <p className="p">{t("home.error.text", "Ошибка загрузки профиля.")}</p>

            <ActionGrid>
              <button className="btn btn--primary" onClick={() => refetch?.()}>
                {t("home.error.retry", "Повторить")}
              </button>
              <Link className="btn" to="/app/profile">
                {t("home.actions.profile", "Профиль")}
              </Link>
              {!inTelegramMiniApp && (
                <Link className="btn" to="/login">
                  {t("home.actions.login", "Войти")}
                </Link>
              )}
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
                {t("home.hello", "Привет")}
                {displayName ? `, ${displayName}` : ""} 👋
              </h1>
              <p className="p">
                {t(
                  "home.subtitle",
                  "SDN System — баланс, услуги и управление подпиской."
                )}
              </p>
            </div>

            <button
              className="btn"
              onClick={() => refetch?.()}
              title={t("home.refresh", "⟳ Обновить")}
            >
              {t("home.refresh", "⟳ Обновить")}
            </button>
          </div>

          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">{t("home.kv.balance", "Баланс")}</div>
              <div className="kv__v">
                {balance ? (
                  <Money amount={balance.amount} currency={balance.currency} />
                ) : (
                  "—"
                )}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t("home.kv.bonus", "Бонусы")}</div>
              <div className="kv__v">
                {typeof me.bonus === "number" ? me.bonus : 0}
              </div>
            </div>

            <div className="kv__item">
              <div className="kv__k">{t("home.kv.discount", "Скидка")}</div>
              <div className="kv__v">
                {typeof me.discount === "number" ? `${me.discount}%` : "—"}
              </div>
            </div>
          </div>

          <ActionGrid>
            <Link className="btn btn--primary" to="/app/payments">
              {t("home.actions.payments", "Оплата")}
            </Link>
            <Link className="btn" to="/app/services">
              {t("home.actions.services", "Услуги")}
            </Link>
            <Link className="btn" to="/app/profile">
              {t("home.actions.profile", "Профиль")}
            </Link>

            {/* В браузере — реальная установка через prompt */}
            {canInstallPrompt && (
              <button
                className="btn"
                onClick={runInstallPrompt}
                disabled={installState === "prompting"}
                title={t("home.install", "Установить приложение")}
              >
                {installState === "prompting"
                  ? t("home.install.opening", "Открываем…")
                  : t("home.install", "Установить приложение")}
              </button>
            )}

            {/* В Telegram MiniApp — переносим вход и открываем внешний браузер для установки */}
            {(inTelegramMiniApp || hasTelegramObject) && (
              <button
                className="btn"
                onClick={startTransferAndOpen}
                disabled={transferBusy}
                title={t("home.install", "Установить приложение")}
              >
                {transferBusy
                  ? t("home.install.opening", "Открываем…")
                  : t("home.install", "Установить приложение")}
              </button>
            )}
          </ActionGrid>

          <div className="kv kv--3">
            <div className="kv__item">
              <div className="kv__k">{t("home.meta.password", "Пароль")}</div>
              <div className="kv__v">
                {profile?.passwordSet
                  ? t("home.meta.password.on", "установлен")
                  : t("home.meta.password.off", "не установлен")}
              </div>
            </div>
            <div className="kv__item">
              <div className="kv__k">{t("home.meta.created", "Создан")}</div>
              <div className="kv__v">{fmtDate(profile?.created)}</div>
            </div>
            <div className="kv__item">
              <div className="kv__k">
                {t("home.meta.last_login", "Последний вход")}
              </div>
              <div className="kv__v">{fmtDate(profile?.lastLogin)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Install helper in browser (если prompt не пришёл) */}
      {shouldShowInstallHelper && (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>
                {t("home.install.title", installHint.title)}
              </div>
              <p className="p">
                {t(
                  "home.install.desc_browser",
                  "Браузер не показал кнопку установки автоматически. Это нормально — установку можно сделать через меню."
                )}
              </p>
              <div className="pre">{installHint.text}</div>
            </div>
          </div>
        </div>
      )}

      {/* Install helper в “телеграмном” сценарии */}
      {(hasTelegramObject || inTelegramMiniApp) &&
        (showTransferLink ||
          transfer.status === "ready" ||
          transfer.status === "error") && (
          <div className="section">
            <div className="card">
              <div className="card__body">
                <div className="h1" style={{ fontSize: 18 }}>
                  {t("home.install.title", "Установить приложение")}
                </div>
                <p className="p">
                  {t(
                    "home.install.desc",
                    "Мы откроем браузер и перенесём вход автоматически. После этого установите приложение обычным способом."
                  )}
                </p>

                {transfer.status === "ready" && (
                  <ActionGrid>
                    <button
                      className="btn btn--primary"
                      onClick={startTransferAndOpen}
                      disabled={transferBusy}
                    >
                      {t("home.install.open_browser", "Открыть браузер")}
                    </button>

                    <button
                      className="btn"
                      onClick={() => setShowTransferLink((v) => !v)}
                      title={t(
                        "home.install.fallback",
                        "Если авто-открытие не сработало"
                      )}
                    >
                      {showTransferLink
                        ? t("home.install.hide_link", "Скрыть ссылку")
                        : t("home.install.show_link", "Показать ссылку")}
                    </button>
                  </ActionGrid>
                )}

                {transfer.status === "ready" && showTransferLink && (
                  <div className="pre" style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      {t(
                        "home.install.fallback",
                        "Если авто-открытие не сработало"
                      )}
                    </div>
                    <div style={{ wordBreak: "break-word" }}>
                      {transfer.consumeUrl}
                    </div>
                    <div style={{ marginTop: 10, opacity: 0.85 }}>
                      {transferHint}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <button className="btn" onClick={copyTransferUrl}>
                        {t("home.install.copy", "Скопировать ссылку")}
                      </button>
                    </div>
                  </div>
                )}

                {transfer.status === "error" && (
                  <div className="pre" style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      {t(
                        "home.install.error",
                        "Не получилось открыть установку."
                      )}
                    </div>
                    <div style={{ opacity: 0.85 }}>{transfer.message}</div>
                  </div>
                )}

                {/* Если нажали “установить” в телеграмном браузере без initData */}
                {hasTelegramObject && !inTelegramMiniApp && transfer.status === "idle" && (
                  <div className="pre" style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      {t("home.install.note", "Важно")}
                    </div>
                    <div style={{ opacity: 0.85 }}>
                      {t(
                        "error.open_in_tg",
                        "Откройте приложение внутри Telegram (в Mini App), чтобы перенести вход в браузер."
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
                  {t("home.news.title", "Новости")}
                </div>
                <p className="p">
                  {t(
                    "home.news.subtitle",
                    "Коротко и по делу. Полная лента — в “Новости”."
                  )}
                </p>
              </div>
              <Link className="btn" to="/app/feed">
                {t("home.news.open", "Открыть")}
              </Link>
            </div>

            <div className="list">
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">
                    {t(
                      "home.news.item1.title",
                      "✅ Система стабильна — всё работает"
                    )}
                  </div>
                  <div className="list__sub">
                    {t(
                      "home.news.item1.sub",
                      "Если видишь “Can’t connect” — просто обнови страницу."
                    )}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--ok">today</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">
                    {t("home.news.item2.title", "🧭 Лента — в “Новости”")}
                  </div>
                  <div className="list__sub">
                    {t(
                      "home.news.item2.sub",
                      "Главная — витрина. Новости — лента. Дальше подключим реальные данные."
                    )}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">new</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">
                    {t(
                      "home.news.item3.title",
                      "🔐 Установка без потери входа"
                    )}
                  </div>
                  <div className="list__sub">
                    {t(
                      "home.news.item3.sub",
                      "Откроем браузер и перенесём вход автоматически."
                    )}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--warn">new</span>
                </div>
              </div>
            </div>

            <ActionGrid>
              <Link className="btn" to="/app/feed">
                {t("home.news.open_full", "Открыть новости")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>

      {/* Promo codes */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              {t("promo.title", "Промокоды")}
            </div>
            <p className="p">
              {t(
                "promo.desc",
                "Есть промокод? Введи его здесь — бонусы или скидка применятся к аккаунту."
              )}
            </p>

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
                  placeholder={t("promo.input_ph", "Например: SHPUN-2026")}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>

              <button
                className="btn btn--primary"
                onClick={applyPromoStub}
                disabled={promo.state.status === "applying"}
              >
                {promo.state.status === "applying"
                  ? t("promo.applying", "Применяем…")
                  : t("promo.apply", "Применить")}
              </button>
            </div>

            {promo.state.status === "done" && (
              <div className="pre">{promo.state.message}</div>
            )}
            {promo.state.status === "error" && (
              <div className="pre">{promo.state.message}</div>
            )}

            <ActionGrid>
              <Link className="btn" to="/app/profile">
                {t("promo.history", "История / статус")}
              </Link>
            </ActionGrid>
          </div>
        </div>
      </div>
    </div>
  );
}

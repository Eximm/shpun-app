import React, { useMemo, useState } from "react";

type TransferStage =
  | "init"
  | "ready"
  | "missing_code"
  | "opening"
  | "done"
  | "error";

function normalizeRedirectPath(input: string | null, fallback = "/app"): string {
  const v = String(input ?? "").trim();
  if (!v) return fallback;
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;
  return v;
}

function isTelegramWebApp(): boolean {
  return !!(window as any)?.Telegram?.WebApp;
}

function openLinkSmart(url: string) {
  const tg = (window as any)?.Telegram?.WebApp;
  // В Telegram WebApp лучше просить openLink (он может показать системный chooser/внешний браузер)
  if (tg?.openLink) {
    tg.openLink(url);
    return;
  }
  window.location.assign(url);
}

export function Transfer() {
  const [stage, setStage] = useState<TransferStage>("init");
  const [error, setError] = useState<string>("");

  const { code, redirectTo, consumeUrl } = useMemo(() => {
    const u = new URL(window.location.href);
    const code = String(u.searchParams.get("code") ?? "").trim();
    const redirectRaw = u.searchParams.get("redirect");
    const redirectTo = normalizeRedirectPath(redirectRaw, "/app");

    // ВАЖНО: consume у нас теперь живёт на app.sdnonline.online и сам делает bridge + intent
    const consumeUrl =
      `https://app.sdnonline.online` +
      `/api/auth/transfer/consume?code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(
        redirectTo
      )}`;

    return { code, redirectTo, consumeUrl };
  }, []);

  React.useEffect(() => {
    if (!code) setStage("missing_code");
    else setStage("ready");
  }, [code]);

  const onContinue = () => {
    if (!code) {
      setStage("missing_code");
      return;
    }
    setStage("opening");
    try {
      openLinkSmart(consumeUrl);
      // мы не можем надёжно узнать, открылось ли, поэтому просто переводим в done через паузу
      window.setTimeout(() => setStage("done"), 1200);
    } catch (e: any) {
      setError(e?.message || "Не удалось открыть ссылку");
      setStage("error");
    }
  };

  const goHome = () => window.location.assign(redirectTo || "/app");
  const goLogin = () => window.location.assign("/login");

  const title =
    stage === "missing_code"
      ? "Ссылка неполная"
      : stage === "error"
      ? "Не получилось открыть браузер"
      : stage === "done"
      ? "Готово"
      : "Перенос входа";

  const subtitle =
    stage === "missing_code"
      ? "В ссылке нет кода входа. Откройте её заново из Telegram."
      : stage === "error"
      ? error || "Попробуйте ещё раз."
      : stage === "done"
      ? "Если вы уже в браузере — можно установить приложение через меню браузера."
      : isTelegramWebApp()
      ? "Мы откроем внешний браузер и перенесём авторизацию, чтобы вы могли установить приложение."
      : "Откроем страницу входа и перенесём авторизацию.";

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <h2 className="h1">{title}</h2>
          <p className="p">{subtitle}</p>

          {stage === "ready" && (
            <div className="actions actions--1" style={{ marginTop: 16 }}>
              <button className="btn btn--primary" onClick={onContinue}>
                Продолжить
              </button>
            </div>
          )}

          {stage === "opening" && (
            <div style={{ marginTop: 14, opacity: 0.75, fontSize: 13 }}>
              Открываем… Если ничего не произошло — нажмите “Продолжить” ещё раз.
            </div>
          )}

          {(stage === "missing_code" || stage === "error" || stage === "done") && (
            <div className="actions actions--2" style={{ marginTop: 16 }}>
              <button className="btn btn--primary" onClick={goHome}>
                Открыть приложение
              </button>
              <button className="btn" onClick={goLogin}>
                Перейти на вход
              </button>
            </div>
          )}

          {stage !== "missing_code" && (
            <div style={{ marginTop: 14, opacity: 0.7, fontSize: 12 }}>
              Ссылка:{" "}
              <span style={{ wordBreak: "break-all" }}>{consumeUrl}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Transfer;

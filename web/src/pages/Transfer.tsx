import { useEffect, useMemo, useState } from "react";

type TransferState =
  | { stage: "init" }
  | { stage: "redirecting" }
  | { stage: "missing_code" }
  | { stage: "timeout" }
  | { stage: "error"; message: string };

function normalizeRedirectPath(input: string | null, fallback = "/app"): string {
  const v = String(input ?? "").trim();
  if (!v) return fallback;

  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;

  return v;
}

export function Transfer() {
  const [state, setState] = useState<TransferState>({ stage: "init" });

  const { code, targetConsumePath } = useMemo(() => {
    const u = new URL(window.location.href);

    const code = String(u.searchParams.get("code") ?? "").trim();
    const redirectRaw = u.searchParams.get("redirect");
    const redirectTo = normalizeRedirectPath(redirectRaw, "/app");

    const targetConsumePath = `/api/auth/transfer/consume?code=${encodeURIComponent(
      code
    )}&redirect=${encodeURIComponent(redirectTo)}`;

    return { code, targetConsumePath };
  }, []);

  useEffect(() => {
    if (!code) {
      setState({ stage: "missing_code" });
      return;
    }

    setState({ stage: "redirecting" });

    // Фейлсейф — если редирект не сработал
    const t = window.setTimeout(() => {
      setState({ stage: "timeout" });
    }, 12_000);

    // ВАЖНО: replace, чтобы не оставлять эту страницу в истории
    window.location.replace(targetConsumePath);

    return () => window.clearTimeout(t);
  }, [code, targetConsumePath]);

  const goHome = () => window.location.assign("/app");
  const goLogin = () => window.location.assign("/login");

  const title =
    state.stage === "missing_code"
      ? "Ссылка неполная"
      : state.stage === "timeout"
      ? "Не получилось выполнить вход"
      : state.stage === "error"
      ? "Ошибка"
      : "Открываем приложение…";

  const subtitle =
    state.stage === "missing_code"
      ? "В ссылке нет кода входа. Откройте её заново из Telegram."
      : state.stage === "timeout"
      ? "Похоже, вход не завершился. Попробуйте ещё раз."
      : state.stage === "error"
      ? state.message
      : "Секунду, выполняем вход.";

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <h2 className="h1">{title}</h2>
          <p className="p">{subtitle}</p>

          {(state.stage === "missing_code" ||
            state.stage === "timeout" ||
            state.stage === "error") && (
            <div className="actions actions--2" style={{ marginTop: 16 }}>
              <button className="btn btn--primary" onClick={goHome}>
                Открыть приложение
              </button>

              <button className="btn" onClick={goLogin}>
                Перейти на вход
              </button>
            </div>
          )}

          {state.stage === "redirecting" && (
            <div style={{ marginTop: 14, opacity: 0.75, fontSize: 13 }}>
              Если ничего не происходит — подождите пару секунд.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Transfer;

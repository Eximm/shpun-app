// web/src/pages/Transfer.tsx
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

  // Разрешаем только относительные пути внутри приложения
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;

  return v;
}

export function Transfer() {
  const [state, setState] = useState<TransferState>({ stage: "init" });

  const { code, redirectTo } = useMemo(() => {
    const u = new URL(window.location.href);
    const code = String(u.searchParams.get("code") ?? "").trim();
    const redirectRaw = u.searchParams.get("redirect");
    const redirectTo = normalizeRedirectPath(redirectRaw, "/app");
    return { code, redirectTo };
  }, []);

  useEffect(() => {
    if (!code) {
      setState({ stage: "missing_code" });
      return;
    }

    setState({ stage: "redirecting" });

    // Фейлсейф: если по каким-то причинам редирект не сработает (расширения, политики, и т.п.)
    const t = window.setTimeout(() => {
      setState({ stage: "timeout" });
    }, 12_000);

    const target = `/api/auth/transfer/consume?code=${encodeURIComponent(
      code
    )}&redirect=${encodeURIComponent(redirectTo)}`;

    // replace — чтобы не оставлять "лишнюю" страницу в истории браузера
    window.location.replace(target);

    return () => window.clearTimeout(t);
  }, [code, redirectTo]);

  const onGoHome = () => {
    window.location.assign("/app");
  };

  const onGoLogin = () => {
    // Если захочешь — можно добавить query reason=...
    window.location.assign("/login");
  };

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
        ? "Похоже, вход не завершился. Попробуйте ещё раз или откройте приложение вручную."
        : state.stage === "error"
          ? state.message
          : "Секунду, выполняем вход.";

  return (
    <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      <p style={{ margin: 0, opacity: 0.8 }}>{subtitle}</p>

      {(state.stage === "missing_code" ||
        state.stage === "timeout" ||
        state.stage === "error") && (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onGoHome}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(255,255,255,.06)",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 650,
            }}
          >
            Открыть приложение
          </button>

          <button
            type="button"
            onClick={onGoLogin}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.14)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 650,
              opacity: 0.9,
            }}
          >
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
  );
}

export default Transfer;

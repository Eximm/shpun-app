// web/src/pages/Transfer.tsx
import { useEffect } from "react";

export function Transfer() {
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get("code") || "";
    if (!code) return;

    // Сервер сам поставит cookie sid и сделает редирект на /app/home
    const target = `/api/auth/transfer/consume?code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(
      "/app/home"
    )}`;
    window.location.replace(target);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2>Открываем приложение…</h2>
      <p>Секунду, выполняем вход.</p>
    </div>
  );
}

export default Transfer;

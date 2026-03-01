// web/src/app/auth/AuthGate.tsx
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useMe } from "./useMe";
import { enablePush } from "../notifications/push";
import { toast } from "../../shared/ui/toast";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const loc = useLocation();
  const nav = useNavigate();

  const notifiedRef = useRef(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (me) {
      enablePush().catch(() => {});
    }
  }, [me]);

  useEffect(() => {
    if (!authRequired) return;
    if (notifiedRef.current) return;

    notifiedRef.current = true;
    toast.info("Нужно войти заново", {
      description: "Сессия истекла или была обновлена. Авторизуйтесь снова.",
      durationMs: 3500,
    });

    setRedirecting(true);
    // небольшой “мягкий” промежуток, чтобы пользователь увидел экран
    window.setTimeout(() => {
      nav("/login", {
        replace: true,
        state: { from: loc.pathname + (loc.search || "") },
      });
    }, 450);
  }, [authRequired, nav, loc.pathname, loc.search]);

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="skeleton h1" style={{ width: "54%" }} />
            <div className="skeleton p" style={{ width: "78%", marginTop: 12 }} />
            <div className="skeleton p" style={{ width: "62%", marginTop: 8 }} />
            <div className="skeleton p" style={{ width: "70%", marginTop: 18, height: 44 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    // если это не authRequired — просто уводим на login (редкий кейс)
    if (!authRequired) {
      return <Navigate to="/login" replace state={{ from: loc.pathname + (loc.search || "") }} />;
    }

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Нужен вход</h1>
            <p className="p">Мы обновили сессию. Сейчас откроем страницу авторизации.</p>

            <div className="pre" style={{ marginTop: 12 }}>
              {redirecting ? "Переходим…" : "—"}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn btn--primary"
                onClick={() =>
                  nav("/login", { replace: true, state: { from: loc.pathname + (loc.search || "") } })
                }
              >
                Войти
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
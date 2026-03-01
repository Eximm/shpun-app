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

  /* ============================================================
     Enable push after auth
     ============================================================ */
  useEffect(() => {
    if (me) {
      enablePush().catch(() => {});
    }
  }, [me]);

  /* ============================================================
     Session expired handling
     ============================================================ */
  useEffect(() => {
    if (!authRequired) return;
    if (notifiedRef.current) return;

    notifiedRef.current = true;

    toast.error("Сессия истекла", {
      description: "Пожалуйста, авторизуйтесь снова.",
      durationMs: 3500,
    });

    setRedirecting(true);

    window.setTimeout(() => {
      nav("/login", {
        replace: true,
        state: { from: loc.pathname + (loc.search || "") },
      });
    }, 450);
  }, [authRequired, nav, loc.pathname, loc.search]);

  /* ============================================================
     Global loading screen
     ============================================================ */
  if (loading) {
    return (
      <div className="app-loader">
        <div className="app-loader__dot" />
        <div className="app-loader__text">Проверяем авторизацию…</div>
      </div>
    );
  }

  /* ============================================================
     Not authenticated
     ============================================================ */
  if (!me) {
    if (!authRequired) {
      return (
        <Navigate
          to="/login"
          replace
          state={{ from: loc.pathname + (loc.search || "") }}
        />
      );
    }

    return (
      <div className="app-loader">
        <div className="app-loader__dot" />
        <div className="app-loader__text">
          {redirecting ? "Переходим…" : "Требуется вход"}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
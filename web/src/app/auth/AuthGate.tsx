// web/src/app/auth/AuthGate.tsx
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useMe } from "./useMe";
import { enablePush } from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY = "partner_id_pending";

function parsePartnerIdFromUrl(): number {
  // We support:
  // 1) https://app/.../#!/?partner_id=2   (hashbang)
  // 2) https://app/.../?partner_id=2      (classic)
  // 3) any hash variant containing ?partner_id=2
  try {
    const direct = new URLSearchParams(window.location.search || "");
    const v1 = direct.get("partner_id");
    if (v1) {
      const n = Number(v1);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }

    const h = String(window.location.hash || "");
    const qIdx = h.indexOf("?");
    if (qIdx >= 0) {
      const qs = h.slice(qIdx + 1);
      const hp = new URLSearchParams(qs);
      const v2 = hp.get("partner_id");
      if (v2) {
        const n = Number(v2);
        if (Number.isFinite(n) && n > 0) return Math.trunc(n);
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

function rememberPartnerIdFromUrl() {
  const pid = parsePartnerIdFromUrl();
  if (!pid) return;

  const existing = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
  // Не перетираем уже сохранённый partner_id (чтобы “первый клик” был главным)
  if (Number.isFinite(existing) && existing > 0) return;

  try {
    localStorage.setItem(PARTNER_LS_KEY, String(pid));
  } catch {
    // ignore
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const loc = useLocation();
  const nav = useNavigate();

  const notifiedRef = useRef(false);
  const [redirecting, setRedirecting] = useState(false);

  /* ============================================================
     Capture partner_id early (before redirects to /login)
     ============================================================ */
  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

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
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">Проверяем авторизацию…</div>

          <div className="app-loader__skeleton">
            <div className="skeleton p" style={{ width: "72%" }} />
            <div className="skeleton p" style={{ width: "54%" }} />
            <div className="skeleton p" style={{ width: "64%" }} />
          </div>
        </div>
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
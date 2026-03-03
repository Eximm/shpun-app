import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useMe } from "./useMe";
import { enablePush } from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY = "partner_id_pending";

function parsePartnerIdFromUrl(): number {
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
  } catch {}

  return 0;
}

function rememberPartnerIdFromUrl() {
  const pid = parsePartnerIdFromUrl();
  if (!pid) return;

  const existing = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
  if (Number.isFinite(existing) && existing > 0) return;

  try {
    localStorage.setItem(PARTNER_LS_KEY, String(pid));
  } catch {}
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const loc = useLocation();
  const nav = useNavigate();

  const notifiedRef = useRef(false);

  // === Loader visibility state ===
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  /* Capture partner_id early */
  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

  /* Enable push after auth */
  useEffect(() => {
    if (me) enablePush().catch(() => {});
  }, [me]);

  /* Session expired */
  useEffect(() => {
    if (!authRequired) return;
    if (notifiedRef.current) return;

    notifiedRef.current = true;

    toast.error("Сессия истекла", {
      description: "Пожалуйста, авторизуйтесь снова.",
      durationMs: 3500,
    });

    nav("/login", {
      replace: true,
      state: { from: loc.pathname + (loc.search || "") },
    });
  }, [authRequired, nav, loc.pathname, loc.search]);

  /* Loader lifecycle */
  useEffect(() => {
    if (loading) {
      setShowLoader(true);
      setFadeOut(false);
      return;
    }

    // loading finished → fade out
    setFadeOut(true);

    const t = setTimeout(() => {
      setShowLoader(false);
    }, 180); // совпадает с CSS transition

    return () => clearTimeout(t);
  }, [loading]);

  if (!me && !loading && !authRequired) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: loc.pathname + (loc.search || "") }}
      />
    );
  }

  return (
    <>
      {children}

      {showLoader && (
        <div
          className="app-loader"
          style={{
            opacity: fadeOut ? 0 : 1,
            transition: "opacity 180ms ease",
            pointerEvents: loading ? "auto" : "none",
          }}
        >
          <div className="app-loader__card">
            <div className="app-loader__shine" />
            <div className="app-loader__brandRow">
              <div className="app-loader__mark" />
              <div className="app-loader__title">Shpun App</div>
            </div>
            <div className="app-loader__text">Проверяем авторизацию…</div>
          </div>
        </div>
      )}
    </>
  );
}
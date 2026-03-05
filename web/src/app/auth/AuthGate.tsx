// FILE: web/src/app/auth/AuthGate.tsx
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useMe } from "./useMe";
import {
  ensurePushSubscribed,
  enablePushByUserGesture,
  getPushState,
  isPushSupported,
} from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY = "partner_id_pending";

// success-login markers (ставятся в Login.tsx)
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";

// UI marker: чтобы не дёргать пользователя повторно каждый заход
const PUSH_PROMPT_DISMISSED_KEY = "push:prompt_dismissed_at";
const PUSH_PROMPT_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

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

function wasPushPromptDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) || "0");
    if (!ts) return false;
    return Date.now() - ts < PUSH_PROMPT_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markPushPromptDismissedNow() {
  try {
    localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const loc = useLocation();
  const nav = useNavigate();

  const notifiedRef = useRef(false);
  const successShownRef = useRef(false);

  // === Loader visibility state ===
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  // === Push prompt state ===
  const [pushUiReady, setPushUiReady] = useState(false);
  const [pushUiVisible, setPushUiVisible] = useState(false);
  const [pushUiBusy, setPushUiBusy] = useState(false);

  /* Capture partner_id early */
  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

  /* Ensure push subscription after auth (NO prompt) */
  useEffect(() => {
    if (me) ensurePushSubscribed().catch(() => {});
  }, [me]);

  /* Decide whether to show push enable UI after auth */
  useEffect(() => {
    let stopped = false;

    const run = async () => {
      if (!me) {
        setPushUiReady(false);
        setPushUiVisible(false);
        return;
      }

      // не показываем, если не поддерживается
      if (!isPushSupported()) {
        setPushUiReady(true);
        setPushUiVisible(false);
        return;
      }

      // если пользователь недавно закрыл — не трогаем
      if (wasPushPromptDismissedRecently()) {
        setPushUiReady(true);
        setPushUiVisible(false);
        return;
      }

      try {
        const s = await getPushState();

        // если уже включено — не показываем
        const enabled = s.permission === "granted" && s.hasSubscription;
        if (stopped) return;

        setPushUiReady(true);

        // показываем только если не включено и permission ещё не denied
        if (!enabled && s.permission !== "denied") setPushUiVisible(true);
        else setPushUiVisible(false);
      } catch {
        if (stopped) return;
        setPushUiReady(true);
        setPushUiVisible(false);
      }
    };

    void run();

    return () => {
      stopped = true;
    };
  }, [me]);

  async function onEnablePushClick() {
    if (pushUiBusy) return;
    setPushUiBusy(true);

    try {
      const ok = await enablePushByUserGesture();
      if (ok) {
        toast.success("Уведомления включены ✅", {
          description: "Теперь важные события будут приходить даже если вкладка закрыта.",
          durationMs: 2800,
        });
        setPushUiVisible(false);
      } else {
        // если пользователь отказал — просто скрываем, чтобы не раздражать
        markPushPromptDismissedNow();
        setPushUiVisible(false);

        toast.info("Уведомления не включены", {
          description: "Можно включить позже в профиле → Push-уведомления.",
          durationMs: 2800,
        });
      }
    } finally {
      setPushUiBusy(false);
    }
  }

  function onDismissPushClick() {
    markPushPromptDismissedNow();
    setPushUiVisible(false);
  }

  /* Success toast after login */
  useEffect(() => {
    if (!me) return;
    if (successShownRef.current) return;

    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");

      if (!provider) return;

      // защита от старых маркеров (10 секунд)
      if (ts && Date.now() - ts > 10000) {
        sessionStorage.removeItem(AUTH_PENDING_KEY);
        sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
        return;
      }

      successShownRef.current = true;

      toast.success("Вы успешно вошли", {
        description: "Добро пожаловать в Shpun App.",
      });

      sessionStorage.removeItem(AUTH_PENDING_KEY);
      sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
    } catch {
      // ignore
    }
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

    setFadeOut(true);

    const t = setTimeout(() => {
      setShowLoader(false);
    }, 180);

    return () => clearTimeout(t);
  }, [loading]);

  if (!me && !loading && !authRequired) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + (loc.search || "") }} />;
  }

  return (
    <>
      {/* Push prompt (after auth, user gesture) */}
      {me && pushUiReady && pushUiVisible ? (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 72,
            zIndex: 9998,
          }}
        >
          <div
            className="card"
            style={{
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(20,20,22,.92)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="card__body" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(255,255,255,.06)",
                    flex: "0 0 auto",
                  }}
                >
                  🔔
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Включить уведомления?</div>
                  <div style={{ marginTop: 2, fontSize: 12, opacity: 0.75, lineHeight: 1.25 }}>
                    Будем присылать важные события из биллинга даже если вкладка закрыта.
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={onEnablePushClick}
                      disabled={pushUiBusy}
                    >
                      {pushUiBusy ? "…" : "Включить"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={onDismissPushClick}
                      disabled={pushUiBusy}
                    >
                      Не сейчас
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
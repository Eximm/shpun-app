// FILE: web/src/app/auth/AuthGate.tsx
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "./useMe";
import { ensurePushSubscribed, enablePushByUserGesture, getPushState, isPushDisabledByUser, isPushSupported } from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY = "partner_id_pending";

// success-login markers (ставятся в Login.tsx)
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";

/* =========================================================
   Push onboarding prompt (post-auth)
   ========================================================= */

const PUSH_PROMPT_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function pushPromptKey(uid: number) {
  return `push.prompt.dismissed_until:u:${uid}`;
}

function readDismissUntil(uid: number): number {
  if (!uid) return 0;
  try {
    const raw = localStorage.getItem(pushPromptKey(uid));
    const n = Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeDismissUntil(uid: number, untilMs: number) {
  if (!uid) return;
  try {
    localStorage.setItem(pushPromptKey(uid), String(untilMs));
  } catch {
    // ignore
  }
}

function PushPrompt({
  open,
  onEnable,
  onLater,
  loading,
}: {
  open: boolean;
  onEnable: () => void;
  onLater: () => void;
  loading: boolean;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(680px, 100%)",
          pointerEvents: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,.55)",
        }}
      >
        <div className="card__body">
          <div className="h1" style={{ fontSize: 16, margin: 0 }}>
            🔔 Включить уведомления?
          </div>
          <div className="p" style={{ marginTop: 6, marginBottom: 0, opacity: 0.85 }}>
            Будем присылать только важное: пополнения, блокировки, продления и новости сервиса.
          </div>

          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" type="button" onClick={onLater} disabled={loading}>
              Позже
            </button>
            <button className="btn btn--primary" type="button" onClick={onEnable} disabled={loading}>
              {loading ? "…" : "Включить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Partner capture
   ========================================================= */

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
  const successShownRef = useRef(false);

  // === Loader visibility state ===
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  /* Capture partner_id early */
  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

  /* Ensure push subscription after auth (NO prompt) */
  useEffect(() => {
    if (me) ensurePushSubscribed().catch(() => {});
  }, [me]);

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

  // =========================================================
  // Push prompt after auth (user gesture required)
  // =========================================================

  const uid = useMemo(() => {
    const n = Number((me as any)?.profile?.id ?? (me as any)?.profile?.user_id ?? (me as any)?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me]);

  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [pushPromptLoading, setPushPromptLoading] = useState(false);
  const promptCheckedRef = useRef(false);

  useEffect(() => {
    if (!uid) {
      setPushPromptOpen(false);
      promptCheckedRef.current = false;
      return;
    }

    // проверяем один раз на сессию (не спамим)
    if (promptCheckedRef.current) return;
    promptCheckedRef.current = true;

    // показываем только когда UI уже появился (не под лоадером)
    if (showLoader) return;

    // если пользователь уже отключал push — не навязываем
    if (isPushDisabledByUser()) return;

    // если недавно нажали "позже" — не показываем
    const until = readDismissUntil(uid);
    if (until && until > Date.now()) return;

    // если пуши вообще недоступны — не показываем
    if (!isPushSupported()) return;

    (async () => {
      try {
        const s = await getPushState();

        // уже есть permission или подписка — промпт не нужен
        if (s.permission === "granted" && s.hasSubscription) return;

        // если уже "denied" — бессмысленно предлагать тут (только через настройки браузера)
        if (s.permission === "denied") return;

        // по задаче: спрашиваем сразу после авторизации, но requestPermission только по кнопке
        if (s.permission === "default") {
          setPushPromptOpen(true);
        }
      } catch {
        // ignore
      }
    })();
  }, [uid, showLoader]);

  async function onPushLater() {
    if (!uid) return;
    writeDismissUntil(uid, Date.now() + PUSH_PROMPT_DISMISS_MS);
    setPushPromptOpen(false);
  }

  async function onPushEnable() {
    if (pushPromptLoading) return;
    setPushPromptLoading(true);

    try {
      const ok = await enablePushByUserGesture();
      if (ok) {
        setPushPromptOpen(false);
        toast.success("Уведомления включены ✅", { description: "Теперь будем присылать важные события." });
      } else {
        // если пользователь отказал — не спамим повторно сразу
        writeDismissUntil(uid, Date.now() + PUSH_PROMPT_DISMISS_MS);
        setPushPromptOpen(false);
        toast.info("Уведомления не включены", { description: "Можно включить позже в Профиле." });
      }
    } catch {
      toast.error("Не удалось включить уведомления", { description: "Попробуйте позже в Профиле." });
    } finally {
      setPushPromptLoading(false);
    }
  }

  if (!me && !loading && !authRequired) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + (loc.search || "") }} />;
  }

  return (
    <>
      {children}

      <PushPrompt open={pushPromptOpen} onEnable={onPushEnable} onLater={onPushLater} loading={pushPromptLoading} />

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
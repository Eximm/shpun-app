import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "./useMe";
import {
  enablePushByUserGesture,
  getPushState,
  isPushSupported,
  isStandalonePwa,
  type PushState,
} from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY = "partner_id_pending";

// success-login markers (ставятся в Login.tsx)
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";

// persistent auth-session keys
const AUTH_SESSION_ID_PREFIX = "auth.session.id:u:";
const PUSH_ONBOARDING_SEEN_PREFIX = "push.onboarding.seen:";

function isTelegramMiniApp(): boolean {
  try {
    const tg = (window as any)?.Telegram?.WebApp;
    return typeof tg?.initData === "string" && tg.initData.length > 0;
  } catch {
    return false;
  }
}

function authSessionIdKey(uid: number) {
  return `${AUTH_SESSION_ID_PREFIX}${uid}`;
}

function readAuthSessionId(uid: number): string {
  if (!uid) return "";
  try {
    return String(localStorage.getItem(authSessionIdKey(uid)) || "");
  } catch {
    return "";
  }
}

function writeAuthSessionId(uid: number, value: string) {
  if (!uid || !value) return;
  try {
    localStorage.setItem(authSessionIdKey(uid), value);
  } catch {
    // ignore
  }
}

function ensureAuthSessionId(uid: number): string {
  if (!uid) return "";

  const existing = readAuthSessionId(uid);
  if (existing) return existing;

  // fallback для уже авторизованных пользователей после деплоя,
  // без нового логина. Должен быть стабильным между reload / reopen.
  const fallback = `${uid}:persisted`;
  writeAuthSessionId(uid, fallback);
  return fallback;
}

function onboardingSeenKey(uid: number, mode: "browser" | "pwa", authSessionId: string) {
  return `${PUSH_ONBOARDING_SEEN_PREFIX}${mode}:u:${uid}:a:${authSessionId}`;
}

function readSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSeen(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // ignore
  }
}

function hasFreshAuthPending(): boolean {
  try {
    const provider = String(sessionStorage.getItem(AUTH_PENDING_KEY) || "").trim();
    const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");
    if (!provider) return false;
    if (!ts) return true;
    return Date.now() - ts <= 15_000;
  } catch {
    return false;
  }
}

function hasReferralContext(search: string): boolean {
  try {
    const sp = new URLSearchParams(String(search || ""));
    const pid = Number(sp.get("partner_id") || "0");
    if (Number.isFinite(pid) && pid > 0) return true;
  } catch {
    // ignore
  }

  try {
    const pending = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
    if (Number.isFinite(pending) && pending > 0) return true;
  } catch {
    // ignore
  }

  return false;
}

function shouldNotifyExpiredSession(pathname: string, search: string): boolean {
  const p = String(pathname || "").trim().toLowerCase();

  if (p === "/login" || p === "/register" || p === "/set-password") return false;
  if (hasFreshAuthPending()) return false;
  if (hasReferralContext(search)) return false;

  return true;
}

function PushOnboardingModal({
  open,
  busy,
  standalone,
  permission,
  onAccept,
  onDismiss,
}: {
  open: boolean;
  busy: boolean;
  standalone: boolean;
  permission: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  let title = "🔔 Уведомления";
  let hint = "Включите уведомления, чтобы получать важные события.";
  let primaryText = "Включить";

  if (!standalone) {
    title = "📲 Установите приложение";
    hint =
      "Установите Shpun App на устройство. С установленным приложением можно включить уведомления о балансе, оплате и услугах.";
    primaryText = "Понятно";
  } else if (permission === "denied") {
    title = "🔔 Уведомления";
    hint =
      "Уведомления отключены в настройках браузера. Их можно разрешить позже в настройках профиля.";
    primaryText = "Понятно";
  } else {
    title = "🔔 Включите уведомления";
    hint = "Получайте важные события о балансе, оплате и услугах даже когда приложение закрыто.";
    primaryText = "Включить";
  }

  const singlePrimaryButton = !standalone;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        className="card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 92vw)" }}
      >
        <div className="card__body">
          <div className="h1" style={{ fontSize: 18, margin: 0 }}>
            {title}
          </div>

          <p className="p" style={{ marginTop: 8 }}>
            {hint}
          </p>

          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 10 }}>
            {singlePrimaryButton ? (
              <button
                className="btn btn--primary"
                type="button"
                onClick={onDismiss}
                disabled={busy}
              >
                {busy ? "..." : primaryText}
              </button>
            ) : (
              <>
                <button className="btn" type="button" onClick={onDismiss} disabled={busy}>
                  Не сейчас
                </button>

                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={onAccept}
                  disabled={busy}
                >
                  {busy ? "..." : primaryText}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  } catch {
    // ignore
  }

  return 0;
}

function rememberPartnerIdFromUrl() {
  const pid = parsePartnerIdFromUrl();
  if (!pid) return;

  const existing = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
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
  const successShownRef = useRef(false);

  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [pushPromptBusy, setPushPromptBusy] = useState(false);
  const [pushState, setPushState] = useState<PushState>({
    supported: false,
    permission: "unsupported",
    hasSubscription: false,
    standalone: false,
    disabledByUser: false,
  });

  const telegramMiniApp = useMemo(() => isTelegramMiniApp(), []);
  const uid = useMemo(() => {
    const n = Number((me as any)?.profile?.id ?? (me as any)?.profile?.user_id ?? (me as any)?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me]);

  const onboardingCheckedForUidRef = useRef<number>(0);

  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

  // Новая успешная авторизация -> новый authSessionId.
  // Только это событие должно "разрешать спросить заново".
  useEffect(() => {
    if (!me || loading || !uid) return;
    if (telegramMiniApp) return;

    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");

      if (!provider) return;
      if (ts && Date.now() - ts > 10000) return;

      const newSessionId = `${uid}:${ts || Date.now()}`;
      writeAuthSessionId(uid, newSessionId);
    } catch {
      // ignore
    }
  }, [me, loading, uid, telegramMiniApp]);

  useEffect(() => {
    if (!me) return;
    if (successShownRef.current) return;

    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");

      if (!provider) return;

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

  useEffect(() => {
    if (!authRequired) return;
    if (notifiedRef.current) return;

    notifiedRef.current = true;

    const notify = shouldNotifyExpiredSession(loc.pathname, loc.search);

    if (notify) {
      toast.error("Сессия истекла", {
        description: "Пожалуйста, авторизуйтесь снова.",
        durationMs: 3500,
      });
    }

    nav("/login", {
      replace: true,
      state: { from: loc.pathname + (loc.search || "") },
    });
  }, [authRequired, nav, loc.pathname, loc.search]);

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

  useEffect(() => {
    if (!me || !uid) {
      onboardingCheckedForUidRef.current = 0;
      setPushPromptOpen(false);
      setPushPromptBusy(false);
    }
  }, [me, uid]);

  useEffect(() => {
    if (!me || loading) return;

    if (telegramMiniApp) {
      setPushPromptOpen(false);
      return;
    }

    if (!uid) return;

    // На переходах внутри приложения второй раз не заходим.
    if (onboardingCheckedForUidRef.current === uid) return;
    onboardingCheckedForUidRef.current = uid;

    let cancelled = false;

    const run = async () => {
      try {
        const s = await getPushState();
        if (cancelled) return;

        setPushState(s);

        const mode: "browser" | "pwa" = s.standalone ? "pwa" : "browser";
        const sessionId = ensureAuthSessionId(uid);
        const seenKey = onboardingSeenKey(uid, mode, sessionId);

        // Уже спрашивали / уже обработали в этой авторизации -> не показываем.
        if (readSeen(seenKey)) return;

        // Сразу помечаем как обработанное для текущей авторизации.
        // Это и блокирует повтор при reload / reopen / навигации.
        writeSeen(seenKey);

        // Browser mode -> install prompt
        if (!s.standalone) {
          setPushPromptOpen(true);
          return;
        }

        // Installed PWA -> ask for push only if actually disabled
        if (!isPushSupported()) return;

        const pushEnabled = !s.disabledByUser && s.permission === "granted" && s.hasSubscription;
        if (pushEnabled) return;

        setPushPromptOpen(true);
      } catch {
        // ignore
      }
    };

    const t = window.setTimeout(() => {
      void run();
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [me, loading, telegramMiniApp, uid]);

  async function onPushPromptAccept() {
    if (!uid || pushPromptBusy) return;

    setPushPromptBusy(true);

    try {
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description:
            "Откройте меню браузера и выберите «Установить приложение». В установленном приложении можно включить уведомления.",
          durationMs: 4000,
        });

        setPushPromptOpen(false);
        return;
      }

      const ok = await enablePushByUserGesture();

      if (ok) {
        const s = await getPushState().catch(() => null);
        if (s) setPushState(s);

        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });

        setPushPromptOpen(false);
      } else {
        const s = await getPushState().catch(() => null);
        if (s) setPushState(s);

        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });

        setPushPromptOpen(false);
      }
    } finally {
      setPushPromptBusy(false);
    }
  }

  function onPushPromptDismiss() {
    setPushPromptOpen(false);
  }

  if (!me && !loading && !authRequired) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + (loc.search || "") }} />;
  }

  return (
    <>
      {children}

      <PushOnboardingModal
        open={pushPromptOpen}
        busy={pushPromptBusy}
        standalone={pushState.standalone}
        permission={String(pushState.permission)}
        onAccept={onPushPromptAccept}
        onDismiss={onPushPromptDismiss}
      />

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
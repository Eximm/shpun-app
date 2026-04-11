// web/src/app/auth/AuthGate.tsx

import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "./useMe";
import { FirstLoginOnboardingModal } from "./FirstLoginOnboardingModal";
import {
  enablePushByUserGesture,
  getPushState,
  isPushSupported,
  isStandalonePwa,
  type PushState,
} from "../notifications/push";
import { toast } from "../../shared/ui/toast";

const PARTNER_LS_KEY              = "partner_id_pending";
const AUTH_PENDING_KEY            = "auth:pending";
const AUTH_PENDING_AT_KEY         = "auth:pending_at";
const AUTH_SESSION_ID_PREFIX      = "auth.session.id:u:";
const PUSH_ONBOARDING_SEEN_PREFIX = "push.onboarding.seen:";
const AUTH_EVER_KEY               = "auth:ever_succeeded";
const ONBOARDING_DISMISSED_PREFIX = "onboarding.dismissed:";

// ─── helpers ──────────────────────────────────────────────────────────────────

function hasEverSucceededAuth(): boolean {
  try { return localStorage.getItem(AUTH_EVER_KEY) === "1"; } catch { return false; }
}

function isTelegramMiniApp(): boolean {
  try {
    // Считаем Mini App только если есть реальный initData (всегда длинная строка).
    // window.Telegram.WebApp может быть доступен и в браузере после перехода из TG,
    // но initData там пустой или отсутствует.
    const tg = (window as any)?.Telegram?.WebApp;
    const initData = String(tg?.initData ?? "").trim();
    return initData.length > 50;
  } catch { return false; }
}

function hasFreshAuthPending(): boolean {
  try {
    const provider = String(sessionStorage.getItem(AUTH_PENDING_KEY) || "").trim();
    const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");
    if (!provider) return false;
    if (!ts) return true;
    return Date.now() - ts <= 15_000;
  } catch { return false; }
}

function authSessionIdKey(uid: number) { return `${AUTH_SESSION_ID_PREFIX}${uid}`; }

function readAuthSessionId(uid: number): string {
  if (!uid) return "";
  try { return String(localStorage.getItem(authSessionIdKey(uid)) || ""); } catch { return ""; }
}

function writeAuthSessionId(uid: number, value: string) {
  if (!uid || !value) return;
  try { localStorage.setItem(authSessionIdKey(uid), value); } catch { /* ignore */ }
}

function ensureAuthSessionId(uid: number): string {
  if (!uid) return "";
  const existing = readAuthSessionId(uid);
  if (existing) return existing;
  const fallback = `${uid}:persisted`;
  writeAuthSessionId(uid, fallback);
  return fallback;
}

function onboardingSeenKey(uid: number, mode: "browser" | "pwa", authSessionId: string) {
  return `${PUSH_ONBOARDING_SEEN_PREFIX}${mode}:u:${uid}:a:${authSessionId}`;
}

function readSeen(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function writeSeen(key: string) {
  try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
}

/**
 * Сбрасываем seen-флаг для push-онбординга.
 * Вызывается когда обнаруживаем что push не активен —
 * чтобы при следующем визите снова предложить включить.
 */
function clearSeen(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function dismissedKey(uid: number, authSessionId: string) {
  if (!uid) return "";
  return `${ONBOARDING_DISMISSED_PREFIX}u:${uid}:a:${authSessionId || "none"}`;
}

function readDismissed(uid: number, authSessionId: string): boolean {
  const key = dismissedKey(uid, authSessionId);
  if (!key) return false;
  try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
}

function writeDismissed(uid: number, authSessionId: string, value: boolean) {
  const key = dismissedKey(uid, authSessionId);
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch { /* ignore */ }
}

function hasReferralContext(search: string): boolean {
  try {
    const pid = Number(new URLSearchParams(String(search || "")).get("partner_id") || "0");
    if (Number.isFinite(pid) && pid > 0) return true;
  } catch { /* ignore */ }
  try {
    const pending = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
    if (Number.isFinite(pending) && pending > 0) return true;
  } catch { /* ignore */ }
  return false;
}

function shouldNotifyExpiredSession(pathname: string, search: string): boolean {
  const p = String(pathname || "").trim().toLowerCase();
  if (p === "/login" || p === "/register" || p === "/set-password") return false;
  if (hasFreshAuthPending()) return false;
  if (hasReferralContext(search)) return false;
  if (!hasEverSucceededAuth()) return false;
  return true;
}

function parsePartnerIdFromUrl(): number {
  try {
    const direct = new URLSearchParams(window.location.search || "");
    const v1 = direct.get("partner_id");
    if (v1) { const n = Number(v1); if (Number.isFinite(n) && n > 0) return Math.trunc(n); }
    const h = String(window.location.hash || "");
    const qIdx = h.indexOf("?");
    if (qIdx >= 0) {
      const v2 = new URLSearchParams(h.slice(qIdx + 1)).get("partner_id");
      if (v2) { const n = Number(v2); if (Number.isFinite(n) && n > 0) return Math.trunc(n); }
    }
  } catch { /* ignore */ }
  return 0;
}

function rememberPartnerIdFromUrl() {
  const pid = parsePartnerIdFromUrl();
  if (!pid) return;
  const existing = Number(localStorage.getItem(PARTNER_LS_KEY) || "0");
  if (Number.isFinite(existing) && existing > 0) return;
  try { localStorage.setItem(PARTNER_LS_KEY, String(pid)); } catch { /* ignore */ }
}

// ─── PushOnboardingModal ──────────────────────────────────────────────────────

function PushOnboardingModal({
  open, busy, standalone, permission, onAccept, onDismiss,
}: {
  open: boolean; busy: boolean; standalone: boolean;
  permission: string; onAccept: () => void; onDismiss: () => void;
}) {
  if (!open) return null;

  const isInstallOnly = !standalone;
  const isDenied      = standalone && permission === "denied";
  const title         = isInstallOnly ? "📲 Установите приложение" : "🔔 Включите уведомления";
  const hint          = isInstallOnly
    ? "Установите Shpun App на устройство. С установленным приложением можно включить уведомления о балансе, оплате и услугах."
    : isDenied
      ? "Уведомления отключены в настройках браузера. Их можно разрешить позже в настройках профиля."
      : "Получайте важные события о балансе, оплате и услугах даже когда приложение закрыто.";
  const primaryText   = isInstallOnly || isDenied ? "Понятно" : "Включить";

  return (
    <div
      role="dialog" aria-modal="true" onMouseDown={onDismiss}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 9999,
      }}
    >
      <div className="card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(520px, 92vw)" }}>
        <div className="card__body">
          <div className="h1" style={{ fontSize: 18, margin: 0 }}>{title}</div>
          <p className="p" style={{ marginTop: 8 }}>{hint}</p>
          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 10 }}>
            {isInstallOnly ? (
              <button className="btn btn--primary" type="button" onClick={onDismiss} disabled={busy}>
                {busy ? "..." : primaryText}
              </button>
            ) : (
              <>
                <button className="btn" type="button" onClick={onDismiss} disabled={busy}>
                  Не сейчас
                </button>
                <button className="btn btn--primary" type="button" onClick={onAccept} disabled={busy}>
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

// ─── AuthGate ─────────────────────────────────────────────────────────────────

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const loc = useLocation();

  const notifiedRef     = useRef(false);
  const successShownRef = useRef(false);

  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut,    setFadeOut]    = useState(false);

  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [pushPromptBusy, setPushPromptBusy] = useState(false);
  const [pushState, setPushState] = useState<PushState>({
    supported: false, permission: "unsupported",
    hasSubscription: false, standalone: false, disabledByUser: false,
  });

  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const telegramMiniApp = useMemo(() => isTelegramMiniApp(), []);

  const uid = useMemo(() => {
    const n = Number((me as any)?.profile?.id ?? (me as any)?.profile?.user_id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me]);

  const currentAuthSessionId = useMemo(() => uid ? ensureAuthSessionId(uid) : "", [uid]);
  const onboardingCheckedForUidRef = useRef<number>(0);

  const login              = String((me as any)?.profile?.login ?? "").trim();
  const isTelegramBotLogin = login.startsWith("@");
  const emailStepDone      = Boolean((me as any)?.profile?.emailStepDone);
  const passwordStepDone   = Boolean((me as any)?.profile?.passwordStepDone);

  const needsFirstLoginOnboardingRaw =
    !!me && isTelegramBotLogin && (!emailStepDone || !passwordStepDone);

  const needsFirstLoginOnboarding = needsFirstLoginOnboardingRaw && !onboardingDismissed;

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => { rememberPartnerIdFromUrl(); }, []);

  useEffect(() => {
    if (!uid || !currentAuthSessionId) { setOnboardingDismissed(false); return; }
    setOnboardingDismissed(readDismissed(uid, currentAuthSessionId));
  }, [uid, currentAuthSessionId]);

  useEffect(() => {
    if (!uid || !currentAuthSessionId) return;
    if (!needsFirstLoginOnboardingRaw) {
      writeDismissed(uid, currentAuthSessionId, false);
      setOnboardingDismissed(false);
    }
  }, [uid, currentAuthSessionId, needsFirstLoginOnboardingRaw]);

  useEffect(() => {
    if (!me || loading || !uid || telegramMiniApp) return;
    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");
      if (!provider || (ts && Date.now() - ts > 10_000)) return;
      writeAuthSessionId(uid, `${uid}:${ts || Date.now()}`);
    } catch { /* ignore */ }
  }, [me, loading, uid, telegramMiniApp]);

  useEffect(() => {
    if (!me || successShownRef.current) return;
    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");
      if (!provider) return;
      if (ts && Date.now() - ts > 10_000) {
        sessionStorage.removeItem(AUTH_PENDING_KEY);
        sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
        return;
      }
      successShownRef.current = true;
      toast.success("Вы успешно вошли", { description: "Добро пожаловать в Shpun App." });
      sessionStorage.removeItem(AUTH_PENDING_KEY);
      sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
    } catch { /* ignore */ }
  }, [me]);

  useEffect(() => {
    if (!authRequired || notifiedRef.current) return;
    notifiedRef.current = true;
    if (shouldNotifyExpiredSession(loc.pathname, loc.search)) {
      toast.error("Сессия истекла", { description: "Пожалуйста, авторизуйтесь снова.", durationMs: 3500 });
    }
  }, [authRequired, loc.pathname, loc.search]);

  useEffect(() => {
    if (loading) { setShowLoader(true); setFadeOut(false); return; }
    setFadeOut(true);
    const t = setTimeout(() => setShowLoader(false), 180);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (!me || !uid) {
      onboardingCheckedForUidRef.current = 0;
      setPushPromptOpen(false);
      setPushPromptBusy(false);
    }
  }, [me, uid]);

  // ── Push-онбординг ────────────────────────────────────────────────────────
  // Показываем только если:
  //   - Пользователь авторизован и не в Telegram Mini App
  //   - FirstLoginOnboarding не активен
  //   - Push не включён
  //
  // ВАЖНО: seenKey записываем ТОЛЬКО если push уже включён (значит промпт не нужен).
  // Если push не включён — НЕ пишем seen, чтобы при следующем визите снова предложить.
  // Это позволяет корректно обработать случай когда пользователь отозвал разрешения.
  useEffect(() => {
    if (!me || loading) return;
    if (needsFirstLoginOnboarding) { setPushPromptOpen(false); return; }
    if (telegramMiniApp) { setPushPromptOpen(false); return; }
    if (!uid || onboardingCheckedForUidRef.current === uid) return;

    onboardingCheckedForUidRef.current = uid;
    let cancelled = false;

    const run = async () => {
      try {
        const s = await getPushState();
        if (cancelled) return;
        setPushState(s);

        const mode: "browser" | "pwa" = s.standalone ? "pwa" : "browser";
        const seenKey = onboardingSeenKey(uid, mode, ensureAuthSessionId(uid));

        // Определяем активен ли push прямо сейчас
        const pushActive = isPushSupported() &&
          !s.disabledByUser &&
          s.permission === "granted" &&
          s.hasSubscription;

        if (pushActive) {
          // Push включён — помечаем seen и не показываем промпт
          writeSeen(seenKey);
          return;
        }

        // Push не включён — сбрасываем seen чтобы при следующем визите снова предложить
        clearSeen(seenKey);

        if (readSeen(seenKey)) {
          // Если seen всё ещё есть (не сбросился) — не показываем повторно в этой сессии
          return;
        }

        // Показываем промпт
        // Для не-PWA браузера — предлагаем установить приложение
        if (!s.standalone) {
          setPushPromptOpen(true);
          return;
        }

        // Для PWA — предлагаем включить уведомления
        if (!isPushSupported()) return;
        setPushPromptOpen(true);
      } catch { /* ignore */ }
    };

    const t = window.setTimeout(() => void run(), 600);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [me, loading, telegramMiniApp, uid, needsFirstLoginOnboarding]);

  async function onPushPromptAccept() {
    if (!uid || pushPromptBusy) return;
    setPushPromptBusy(true);
    try {
      if (!isStandalonePwa()) {
        toast.info("Установите приложение", {
          description: "Откройте меню браузера и выберите «Установить приложение».",
          durationMs: 4000,
        });
        setPushPromptOpen(false);
        // Для не-PWA: помечаем seen чтобы не спамить при каждом визите.
        // При следующей сессии предложим снова если приложение не установлено.
        const mode: "browser" | "pwa" = "browser";
        writeSeen(onboardingSeenKey(uid, mode, ensureAuthSessionId(uid)));
        return;
      }

      const ok = await enablePushByUserGesture();
      const s = await getPushState().catch(() => null);
      if (s) setPushState(s);

      if (ok) {
        toast.success("Уведомления включены ✅", {
          description: "Теперь вы будете получать важные события.",
        });
        // Push включён — помечаем seen навсегда
        writeSeen(onboardingSeenKey(uid, "pwa", ensureAuthSessionId(uid)));
      } else {
        toast.info("Уведомления не включены", {
          description: "Их можно включить позже в профиле.",
          durationMs: 2500,
        });
        // Не включил — не пишем seen, предложим в следующий раз
      }
      setPushPromptOpen(false);
    } finally {
      setPushPromptBusy(false);
    }
  }

  function onSkipOnboarding() {
    if (!uid || !currentAuthSessionId) return;
    writeDismissed(uid, currentAuthSessionId, true);
    setOnboardingDismissed(true);
  }

  const authInProgress = hasFreshAuthPending();

  // ── Лоадер ────────────────────────────────────────────────────────────────

  if (loading || authInProgress) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">
            {authInProgress ? "Завершаем вход…" : "Проверяем авторизацию…"}
          </div>
        </div>
      </div>
    );
  }

  // ── Не авторизован ─────────────────────────────────────────────────────────

  if (authRequired || !me) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + (loc.search || "") }} />;
  }

  // ── Основной рендер ────────────────────────────────────────────────────────

  return (
    <>
      {children}

      <FirstLoginOnboardingModal
        open={needsFirstLoginOnboarding}
        me={me}
        onSkip={onSkipOnboarding}
      />

      <PushOnboardingModal
        open={!needsFirstLoginOnboarding && pushPromptOpen}
        busy={pushPromptBusy}
        standalone={pushState.standalone}
        permission={String(pushState.permission)}
        onAccept={onPushPromptAccept}
        onDismiss={() => {
          setPushPromptOpen(false);
          // При dismiss не пишем seen — предложим снова в следующей сессии
          // (onboardingCheckedForUidRef сбросится при перезагрузке страницы)
        }}
      />

      {showLoader && (
        <div
          className="app-loader"
          style={{ opacity: fadeOut ? 0 : 1, transition: "opacity 180ms ease", pointerEvents: "none" }}
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

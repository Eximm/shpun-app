// web/src/app/auth/AuthGate.tsx

import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe, refetchMe } from "./useMe";
import { FirstLoginOnboardingModal } from "./FirstLoginOnboardingModal";
import { FirstPayBonusModal } from "./FirstPayBonusModal";
import { useOnboardingPromptSlot } from "../../shared/onboardingPromptCoordinator";
import {
  enablePushByUserGesture,
  ensurePushSubscribed,
  getPushState,
  isPushSupported,
  type PushState,
} from "../notifications/push";
import { toast } from "../../shared/ui/toast";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { isTelegramMiniAppEnv } from "../../shared/telegram/sdk";
import { hasSeenOnboardingPrompt, markOnboardingPromptSeen } from "../../shared/onboardingPromptSession";

const PARTNER_LS_KEY = "partner_id_pending";
const AUTH_PENDING_KEY = "auth:pending";
const AUTH_PENDING_AT_KEY = "auth:pending_at";
const AUTH_SESSION_ID_PREFIX = "auth.session.id:u:";
const AUTH_EVER_KEY = "auth:ever_succeeded";
const ONBOARDING_DISMISSED_PREFIX = "onboarding.dismissed:";
const FIRST_PAY_BONUS_DISMISSED_PREFIX = "first-pay-bonus.dismissed:";

function firstPayBonusDismissedKey(userId: number, authSessionId: string): string {
  return `${FIRST_PAY_BONUS_DISMISSED_PREFIX}${userId}:${authSessionId || "current"}`;
}

function readFirstPayBonusDismissed(userId: number, authSessionId: string): boolean {
  try {
    return sessionStorage.getItem(firstPayBonusDismissedKey(userId, authSessionId)) === "1";
  } catch {
    return false;
  }
}

function writeFirstPayBonusDismissed(userId: number, authSessionId: string) {
  try {
    sessionStorage.setItem(firstPayBonusDismissedKey(userId, authSessionId), "1");
  } catch {
    // ignore
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function hasEverSucceededAuth(): boolean {
  try {
    return localStorage.getItem(AUTH_EVER_KEY) === "1";
  } catch {
    return false;
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

function clearAuthPending() {
  try {
    sessionStorage.removeItem(AUTH_PENDING_KEY);
    sessionStorage.removeItem(AUTH_PENDING_AT_KEY);
  } catch {
    // ignore
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
  const fallback = `${uid}:persisted`;
  writeAuthSessionId(uid, fallback);
  return fallback;
}

function dismissedKey(uid: number, authSessionId: string) {
  if (!uid) return "";
  return `${ONBOARDING_DISMISSED_PREFIX}u:${uid}:a:${authSessionId || "none"}`;
}

function readDismissed(uid: number, authSessionId: string): boolean {
  const key = dismissedKey(uid, authSessionId);
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(uid: number, authSessionId: string, value: boolean) {
  const key = dismissedKey(uid, authSessionId);
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isPushPromptShownThisSession(): boolean {
  return hasSeenOnboardingPrompt("push");
}

function markPushPromptShownThisSession() {
  markOnboardingPromptSeen("push");
}

function isPushActive(s: PushState): boolean {
  return (
    isPushSupported() &&
    !s.disabledByUser &&
    s.permission === "granted" &&
    s.hasSubscription
  );
}

function hasReferralContext(search: string): boolean {
  try {
    const pid = Number(new URLSearchParams(String(search || "")).get("partner_id") || "0");
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
  if (!hasEverSucceededAuth()) return false;
  return true;
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
      const v2 = new URLSearchParams(h.slice(qIdx + 1)).get("partner_id");
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

// ─── PushOnboardingModal ──────────────────────────────────────────────────────

function PushOnboardingModal({
  open,
  busy,
  permission,
  guide,
  t,
  onAccept,
  onDismiss,
}: {
  open: boolean;
  busy: boolean;
  permission: string;
  guide: boolean;
  t: (key: string) => string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  const isDenied = permission === "denied";
  const showGuide = guide || isDenied;
  const title = showGuide ? t("pwa.onboarding.push.guide.title") : t("pwa.onboarding.push.title");

  const hint = showGuide
    ? (isDenied ? t("pwa.onboarding.push.denied") : t("pwa.onboarding.push.guide.text"))
    : t("pwa.onboarding.push.text");

  const primaryText = showGuide
    ? t("pwa.onboarding.button.ok")
    : t("pwa.onboarding.button.enable");

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onDismiss}
      className="modal push-onboarding"
      style={{ zIndex: 9999 }}
    >
      <div
        className="card modal__card push-onboarding__card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card__body">
          <div className="onboarding-modal__head">
            <div className="onboarding-modal__icon" aria-hidden="true">
              {showGuide ? "🛠️" : "🔔"}
            </div>
            <div>
              <div className="modal__title">
                {title}
              </div>
              <p className="p onboarding-modal__text">
                {hint}
              </p>
            </div>
          </div>
          {showGuide ? (
            <div className="pre pwa-install-steps">
              {t("pwa.onboarding.push.guide.steps")}
            </div>
          ) : null}
          <div className={`actions ${showGuide ? "actions--1" : "actions--2"} modal-actions`}>
            {showGuide ? (
              <button
                className="btn btn--primary"
                type="button"
                onClick={onDismiss}
                disabled={busy}
              >
                {t("pwa.onboarding.button.ok")}
              </button>
            ) : (
              <>
                <button className="btn" type="button" onClick={onDismiss} disabled={busy}>
                  {t("pwa.onboarding.button.later")}
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

// ─── AuthGate ─────────────────────────────────────────────────────────────────

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading, authRequired } = useMe();
  const { t } = useI18n();
  const loc = useLocation();

  const notifiedRef = useRef(false);
  const successShownRef = useRef(false);

  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [pushPromptBusy, setPushPromptBusy] = useState(false);
  const [pushGuideOpen, setPushGuideOpen] = useState(false);
  const [pushState, setPushState] = useState<PushState>({
    supported: false,
    permission: "unsupported",
    hasSubscription: false,
    standalone: false,
    disabledByUser: false,
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [firstPayBonusDismissed, setFirstPayBonusDismissed] = useState(false);
  const telegramMiniApp = useMemo(() => isTelegramMiniAppEnv(), []);

  const uid = useMemo(() => {
    const n = Number((me as any)?.profile?.id ?? (me as any)?.profile?.user_id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me]);

  const currentAuthSessionId = useMemo(
    () => (uid ? ensureAuthSessionId(uid) : ""),
    [uid]
  );
  const serverAuthSessionId = String((me as any)?.authSessionId ?? currentAuthSessionId);
  const onboardingCheckedForUidRef = useRef<number>(0);

  const login = String((me as any)?.profile?.login ?? "").trim();
  const isTelegramBotLogin = login.startsWith("@");
  const emailStepDone = Boolean((me as any)?.profile?.emailStepDone);
  const passwordStepDone = Boolean((me as any)?.profile?.passwordStepDone);

  const needsFirstLoginOnboardingRaw =
    !!me && isTelegramBotLogin && (!emailStepDone || !passwordStepDone);

  const needsFirstLoginOnboarding =
    needsFirstLoginOnboardingRaw && !onboardingDismissed;
  const firstPayBonus = (me as any)?.referralBonus;
  const showFirstPayBonus =
    Boolean(firstPayBonus?.pending) &&
    Number(firstPayBonus?.percent ?? 0) > 0 &&
    !firstPayBonusDismissed;
  const profilePromptGranted = useOnboardingPromptSlot("profile", needsFirstLoginOnboarding);
  const bonusPromptGranted = useOnboardingPromptSlot(
    "first_pay_bonus",
    !needsFirstLoginOnboarding && showFirstPayBonus
  );
  const pushPromptGranted = useOnboardingPromptSlot(
    "push",
    !needsFirstLoginOnboarding && !showFirstPayBonus && pushPromptOpen
  );

  const authInProgress = hasFreshAuthPending();

  useEffect(() => {
    const onInstalled = () => {
      setPushPromptOpen(false);

      window.setTimeout(() => {
        if (!uid || telegramMiniApp || needsFirstLoginOnboarding) return;
        void getPushState().then((s) => {
          setPushState(s);
          if (s.standalone && !isPushActive(s)) setPushPromptOpen(true);
        }).catch(() => {});
      }, 450);
    };

    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [needsFirstLoginOnboarding, telegramMiniApp, uid]);

  useEffect(() => {
    if (!authInProgress) return;

    let attempts = 0;
    const MAX_ATTEMPTS = 25;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attempts++;

      try {
        const status = await apiFetch<{
          ok: true;
          authenticated: boolean;
          user_id?: number | null;
        }>("/auth/status", { method: "GET" });

        if (status?.authenticated) {
          try {
            await refetchMe();
          } finally {
            clearAuthPending();
          }
          return;
        }
      } catch {
        // ignore
      }

      if (attempts < MAX_ATTEMPTS && !cancelled) {
        window.setTimeout(poll, 300);
      } else if (!cancelled) {
        clearAuthPending();
      }
    };

    const t = window.setTimeout(poll, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [authInProgress]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    rememberPartnerIdFromUrl();
  }, []);

  useEffect(() => {
    if (!uid || !currentAuthSessionId) {
      setOnboardingDismissed(false);
      setFirstPayBonusDismissed(false);
      return;
    }
    setOnboardingDismissed(readDismissed(uid, currentAuthSessionId));
    setFirstPayBonusDismissed(readFirstPayBonusDismissed(uid, serverAuthSessionId));
  }, [uid, currentAuthSessionId, serverAuthSessionId]);

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
    } catch {
      // ignore
    }
  }, [me, loading, uid, telegramMiniApp]);

  useEffect(() => {
    if (!me || successShownRef.current) return;
    try {
      const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
      const ts = Number(sessionStorage.getItem(AUTH_PENDING_AT_KEY) || "0");
      if (!provider) return;
      if (ts && Date.now() - ts > 10_000) {
        clearAuthPending();
        return;
      }
      successShownRef.current = true;
      toast.success("Вы успешно вошли", {
        description: "Добро пожаловать в Shpun App.",
      });
      clearAuthPending();
    } catch {
      // ignore
    }
  }, [me]);

  useEffect(() => {
    if (!authRequired || notifiedRef.current) return;
    notifiedRef.current = true;
    if (shouldNotifyExpiredSession(loc.pathname, loc.search)) {
      toast.error("Сессия истекла", {
        description: "Пожалуйста, авторизуйтесь снова.",
        durationMs: 3500,
      });
    }
  }, [authRequired, loc.pathname, loc.search]);

  useEffect(() => {
    if (!me || !uid) {
      onboardingCheckedForUidRef.current = 0;
      setPushPromptOpen(false);
      setPushPromptBusy(false);
      setPushGuideOpen(false);
    }
  }, [me, uid]);

  // ── Push/install онбординг ────────────────────────────────────────────────
  useEffect(() => {
    if (!me || loading) return;
    if (needsFirstLoginOnboarding) {
      setPushPromptOpen(false);
      return;
    }
    if (telegramMiniApp) {
      setPushPromptOpen(false);
      return;
    }
    if (!uid || onboardingCheckedForUidRef.current === uid) return;

    onboardingCheckedForUidRef.current = uid;
    let cancelled = false;

    const run = async () => {
      try {
        await ensurePushSubscribed().catch(() => false);
        const s = await getPushState();
        if (cancelled) return;
        setPushState(s);

        // Если пуши уже активны — ничего не показываем
        if (isPushActive(s)) return;

        // Если промпт уже показывали в этой сессии — не спамим
        if (isPushPromptShownThisSession()) return;

        if (!s.supported) return;

        await waitForPwaInstallModalToClose();
        if (cancelled) return;
        setPushGuideOpen(s.permission === "denied");
        setPushPromptOpen(true);
        markPushPromptShownThisSession();
      } catch {
        // ignore
      }
    };

    const t = window.setTimeout(() => void run(), 600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [me, loading, telegramMiniApp, uid, needsFirstLoginOnboarding]);

  async function onPushPromptAccept() {
    if (!uid || pushPromptBusy) return;
    setPushPromptBusy(true);

    try {
      const ok = await enablePushByUserGesture();
      const s = await getPushState().catch(() => null);
      if (s) setPushState(s);

      if (ok) {
        toast.success(t("pwa.onboarding.push.enabled.title"), {
          description: t("pwa.onboarding.push.enabled.text"),
        });
        setPushGuideOpen(false);
        setPushPromptOpen(false);
      } else {
        setPushGuideOpen(true);
        setPushPromptOpen(true);
      }
    } finally {
      setPushPromptBusy(false);
    }
  }

  function onSkipOnboarding() {
    if (!uid || !currentAuthSessionId) return;
    writeDismissed(uid, currentAuthSessionId, true);
    setOnboardingDismissed(true);
  }

  // ── Лоадер ────────────────────────────────────────────────────────────────

  const shouldShowBlockingLoader = (!me && loading) || authInProgress;

  if (shouldShowBlockingLoader) {
    return (
      <div
        className="app-loader"
        style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}
      >
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
    return (
      <Navigate
        to={{ pathname: "/login", search: loc.search, hash: loc.hash }}
        replace
        state={{ from: loc.pathname + (loc.search || "") + (loc.hash || "") }}
      />
    );
  }

  // ── Основной рендер ────────────────────────────────────────────────────────

  return (
    <>
      {children}

      <FirstLoginOnboardingModal
        open={profilePromptGranted}
        me={me}
        onSkip={onSkipOnboarding}
      />

      <FirstPayBonusModal
        open={bonusPromptGranted}
        percent={Number(firstPayBonus?.percent ?? 0)}
        onClose={() => {
          if (uid) writeFirstPayBonusDismissed(uid, serverAuthSessionId);
          setFirstPayBonusDismissed(true);
        }}
      />

      <PushOnboardingModal
        open={pushPromptGranted}
        busy={pushPromptBusy}
        permission={String(pushState.permission)}
        guide={pushGuideOpen}
        t={t}
        onAccept={onPushPromptAccept}
        onDismiss={() => { setPushPromptOpen(false); setPushGuideOpen(false); }}
      />

    </>
  );
}

async function waitForPwaInstallModalToClose(timeoutMs = 12_000): Promise<void> {
  const started = Date.now();
  while (document.querySelector(".pwa-install-modal") && Date.now() - started < timeoutMs) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
}

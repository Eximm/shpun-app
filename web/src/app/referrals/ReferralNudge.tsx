import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { useI18n } from "../../shared/i18n";

const MIN_DELAY_MS = 45_000;
const MAX_DELAY_MS = 180_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHOW_MS = 14_000;

const HIDDEN_ROUTES = ["/login", "/legal", "/referrals"];

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function storageKey(uid: number) {
  return `referral:nudge:v1:u:${uid}`;
}

function canShowForUser(uid: number) {
  try {
    const last = Number(localStorage.getItem(storageKey(uid)) || "0");
    return !last || Date.now() - last > DAY_MS;
  } catch {
    return true;
  }
}

function markShown(uid: number) {
  try { localStorage.setItem(storageKey(uid), String(Date.now())); } catch { /* ignore */ }
}

function isHiddenRoute(pathname: string) {
  return HIDDEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function ReferralNudge({ enabled = true }: { enabled?: boolean }) {
  const { t } = useI18n();
  const loc = useLocation();
  const { me } = useMe() as any;
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const uid = useMemo(() => {
    const n = Number(me?.profile?.id ?? me?.profile?.user_id ?? me?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me?.profile?.id, me?.profile?.user_id, me?.id]);

  const messageKey = useMemo(() => {
    const keys = [
      "referralNudge.message.1",
      "referralNudge.message.2",
      "referralNudge.message.3",
      "referralNudge.message.4",
    ];
    return keys[Math.floor(Math.random() * keys.length)] ?? keys[0];
  }, [visible]);

  function clearTimers() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    timerRef.current = null;
    hideTimerRef.current = null;
  }

  function dismiss() {
    setVisible(false);
    if (uid) markShown(uid);
  }

  useEffect(() => {
    clearTimers();
    setVisible(false);

    if (!enabled || !uid || isHiddenRoute(loc.pathname) || !canShowForUser(uid)) return;
    if (document.visibilityState !== "visible") return;

    timerRef.current = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || isHiddenRoute(window.location.pathname)) return;
      markShown(uid);
      setVisible(true);
      hideTimerRef.current = window.setTimeout(() => setVisible(false), SHOW_MS);
    }, randomDelay());

    return clearTimers;
  }, [enabled, uid, loc.pathname]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") setVisible(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!enabled || !uid || !visible || isHiddenRoute(loc.pathname)) return null;

  return (
    <div className="referralNudge" role="status" aria-live="polite">
      <button className="referralNudge__close" type="button" onClick={dismiss} aria-label={t("common.close")}>
        ×
      </button>
      <div className="referralNudge__eyebrow">{t("referralNudge.eyebrow")}</div>
      <div className="referralNudge__text">{t(messageKey)}</div>
      <div className="referralNudge__actions">
        <Link className="btn btn--primary referralNudge__cta" to="/referrals" onClick={dismiss}>
          {t("referralNudge.cta")}
        </Link>
      </div>
    </div>
  );
}


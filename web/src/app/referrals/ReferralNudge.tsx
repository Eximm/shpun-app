import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { useI18n } from "../../shared/i18n";
import { toast } from "../../shared/ui/toast";

type ReferralToastPlan = {
  day: string;
  scheduledAt: number;
  shownAt?: number;
  titleIndex: number;
  descIndex: number;
  actionIndex: number;
};

const ACTIVE_MIN_DELAY_MS = 60 * 1000;
const ACTIVE_MAX_DELAY_MS = 4 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const DUE_JITTER_MS = 45_000;
const TOAST_DURATION_MS = 12_000;
const STORAGE_PREFIX = "referral:daily-toast:v1:u:";
const HIDDEN_ROUTES = ["/login", "/legal", "/referrals"];

const TITLE_KEYS = [
  "referralNudge.toast.title.1",
  "referralNudge.toast.title.2",
  "referralNudge.toast.title.3",
  "referralNudge.toast.title.4",
  "referralNudge.toast.title.5",
  "referralNudge.toast.title.6",
  "referralNudge.toast.title.7",
  "referralNudge.toast.title.8",
] as const;

const DESC_KEYS = [
  "referralNudge.toast.desc.1",
  "referralNudge.toast.desc.2",
  "referralNudge.toast.desc.3",
  "referralNudge.toast.desc.4",
  "referralNudge.toast.desc.5",
  "referralNudge.toast.desc.6",
  "referralNudge.toast.desc.7",
  "referralNudge.toast.desc.8",
  "referralNudge.toast.desc.9",
  "referralNudge.toast.desc.10",
] as const;

const ACTION_KEYS = [
  "referralNudge.toast.action.1",
  "referralNudge.toast.action.2",
  "referralNudge.toast.action.3",
  "referralNudge.toast.action.4",
] as const;

function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfLocalDayMs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
}

function msUntilNextLocalDay(nowMs = Date.now()) {
  return Math.max(1000, endOfLocalDayMs(new Date(nowMs)) - nowMs + 1500);
}

function randomIndex(length: number) {
  return Math.max(0, Math.floor(Math.random() * Math.max(1, length)));
}

function storageKey(uid: number) {
  return `${STORAGE_PREFIX}${uid}`;
}

function createPlan(day: string, nowMs: number): ReferralToastPlan {
  const activeDelay = ACTIVE_MIN_DELAY_MS + Math.floor(Math.random() * (ACTIVE_MAX_DELAY_MS - ACTIVE_MIN_DELAY_MS));
  return {
    day,
    scheduledAt: nowMs + activeDelay,
    titleIndex: randomIndex(TITLE_KEYS.length),
    descIndex: randomIndex(DESC_KEYS.length),
    actionIndex: randomIndex(ACTION_KEYS.length),
  };
}

function readPlan(uid: number): ReferralToastPlan | null {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReferralToastPlan;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.day || !Number.isFinite(Number(parsed.scheduledAt))) return null;
    return {
      day: String(parsed.day),
      scheduledAt: Number(parsed.scheduledAt),
      shownAt: Number.isFinite(Number(parsed.shownAt)) ? Number(parsed.shownAt) : undefined,
      titleIndex: Number.isFinite(Number(parsed.titleIndex)) ? Number(parsed.titleIndex) : 0,
      descIndex: Number.isFinite(Number(parsed.descIndex)) ? Number(parsed.descIndex) : 0,
      actionIndex: Number.isFinite(Number(parsed.actionIndex)) ? Number(parsed.actionIndex) : 0,
    };
  } catch {
    return null;
  }
}

function savePlan(uid: number, plan: ReferralToastPlan) {
  try { localStorage.setItem(storageKey(uid), JSON.stringify(plan)); } catch { /* ignore */ }
}

function getTodayPlan(uid: number, nowMs = Date.now()) {
  const day = localDayKey(new Date(nowMs));
  const saved = readPlan(uid);
  if (saved?.day === day) return saved;
  const next = createPlan(day, nowMs);
  savePlan(uid, next);
  return next;
}

function isHiddenRoute(pathname: string) {
  return HIDDEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function hasOpenModal() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

function keyAt<T extends readonly string[]>(keys: T, index: number) {
  return keys[Math.abs(index) % keys.length] ?? keys[0];
}

export function ReferralNudge({ enabled = true }: { enabled?: boolean }) {
  const { t } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const { me } = useMe() as any;
  const timerRef = useRef<number | null>(null);
  const pathRef = useRef(loc.pathname);

  const uid = useMemo(() => {
    const n = Number(me?.profile?.id ?? me?.profile?.user_id ?? me?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me?.profile?.id, me?.profile?.user_id, me?.id]);

  function clearTimer() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => {
    pathRef.current = loc.pathname;
  }, [loc.pathname]);

  useEffect(() => {
    clearTimer();
    if (!enabled || !uid) return;

    const schedule = (delayMs: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const plan = getTodayPlan(uid);
        const now = Date.now();
        if (plan.shownAt) {
          schedule(msUntilNextLocalDay());
          return;
        }

        if (plan.scheduledAt > now) {
          schedule(plan.scheduledAt - now);
          return;
        }

        if (
          document.visibilityState !== "visible" ||
          isHiddenRoute(pathRef.current) ||
          hasOpenModal()
        ) {
          schedule(RETRY_DELAY_MS);
          return;
        }

        const shownPlan = { ...plan, shownAt: Date.now() };
        savePlan(uid, shownPlan);
        toast.info(t(keyAt(TITLE_KEYS, plan.titleIndex)), {
          description: t(keyAt(DESC_KEYS, plan.descIndex)),
          actionLabel: t(keyAt(ACTION_KEYS, plan.actionIndex)),
          durationMs: TOAST_DURATION_MS,
          onAction: () => nav("/referrals"),
        });
        schedule(msUntilNextLocalDay());
      }, delayMs);
    };

    const plan = getTodayPlan(uid);
    if (plan.shownAt) {
      schedule(msUntilNextLocalDay());
      return clearTimer;
    }

    const now = Date.now();
    const delay = plan.scheduledAt <= now
      ? ACTIVE_MIN_DELAY_MS + Math.floor(Math.random() * DUE_JITTER_MS)
      : Math.max(0, plan.scheduledAt - now);
    schedule(delay);

    return clearTimer;
  }, [enabled, uid, nav, t]);

  return null;
}

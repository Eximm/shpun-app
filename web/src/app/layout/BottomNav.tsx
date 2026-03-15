// FILE: web/src/app/layout/BottomNav.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { hasNewNotifications } from "../notifications/notifyState";
import { useI18n } from "../../shared/i18n";

function Tab({
  to,
  label,
  icon,
  end,
  badge,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => "tab" + (isActive ? " tab--active" : "")}>
      <span className="tab__icon bottomNav__iconWrap" aria-hidden="true">
        {icon}
        {badge}
      </span>

      <span className="tab__label">{label}</span>

      <span className="tab__indicator" aria-hidden="true" />
    </NavLink>
  );
}

function Dot() {
  return <span aria-hidden="true" className="bottomNav__dot" />;
}

const CHECK_MS = 60_000;

export function BottomNav() {
  const { t } = useI18n();
  const loc = useLocation();
  const { me } = useMe() as any;

  const uid = useMemo(() => {
    const n = Number(me?.profile?.id ?? me?.profile?.user_id ?? me?.id ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [me?.profile?.id, me?.profile?.user_id, me?.id]);

  const [hasNew, setHasNew] = useState(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const onFeed = loc.pathname === "/feed";

  function clearTimer() {
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function check() {
    if (!uid) return;
    if (inFlightRef.current) return;

    if (onFeed) {
      setHasNew(false);
      return;
    }

    inFlightRef.current = true;
    try {
      const ok = await hasNewNotifications(uid);
      setHasNew(ok);
    } catch {
      // ignore
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!uid) {
      setHasNew(false);
      clearTimer();
      return;
    }

    void check();

    clearTimer();
    timerRef.current = window.setInterval(() => void check(), CHECK_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, onFeed]);

  useEffect(() => {
    if (onFeed) setHasNew(false);
  }, [onFeed]);

  return (
    <nav className="bottomnav" role="navigation" aria-label={t("bottomNav.aria", "Навигация по приложению")}>
      <div className="bottomnav__inner">
        <Tab
          to="/"
          end
          label={t("bottomNav.home", "Главная")}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.2Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          }
        />

        <Tab
          to="/feed"
          label={t("bottomNav.feed", "Новости")}
          badge={hasNew ? <Dot /> : null}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M6 7h12M6 12h12M6 17h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path
                d="M4 6a2 2 0 0 1 2-2h11a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
                stroke="currentColor"
                strokeWidth="1.7"
                opacity="0.5"
              />
            </svg>
          }
        />

        <Tab
          to="/services"
          label={t("bottomNav.services", "Услуги")}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          }
        />

        <Tab
          to="/payments"
          label={t("bottomNav.payments", "Оплата")}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path d="M4 9h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          }
        />

        <Tab
          to="/profile"
          label={t("bottomNav.profile", "Профиль")}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.7" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          }
        />
      </div>
    </nav>
  );
}
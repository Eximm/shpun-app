import { useEffect, type ReactNode, type Ref } from "react";
import type { AdminTab } from "./types";

/* ─── Admin navigation model + icons ─────────────────────────────────────── */

export type AdminNavIconName =
  | "overview"
  | "reviews"
  | "broadcasts"
  | "orders"
  | "trial"
  | "categories"
  | "referral"
  | "support"
  | "servers";

/** Single source of truth for admin navigation items (sidebar + mobile picker + overview shortcuts). */
export type AdminNavItem = {
  tab: AdminTab;
  title: string;
  subtitle: string;
  icon: AdminNavIconName;
  badge?: number;
};

export function AdminSectionIcon({ name, size = 18 }: { name: AdminNavIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true };

  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case "reviews":
      return (
        <svg {...common}>
          <path
            d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.6l5.9-.8L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "broadcasts":
      return (
        <svg {...common}>
          <path d="M4 10v4a1 1 0 0 0 1 1h2l4 3V6L7 9H5a1 1 0 0 0-1 1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M18 6a8 8 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.6" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path
            d="M4 5h2l1.6 9.2a1 1 0 0 0 1 .8h7.9a1 1 0 0 0 1-.8L19 7H7"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9.5" cy="19" r="1.3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="17" cy="19" r="1.3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "trial":
      return (
        <svg {...common}>
          <path
            d="M12 3l7 3v5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "categories":
      return (
        <svg {...common}>
          <path d="M12 3.5 20 8l-8 4.5L4 8l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M4 12l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" opacity="0.7" />
          <path d="M4 16l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" opacity="0.45" />
        </svg>
      );
    case "referral":
      return (
        <svg {...common}>
          <circle cx="7" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="17" cy="6.5" r="2.6" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="17" cy="17.5" r="2.6" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.3 10.8l5.4-3M9.3 13.2l5.4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "support":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "servers":
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3.5" y="14" width="17" height="6" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="7.5" cy="7" r="1" fill="currentColor" />
          <circle cx="7.5" cy="17" r="1" fill="currentColor" />
        </svg>
      );
  }
}

export function AdminMetric({
  label,
  value,
  tone = "soft",
}: {
  label: string;
  value: ReactNode;
  tone?: "soft" | "ok" | "warn" | "bad";
}) {
  const chipClass =
    tone === "ok" ? "chip--ok" : tone === "warn" ? "chip--warn" : tone === "bad" ? "chip--bad" : "chip--soft";

  return (
    <div className="admin-metric">
      <div className="admin-metric__label">{label}</div>
      <div className="admin-metric__value">{value}</div>
      <div className="admin-metric__meta">
        <span className={`chip ${chipClass}`}>LIVE</span>
      </div>
    </div>
  );
}

export function ModalShell({
  title,
  kicker,
  onClose,
  children,
  contentRef,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
  contentRef?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modal admin-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__card card admin-modal__card" onClick={(ev) => ev.stopPropagation()}>
        <div className="card__body admin-modal__body">
          <div className="modal__head admin-modal__head">
            <div className="admin-modal__headMain">
              {kicker ? <div className="kicker">{kicker}</div> : null}
              <div className="modal__title admin-modal__title">{title}</div>
            </div>

            <button
              type="button"
              className="btn btn--soft modal__close admin-modal__close"
              onClick={onClose}
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>

          <div className="modal__content admin-modal__content" ref={contentRef}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
/* ─── Unread + section icons ─────────────────────────────────────────────── */

export function UnreadMarker({
  count,
  variant = "dot",
}: {
  count?: number;
  variant?: "dot" | "badge";
}) {
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (variant === "badge") {
    return (
      <span className="unreadBadge" title="Есть непрочитанные">
        {n > 99 ? "99+" : n}
      </span>
    );
  }
  return <span className="unreadDot" aria-label="Непрочитано" title="Непрочитано" />;
}

export function SupportTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PartnershipTabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15.5" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4 18.5a4.5 4.5 0 0 1 9 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M14.5 18.5a4.5 4.5 0 0 1 5.5-4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  );
}

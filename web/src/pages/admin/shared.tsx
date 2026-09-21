import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useI18n } from "../../shared/i18n";
import type { AdminTab } from "./types";

/* ─── Admin navigation model + icons ─────────────────────────────────────── */

import { AdminSectionIcon } from "./icons";
import type { AdminNavIconName } from "./adminIconMap";

export { AdminSectionIcon } from "./icons";
export { ADMIN_SECTION_ICON, activityIconName } from "./adminIconMap";
export type { AdminNavIconName } from "./adminIconMap";

/** Single source of truth for admin navigation items (sidebar + mobile picker + overview shortcuts). */
export type AdminNavItem = {
  tab: AdminTab;
  title: string;
  subtitle: string;
  icon: AdminNavIconName;
  badge?: number;
};

/* ─── Compact section header (single pattern for every admin section) ────── */

export function AdminSectionHeader({
  kicker,
  title,
  subtitle,
  icon,
  actions,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  icon?: AdminNavIconName;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-sectionHeader">
      <div className="admin-sectionHeader__main">
        {(icon || kicker) ? (
          <div className="admin-sectionHeader__kicker">
            {icon ? <AdminSectionIcon name={icon} size={14} /> : null}
            {kicker}
          </div>
        ) : null}
        <h2 className="admin-sectionHeader__title">{title}</h2>
        {subtitle ? <p className="admin-sectionHeader__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="admin-sectionHeader__actions">{actions}</div> : null}
    </header>
  );
}

/* ─── Collapsible filter bar (inline on desktop, toggle on mobile) ───────── */

export function AdminFilterBar({
  activeCount = 0,
  children,
}: {
  activeCount?: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className={`admin-filterBar${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="admin-filterBar__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{t("admin.filter.title")}</span>
        {activeCount > 0 ? <span className="admin-filterBar__count">{activeCount}</span> : null}
        <span className="admin-filterBar__chevron" aria-hidden="true">▾</span>
      </button>
      <div className="admin-filterBar__body">{children}</div>
    </div>
  );
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
  const { t } = useI18n();
  // Keep the latest onClose without re-running the lock effect on every render
  // (an unstable onClose used to re-lock/unlock scroll repeatedly, which could
  // reset the viewport and jump the page to the top).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.removeEventListener("keydown", onKeyDown);

      // Restore the exact viewport the user had before opening the modal, and
      // return focus to the trigger without scrolling it into view.
      const restore = () => {
        if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
          window.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" });
        }
      };
      restore();
      window.requestAnimationFrame(() => {
        restore();
        try {
          previouslyFocused?.focus?.({ preventScroll: true });
        } catch {
          /* focus restore is best-effort */
        }
      });
    };
  }, []);

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
              aria-label={t("admin.modal.close")}
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
  const { t } = useI18n();
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (variant === "badge") {
    return (
      <span className="unreadBadge" title={t("admin.unread.some")}>
        {n > 99 ? "99+" : n}
      </span>
    );
  }
  return <span className="unreadDot" aria-label={t("admin.unread.label")} title={t("admin.unread.label")} />;
}

export function SupportTabIcon() {
  return <AdminSectionIcon name="lifebuoy" size={16} />;
}

export function PartnershipTabIcon() {
  return <AdminSectionIcon name="handshake" size={16} />;
}

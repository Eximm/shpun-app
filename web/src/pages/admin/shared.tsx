import { useEffect, type ReactNode } from "react";

export function AdminTabButton({
  active,
  title,
  subtitle,
  onClick,
  badge,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      className={`btn admin-tabBtn ${active ? "btn--accent admin-tabBtn--active" : "btn--soft"}`}
      type="button"
      onClick={onClick}
    >
      <span className="admin-tabBtn__title">
        {title}
        {badge ? <span className="admin-tabBtn__badge">{badge}</span> : null}
      </span>
      <span className="admin-tabBtn__sub">{subtitle}</span>
    </button>
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
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
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

          <div className="modal__content admin-modal__content">{children}</div>
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

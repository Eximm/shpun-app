import { useEffect, type ReactNode } from "react";

export function AdminTabButton({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`btn admin-tabBtn ${active ? "btn--accent admin-tabBtn--active" : "btn--soft"}`}
      type="button"
      onClick={onClick}
    >
      <span className="admin-tabBtn__title">{title}</span>
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
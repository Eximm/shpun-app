import type { ReactNode } from "react";

type ServiceNoteProps = {
  children: ReactNode;
  title?: string;
  className?: string;
};

export function ServiceNote({ children, title, className = "" }: ServiceNoteProps) {
  return (
    <span className={`service-note ${className}`.trim()}>
      <span className="service-note__icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5m0-8h.01" />
        </svg>
      </span>
      <span className="service-note__copy">
        {title && <strong className="service-note__title">{title}</strong>}
        <span>{children}</span>
      </span>
    </span>
  );
}

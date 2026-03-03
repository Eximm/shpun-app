import { normalizeError } from "../api/errorText";

export function pageStatusTextFromError(err: unknown, fallback?: string) {
  const n = normalizeError(err);
  // Prefer a human description; fall back to a safe generic string.
  return n.description || fallback || "Попробуйте ещё раз.";
}

export function PageStatusCard(props: { title: string; text?: string }) {
  const text = props.text ?? "Загрузка…";

  return (
    <div className="page-status">
      <div className="page-status__card">
        <div className="page-status__shine" />

        <div className="page-status__row">
          <div className="page-status__mark" aria-hidden="true" />
          <div className="page-status__col">
            <div className="page-status__title">{props.title}</div>
            <div className="page-status__text">{text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
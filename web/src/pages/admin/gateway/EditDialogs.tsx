// web/src/pages/admin/gateway/EditDialogs.tsx
//
// Dialogs shared by the gateway editor: a generic form dialog (handles submit
// state + error display) and the diff preview shown before any structural
// config change is applied.

import { useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n";
import { ModalShell } from "../shared";
import { describeError, type DiffLine, type EditPreview } from "./gatewayApi";

export function ErrorLine({ error }: { error: { key: string; detail?: string } | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="gw-error" role="alert">
      <div>{t(error.key)}</div>
      {error.detail ? <pre className="gw-error__detail">{error.detail}</pre> : null}
    </div>
  );
}

export function FormDialog({
  title,
  kicker,
  submitLabel,
  canSubmit = true,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  submitLabel?: string;
  canSubmit?: boolean;
  onSubmit: () => Promise<void> | void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={title} kicker={kicker} onClose={onClose}>
      <form className="gw-form" onSubmit={submit}>
        {children}
        <ErrorLine error={error} />
        <div className="gw-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t("admin.gateways.cancel")}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !canSubmit}>
            {busy ? t("admin.gateways.checking") : (submitLabel ?? t("admin.gateways.preview"))}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="gw-field">
      <span className="gw-field__label">{label}</span>
      {children}
      {hint ? <span className="gw-field__hint">{hint}</span> : null}
    </label>
  );
}

export function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="gw-diff" role="region">
      {diff.map((d, i) =>
        d.kind === "gap" ? (
          <div key={i} className="gw-diff__gap">⋯</div>
        ) : (
          <div key={i} className={`gw-diff__line is-${d.kind}`}>
            <span className="gw-diff__no">{d.kind === "add" ? d.newNo : d.oldNo}</span>
            <span className="gw-diff__sign">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}</span>
            <span className="gw-diff__text">{d.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function DiffPreviewDialog({
  preview,
  onApply,
  onClose,
}: {
  preview: EditPreview;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const added = preview.diff.filter((d) => d.kind === "add").length;
  const removed = preview.diff.filter((d) => d.kind === "del").length;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await onApply();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t("admin.gateways.diff.title")} kicker={t("admin.gateways.diff.kicker")} onClose={busy ? () => {} : onClose} cardClassName="admin-modal__card--wide">
      <div className="gw-form">
        {preview.unchanged ? (
          <p className="admin-section__hint">{t("admin.gateways.diff.unchanged")}</p>
        ) : (
          <>
            <div className="gw-diff__summary">
              <span className="gw-mono">{preview.summary}</span>
              <span className="chip chip--ok">+{added}</span>
              <span className="chip chip--bad">−{removed}</span>
            </div>
            <DiffView diff={preview.diff} />
            <p className="gw-field__hint">{t("admin.gateways.diff.hint")}</p>
          </>
        )}
        <ErrorLine error={error} />
        <div className="gw-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t("admin.gateways.cancel")}
          </button>
          {!preview.unchanged && (
            <button type="button" className="btn btn--primary" onClick={apply} disabled={busy}>
              {busy ? t("admin.gateways.applying") : t("admin.gateways.diff.apply")}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

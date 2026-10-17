import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";

export type BonusOpportunity = { description?: string } & (
  | { id: string; campaignId: "return15"; kind: "return_promo"; code: string; percent: number; inactiveDays: number; tariffDays: number }
  | { id: string; campaignId: "return15" | "first_pay"; kind: "topup_bonus"; source: "return" | "first_pay"; percent: number; code?: string; tariffDays?: number }
  | { id: string; campaignId: "review_reward"; kind: "review_bonus"; amount: number });

export function BonusOpportunityModal({
  open,
  offer,
  onActivate,
  onOpenPayments,
  onOpenReviews,
  onClose,
}: {
  open: boolean;
  offer: BonusOpportunity | null;
  onActivate: (code: string) => Promise<void>;
  onOpenPayments: () => void;
  onOpenReviews: () => void;
  onClose: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    setBusy(false);
    setError("");
    setActivated(false);
  }, [offer?.id]);

  if (!open || !offer) return null;

  const isReturn = offer.kind === "return_promo";
  const isTopup = offer.kind === "topup_bonus";
  const value = offer.kind === "review_bonus"
    ? formatNumber(offer.amount)
    : isReturn
      ? offer.code
      : `+${offer.percent}%`;
  const icon = offer.kind === "review_bonus" ? "💬" : isReturn ? "↩️" : "🎁";
  const title = activated
    ? t("bonus.offer.return.success_title")
    : offer.kind === "review_bonus"
      ? t("bonus.offer.review.title")
      : isReturn
        ? t("bonus.offer.return.title")
        : offer.source === "return"
          ? t("bonus.offer.topup.return_title")
          : t("bonus.offer.topup.firstpay_title");
  const text = activated
    ? t("bonus.offer.return.success_text", { percent: isReturn ? offer.percent : 0 })
    : offer.kind === "review_bonus"
      ? t("bonus.offer.review.text", { amount: formatNumber(offer.amount) })
      : isReturn
        ? t("bonus.offer.return.text", { percent: offer.percent, days: offer.tariffDays })
        : offer.source === "return"
          ? t("bonus.offer.topup.return_text", { percent: offer.percent, days: offer.tariffDays ?? 7 })
          : t("bonus.offer.topup.firstpay_text", { percent: offer.percent });

  const runPrimary = async () => {
    if (activated) {
      onClose();
      return;
    }
    if (offer.kind === "review_bonus") {
      onOpenReviews();
      return;
    }
    if (offer.kind === "topup_bonus") {
      onOpenPayments();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onActivate(offer.code);
      setActivated(true);
    } catch (cause: any) {
      setError(String(cause?.message || t("bonus.offer.error")));
    } finally {
      setBusy(false);
    }
  };

  const buttonText = activated
    ? t("bonus.offer.done")
    : offer.kind === "review_bonus"
      ? t("bonus.offer.review.button")
      : isTopup
        ? t("bonus.offer.topup.button")
        : t("bonus.offer.return.button");

  return createPortal(
    <div className="modal firstPayBonusModal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="firstPayBonusModal__card bonusOpportunityModal__card">
        <div className="firstPayBonusModal__glow" />
        {!activated && (
          <div className="firstPayBonusModal__fireworks" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <i key={index} style={{ "--particle": index } as React.CSSProperties} />
            ))}
          </div>
        )}
        <button
          className="bonusOpportunityModal__close"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t("bonus.offer.later")}
        >
          ×
        </button>
        <div className="firstPayBonusModal__icon" aria-hidden="true">{activated ? "✅" : icon}</div>
        <div className="firstPayBonusModal__eyebrow">{t("bonus.offer.eyebrow")}</div>
        {!activated && <div className={`firstPayBonusModal__percent${isReturn ? " bonusOpportunityModal__code" : ""}`}>{value}</div>}
        <h2 className="firstPayBonusModal__title">{title}</h2>
        {!activated && offer.description && (
          <p className="firstPayBonusModal__text bonusOpportunityModal__description">{offer.description}</p>
        )}
        <p className="firstPayBonusModal__text">{text}</p>
        {isReturn && !activated && (
          <div className="firstPayBonusModal__example">
            {t("bonus.offer.return.details", { days: offer.tariffDays, inactiveDays: offer.inactiveDays })}
          </div>
        )}
        {error && <div className="bonusOpportunityModal__error" role="alert">{error}</div>}
        <button className="btn btn--primary firstPayBonusModal__button" type="button" onClick={() => void runPrimary()} disabled={busy}>
          {busy ? t("bonus.offer.activating") : buttonText}
        </button>
        {!activated && (
          <button className="bonusOpportunityModal__later" type="button" onClick={onClose} disabled={busy}>
            {t("bonus.offer.later")}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

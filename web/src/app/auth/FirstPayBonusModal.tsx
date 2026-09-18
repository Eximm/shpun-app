import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";

export function FirstPayBonusModal({
  open,
  percent,
  onClose,
}: {
  open: boolean;
  percent: number;
  onClose: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  if (!open || percent <= 0) return null;

  return createPortal(
    <div className="modal firstPayBonusModal" role="dialog" aria-modal="true">
      <div className="firstPayBonusModal__card">
        <div className="firstPayBonusModal__glow" />
        <div className="firstPayBonusModal__fireworks" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} style={{ "--particle": index } as React.CSSProperties} />
          ))}
        </div>
        <div className="firstPayBonusModal__icon" aria-hidden="true">🎁</div>
        <div className="firstPayBonusModal__eyebrow">{t("bonus.firstpay.eyebrow")}</div>
        <div className="firstPayBonusModal__percent">+{percent}%</div>
        <h2 className="firstPayBonusModal__title">{t("bonus.firstpay.title")}</h2>
        <p className="firstPayBonusModal__text">
          {t("bonus.firstpay.text", { percent })}
        </p>
        <div className="firstPayBonusModal__example">
          {t("bonus.firstpay.example", {
            amount: formatCurrency(1000),
            bonus: Math.round((1000 * percent) / 100),
          })}
        </div>
        <button className="btn btn--primary firstPayBonusModal__button" type="button" onClick={onClose}>
          {t("bonus.firstpay.button")}
        </button>
      </div>
    </div>,
    document.body
  );
}

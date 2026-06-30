import { createPortal } from "react-dom";
import { useState } from "react";
import { apiFetch } from "../../shared/api/client";

export function FirstPayBonusModal({
  open,
  percent,
  onClose,
}: {
  open: boolean;
  percent: number;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!open || percent <= 0) return null;

  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch("/user/referral-bonus/dismiss", { method: "POST" });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return createPortal(
    <div className="modal firstPayBonusModal" role="dialog" aria-modal="true">
      <div className="firstPayBonusModal__card">
        <div className="firstPayBonusModal__glow" />
        <div className="firstPayBonusModal__icon" aria-hidden="true">🎁</div>
        <div className="firstPayBonusModal__eyebrow">Бонус уже доступен</div>
        <div className="firstPayBonusModal__percent">+{percent}%</div>
        <h2 className="firstPayBonusModal__title">к первому пополнению</h2>
        <p className="firstPayBonusModal__text">
          Пополните баланс впервые — мы начислим ещё {percent}% от суммы на бонусный счёт.
        </p>
        <div className="firstPayBonusModal__example">
          Например, при пополнении на 1 000 ₽ вы получите ещё {Math.round(1000 * percent / 100)} бонусов.
        </div>
        <button className="btn btn--primary firstPayBonusModal__button" type="button" onClick={() => void close()} disabled={busy}>
          {busy ? "Сохраняем…" : "Понятно"}
        </button>
      </div>
    </div>,
    document.body
  );
}

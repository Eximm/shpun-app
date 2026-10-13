import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { useMe } from "./useMe";

const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** A quiet, inline reminder; never interrupts ordering or connection. */
export function PasswordReminder() {
  const { me } = useMe();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const profile = me?.profile;
  const uid = profile?.id;
  const key = `password.reminder.snoozed:${uid}`;
  let snoozed = false;
  try {
    const until = Number(localStorage.getItem(key));
    snoozed = Number.isFinite(until) && until > Date.now() && until <= Date.now() + SNOOZE_MS;
  } catch { /* Storage may be unavailable in a Mini App. */ }

  if (!uid || profile?.passwordStepDone !== false || profile.emailVerified !== true ||
      !profile.email || dismissedFor === uid || snoozed) return null;

  return (
    <aside className="card" aria-label={t("password.reminder.title")} style={{ marginTop: 16 }}>
      <div className="card__body" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{t("password.reminder.title")}</div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>{t("password.reminder.text")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn--soft" onClick={() => navigate("/profile#password")}>{t("password.reminder.action")}</button>
          <button type="button" className="btn" onClick={() => {
            setDismissedFor(uid);
            try { localStorage.setItem(key, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
          }}>{t("password.reminder.later")}</button>
        </div>
      </div>
    </aside>
  );
}

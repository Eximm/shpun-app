export const EMAIL_CODE_COOLDOWN_MS = 60_000;

const EMAIL_CODE_SENT_KEY = "email_verify:sent_at";

export function getPendingEmailVerificationAt(): number {
  try { return Number(localStorage.getItem(EMAIL_CODE_SENT_KEY) ?? 0) || 0; }
  catch { return 0; }
}

export function markPendingEmailVerification() {
  try { localStorage.setItem(EMAIL_CODE_SENT_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

export function clearPendingEmailVerification() {
  try { localStorage.removeItem(EMAIL_CODE_SENT_KEY); }
  catch { /* ignore */ }
}

export function getPendingEmailCooldown(): number {
  const sentAt = getPendingEmailVerificationAt();
  if (!sentAt) return 0;
  const left = Math.ceil((sentAt + EMAIL_CODE_COOLDOWN_MS - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

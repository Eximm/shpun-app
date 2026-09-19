// web/src/app/auth/authState.ts
//
// Single place to drop authenticated *client* state on an auth transition
// (logout or a server-reported unauthenticated session).
//
// It intentionally does NOT touch non-secret user preferences: language,
// FloatingSupport position, theme, device token, PWA dismissal, etc.

import { clearMe } from "./useMe";
import { clearSupportUnread } from "../notifications/supportUnread";
import { toastStore } from "../../shared/ui/toast";

let lastResetAt = 0;

/**
 * Reset the authenticated frontend state. Idempotent and safe to call on every
 * auth-lost signal / logout.
 */
export function resetAuthenticatedClientState(): void {
  // Throttle accidental bursts (e.g. many parallel 401s) while still being
  // immediate for the first call.
  const now = Date.now();
  if (now - lastResetAt < 50) {
    // Still make sure the identity flag is dropped.
    clearMe();
    return;
  }
  lastResetAt = now;

  // 1. Identity + admin flag.
  clearMe();
  // 2. Admin unread counters (bell badges / inbox tabs).
  clearSupportUnread();
  // 3. Any visible toasts may contain account data.
  try {
    toastStore.clear();
  } catch {
    // ignore
  }
}
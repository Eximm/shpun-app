// api/src/modules/support/adminGuard.ts
//
// Thin, overridable wrapper around the existing admin check so support admin
// routes reuse `ensureAdmin` in production but stay testable without SHM.

import { ensureAdmin } from "../admin/routes.js";

export type SupportAdminChecker = (shmSessionId: string) => Promise<boolean>;

const defaultChecker: SupportAdminChecker = (shmSessionId) => ensureAdmin(shmSessionId);

let activeChecker: SupportAdminChecker = defaultChecker;

export function isSupportAdmin(shmSessionId: string | null | undefined): Promise<boolean> {
  const sid = String(shmSessionId ?? "").trim();
  if (!sid) return Promise.resolve(false);
  return activeChecker(sid);
}

/** Override the admin check (tests). Null restores the default. */
export function setSupportAdminChecker(checker: SupportAdminChecker | null): void {
  activeChecker = checker ?? defaultChecker;
}

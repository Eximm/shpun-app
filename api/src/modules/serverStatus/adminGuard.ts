// api/src/modules/serverStatus/adminGuard.ts
//
// Thin, overridable wrapper around the existing billing/auth admin check so the
// server-status admin routes reuse `ensureAdmin` in production but stay
// testable without a live SHM session.

import { ensureAdmin } from "../admin/routes.js";

export type ServerStatusAdminChecker = (shmSessionId: string) => Promise<boolean>;

const defaultChecker: ServerStatusAdminChecker = (shmSessionId) => ensureAdmin(shmSessionId);

let activeChecker: ServerStatusAdminChecker = defaultChecker;

export function isServerStatusAdmin(shmSessionId: string | null | undefined): Promise<boolean> {
  const sid = String(shmSessionId ?? "").trim();
  if (!sid) return Promise.resolve(false);
  return activeChecker(sid);
}

/** Override the admin check (tests). Null restores the default. */
export function setServerStatusAdminChecker(checker: ServerStatusAdminChecker | null): void {
  activeChecker = checker ?? defaultChecker;
}
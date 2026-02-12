// api/src/modules/user/me.ts
// Helper без регистрации роутов (чтобы не конфликтовать с modules/user/routes.ts)

import { shmGetMe } from "../../shared/shm/shmClient.js";

export type MeResult =
  | { ok: true; meRaw: any }
  | { ok: false; status: number; error: string; shm?: any };

export async function fetchMe(shmSessionId: string): Promise<MeResult> {
  const r = await shmGetMe(shmSessionId);

  if (!r.ok) {
    return { ok: false, status: r.status || 502, error: "shm_me_failed", shm: r.json ?? r.text };
  }

  const meRaw = r.json?.data?.[0] ?? null;
  if (!meRaw) {
    return { ok: false, status: 502, error: "shm_me_empty", shm: r.json ?? r.text };
  }

  return { ok: true, meRaw };
}

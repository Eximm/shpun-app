// api/src/modules/user/services.ts
// Helper без регистрации роутов (чтобы не конфликтовать с modules/user/routes.ts)

import { shmGetUserServices } from "../../shared/shm/shmClient.js";

export type ServicesResult =
  | { ok: true; items: any[]; meta: { items: number; limit: number; offset: number } }
  | { ok: false; status: number; error: string; shm?: any };

export async function fetchServices(
  shmSessionId: string,
  opts?: { limit?: number; offset?: number }
): Promise<ServicesResult> {
  const limit = Number.isFinite(opts?.limit) ? (opts!.limit as number) : 50;
  const offset = Number.isFinite(opts?.offset) ? (opts!.offset as number) : 0;

  const r = await shmGetUserServices(shmSessionId, { limit, offset, filter: {} });

  if (!r.ok) {
    return {
      ok: false,
      status: r.status || 502,
      error: "shm_services_failed",
      shm: r.json ?? r.text,
    };
  }

  const items = r.json?.data ?? [];
  return {
    ok: true,
    items,
    meta: {
      items: r.json?.items ?? items.length,
      limit: r.json?.limit ?? limit,
      offset: r.json?.offset ?? offset,
    },
  };
}

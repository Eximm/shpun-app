// api/src/modules/user/services.ts
// Этот файл оставлен как helper на будущее.
// Роут /api/services уже реализован в api/src/modules/user/routes.ts
// (чтобы не было дубля и конфликтов, здесь роуты НЕ регистрируем).

import { shmGetUserServices } from "../../shared/shm/shmClient.js";

export type ServicesResult =
  | { ok: true; items: any[]; meta: { items: number; limit: number; offset: number } }
  | { ok: false; status: number; error: string; shm?: any };

export async function fetchUserServices(
  shmSessionId: string,
  opts?: { limit?: number; offset?: number; filter?: any }
): Promise<ServicesResult> {
  const limit = Number.isFinite(opts?.limit) ? (opts!.limit as number) : 50;
  const offset = Number.isFinite(opts?.offset) ? (opts!.offset as number) : 0;

  const r = await shmGetUserServices(shmSessionId, {
    limit,
    offset,
    filter: opts?.filter ?? {},
  });

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

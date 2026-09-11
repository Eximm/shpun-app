// api/src/modules/support/snapshot.ts
//
// The only place in the support module that talks to SHM/Billing.
// It resolves the requester identity and the owned service, and it is
// injectable so tests and future storage providers do not need a live SHM.

import { shmGetMe, shmGetUserServices } from "../../shared/shm/shmClient.js";
import type { ServiceSnapshot, SupportIdentity, SupportShmPort } from "./types.js";

function toStr(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickMe(json: unknown): any | null {
  const data = (json as any)?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  if (data && typeof data === "object") return data;
  return null;
}

function mapServiceSnapshot(raw: any): ServiceSnapshot | null {
  const usi = toNum(raw?.user_service_id);
  if (usi === null || usi <= 0) return null;
  const nested = raw?.service && typeof raw.service === "object" ? raw.service : {};
  return {
    user_service_id: Math.trunc(usi),
    service_id: toNum(raw?.service_id ?? nested?.service_id ?? raw?.id),
    name: toStr(raw?.name ?? raw?.title ?? nested?.name),
    category: toStr(raw?.category ?? nested?.category),
    status: toStr(raw?.status ?? raw?.state),
    expire: toStr(raw?.expire ?? raw?.expire_at ?? raw?.expired_at),
    period: raw?.period ?? nested?.period ?? null,
    cost: toNum(raw?.cost ?? nested?.cost),
  };
}

/**
 * Loads every user service with pagination. The bot/app must be able to
 * verify ownership even when a user has more than one page of services.
 */
async function fetchAllUserServices(sessionId: string, maxItems = 500): Promise<any[]> {
  const pageSize = 50;
  const collected: any[] = [];
  let offset = 0;

  for (;;) {
    const r = await shmGetUserServices(sessionId, { limit: pageSize, offset, filter: {} });
    if (!r.ok) throw new Error(`support_shm_services_failed:${r.status}`);
    const page = Array.isArray((r.json as any)?.data) ? ((r.json as any).data as any[]) : [];
    collected.push(...page);

    const metaItems = Number((r.json as any)?.items);
    const hasMoreByMeta = Number.isFinite(metaItems) ? collected.length < metaItems : false;
    const hasMoreByPage = page.length === pageSize;

    if (collected.length >= maxItems) break;
    if (!hasMoreByMeta && !hasMoreByPage) break;
    if (page.length === 0) break;

    offset += pageSize;
  }

  return collected;
}

/** Default SHM-backed implementation of SupportShmPort. */
export const shmSupportPort: SupportShmPort = {
  async resolveIdentity(sessionId: string): Promise<SupportIdentity> {
    const sid = String(sessionId ?? "").trim();
    if (!sid) throw new Error("support_shm_session_missing");

    const r = await shmGetMe(sid);
    if (!r.ok) throw new Error(`support_shm_identity_failed:${r.status}`);

    const me = pickMe(r.json);
    if (!me) throw new Error("support_shm_identity_empty");

    const userId = toNum(me?.user_id ?? me?.id);
    if (userId === null || userId <= 0) throw new Error("support_shm_identity_invalid");

    const login = toStr(me?.login);
    const displayName = toStr(me?.full_name) ?? login;

    return {
      userId: Math.trunc(userId),
      login,
      displayName,
      balance: toNum(me?.balance),
      bonus: toNum(me?.bonus),
    };
  },

  async resolveOwnedService(
    sessionId: string,
    userServiceId: number
  ): Promise<ServiceSnapshot | null> {
    const sid = String(sessionId ?? "").trim();
    const usi = Math.trunc(Number(userServiceId));
    if (!sid || !Number.isFinite(usi) || usi <= 0) return null;

    const services = await fetchAllUserServices(sid);
    const found = services.find((item) => Number(item?.user_service_id ?? 0) === usi) ?? null;
    if (!found) return null;
    return mapServiceSnapshot(found);
  },
};

let activePort: SupportShmPort = shmSupportPort;

export function getSupportShmPort(): SupportShmPort {
  return activePort;
}

/** Override the SHM gateway (tests, future providers). Null restores default. */
export function setSupportShmPort(port: SupportShmPort | null): void {
  activePort = port ?? shmSupportPort;
}

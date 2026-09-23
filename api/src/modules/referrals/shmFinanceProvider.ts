import { shmShpunAppAdminFinanceFeed, type ShpunAppFinanceFeedKind } from "../../shared/shm/shmClient.js";
import type { FinanceCohort, ReferralFinanceSnapshot } from "./analytics.js";
import {
  aggregateReferralFinance,
  positiveFinanceId,
  type FinanceFeed,
} from "./financeAggregation.js";

const EXPECTED_TEMPLATE_VERSION = "shpun_app_v24_admin_finance_feed_batch";
const USERS_PER_BATCH = 500;
const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_BATCH = 100;

function unwrapTemplateJson(json: any): any {
  const data = json?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : json;
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchKindPages(
  shmSessionId: string,
  kind: ShpunAppFinanceFeedKind,
  userIds: number[]
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES_PER_BATCH; page += 1) {
    const result = await shmShpunAppAdminFinanceFeed(shmSessionId, {
      kind,
      userIds,
      limit: PAGE_LIMIT,
      offset,
    });
    const payload = unwrapTemplateJson(result.json);
    if (!result.ok || !payload?.ok) {
      throw new Error(`finance_feed_failed:${kind}:${result.status}:${String(payload?.error ?? "unknown")}`);
    }
    if (payload.ver !== EXPECTED_TEMPLATE_VERSION) {
      throw new Error(`finance_feed_version:${String(payload.ver ?? "missing")}`);
    }
    if (payload.money_unit !== "RUB_major_decimal") {
      throw new Error(`finance_feed_money_unit:${String(payload.money_unit ?? "missing")}`);
    }

    const pageRows = Array.isArray(payload[kind]) ? payload[kind] : [];
    rows.push(...pageRows);
    if (!payload?.has_more?.[kind]) return rows;
    if (pageRows.length < 1) throw new Error(`finance_feed_stalled:${kind}:${offset}`);
    offset += pageRows.length;
  }

  throw new Error(`finance_feed_page_limit:${kind}`);
}

/** One batched SHM read for all aliases; never one request per alias. */
export async function fetchReferralFinanceByAlias(
  shmSessionId: string,
  cohorts: FinanceCohort[]
): Promise<Map<number, ReferralFinanceSnapshot | null>> {
  const requestedIds = new Set<number>();
  for (const cohort of cohorts) {
    for (const userId of cohort.attributedUserIds) {
      const id = positiveFinanceId(userId);
      if (id) requestedIds.add(id);
    }
    if (cohort.alias.link_type === "partner") {
      const partnerId = positiveFinanceId(cohort.alias.partner_id);
      if (partnerId) requestedIds.add(partnerId);
    }
  }

  const feed: FinanceFeed = { pays: [], withdraws: [], bonuses: [] };
  for (const userIds of chunks([...requestedIds], USERS_PER_BATCH)) {
    const [pays, withdraws, bonuses] = await Promise.all([
      fetchKindPages(shmSessionId, "pays", userIds),
      fetchKindPages(shmSessionId, "withdraws", userIds),
      fetchKindPages(shmSessionId, "bonuses", userIds),
    ]);
    feed.pays.push(...pays);
    feed.withdraws.push(...withdraws);
    feed.bonuses.push(...bonuses);
  }

  return aggregateReferralFinance(cohorts, feed);
}

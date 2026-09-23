import { linkDb } from "./db.js";

export type ReferralAlias = {
  id: number;
  alias: string;
  link_type: "partner" | "campaign";
  partner_id: number;
  campaign_code: string | null;
  billing_comment: string | null;
  first_payment_bonus_percent: number;
  partner_reward_percent: number;
  ad_cost_minor: number;
  enabled: boolean;
  visits_count: number;
  registrations_count: number;
  created_at: string;
  updated_at: string;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS referral_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL COLLATE NOCASE UNIQUE,
  partner_id INTEGER NOT NULL,
  campaign_code TEXT,
  first_payment_bonus_percent INTEGER NOT NULL DEFAULT 0,
  partner_reward_percent INTEGER NOT NULL DEFAULT 30,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function ensureColumn(name: string, sqlType: string) {
  const columns = linkDb.prepare(`PRAGMA table_info(referral_aliases)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) {
    linkDb.exec(`ALTER TABLE referral_aliases ADD COLUMN ${name} ${sqlType}`);
  }
}
ensureColumn("visits_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("registrations_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("link_type", "TEXT NOT NULL DEFAULT 'partner'");
ensureColumn("billing_comment", "TEXT");
// Manual advertising spend for non-partner campaign links, stored in integer
// minor units (kopecks) so money never goes through floating point.
ensureColumn("ad_cost_minor", "INTEGER NOT NULL DEFAULT 0");

linkDb.exec(`
CREATE TABLE IF NOT EXISTS referral_alias_registrations (
  alias_id INTEGER NOT NULL,
  shm_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(alias_id, shm_user_id)
);
`);

function normalizeAlias(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function mapRow(row: any): ReferralAlias {
  return {
    ...row,
    link_type: row.link_type === "campaign" ? "campaign" : "partner",
    ad_cost_minor: Math.max(0, Math.trunc(Number(row.ad_cost_minor ?? 0))) || 0,
    enabled: Boolean(row.enabled),
  };
}

/**
 * Canonical SHM user comment for a referral alias. Single source of truth for
 * web, Telegram widget and Telegram bot registration + claim/backfill:
 *
 *   partner  -> campaign_code ("Имя партнёра или кампании") || alias
 *   campaign -> billing_comment ("Комментарий в биллинге")
 */
export function referralComment(
  item: Pick<ReferralAlias, "link_type" | "campaign_code" | "billing_comment" | "alias">
): string {
  if (item.link_type === "campaign") return String(item.billing_comment ?? "").trim();
  const campaignCode = String(item.campaign_code ?? "").trim();
  return campaignCode || String(item.alias ?? "").trim();
}

export function isValidReferralAlias(value: unknown): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalizeAlias(value));
}

export function listReferralAliases(): ReferralAlias[] {
  return (linkDb.prepare(`
    SELECT * FROM referral_aliases ORDER BY enabled DESC, alias ASC
  `).all() as any[]).map(mapRow);
}

export function getReferralAliasById(id: unknown): ReferralAlias | null {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = linkDb.prepare(`SELECT * FROM referral_aliases WHERE id = ?`).get(n);
  return row ? mapRow(row) : null;
}

export function findReferralAlias(value: unknown): ReferralAlias | null {
  const row = linkDb.prepare(`
    SELECT * FROM referral_aliases WHERE alias = ? COLLATE NOCASE AND enabled = 1
  `).get(normalizeAlias(value));
  return row ? mapRow(row) : null;
}

export function saveReferralAlias(input: {
  alias: unknown;
  linkType?: unknown;
  partnerId?: unknown;
  campaignCode?: unknown;
  billingComment?: unknown;
  firstPaymentBonusPercent?: unknown;
  partnerRewardPercent?: unknown;
  adCostMinor?: unknown;
  enabled?: unknown;
}): ReferralAlias {
  const alias = normalizeAlias(input.alias);
  const linkType = input.linkType === "campaign" ? "campaign" : "partner";
  const partnerId = linkType === "campaign" ? 0 : Math.trunc(Number(input.partnerId));
  const campaignCode = String(input.campaignCode ?? "").trim() || null;
  const billingComment = String(input.billingComment ?? "").trim() || null;
  const bonus = linkType === "campaign" ? 0 : Math.trunc(Number(input.firstPaymentBonusPercent ?? 0));
  const reward = linkType === "campaign" ? 0 : Math.trunc(Number(input.partnerRewardPercent ?? 30));
  // Manual ad cost only applies to campaign links; partner cost comes from the
  // billing commission model, never from a hand-entered number.
  const adCostMinor = linkType === "campaign" ? Math.trunc(Number(input.adCostMinor ?? 0)) : 0;
  const enabled = input.enabled === false ? 0 : 1;

  if (!isValidReferralAlias(alias)) throw new Error("invalid_alias");
  if (linkType === "partner" && (!Number.isFinite(partnerId) || partnerId <= 0)) {
    throw new Error("invalid_partner_id");
  }
  if (linkType === "campaign" && (!billingComment || billingComment.length > 255 || /[\r\n]/.test(billingComment))) {
    throw new Error("invalid_billing_comment");
  }
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100) throw new Error("invalid_bonus_percent");
  if (!Number.isFinite(reward) || reward < 0 || reward > 100) throw new Error("invalid_reward_percent");
  if (!Number.isFinite(adCostMinor) || adCostMinor < 0 || adCostMinor > 1_000_000_000_00) {
    throw new Error("invalid_ad_cost");
  }

  linkDb.prepare(`
    INSERT INTO referral_aliases
      (alias, link_type, partner_id, campaign_code, billing_comment,
       first_payment_bonus_percent, partner_reward_percent, ad_cost_minor, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(alias) DO UPDATE SET
      link_type = excluded.link_type,
      partner_id = excluded.partner_id,
      campaign_code = excluded.campaign_code,
      billing_comment = excluded.billing_comment,
      first_payment_bonus_percent = excluded.first_payment_bonus_percent,
      partner_reward_percent = excluded.partner_reward_percent,
      ad_cost_minor = excluded.ad_cost_minor,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(alias, linkType, partnerId, campaignCode, billingComment, bonus, reward, adCostMinor, enabled);

  return mapRow(linkDb.prepare(`SELECT * FROM referral_aliases WHERE alias = ? COLLATE NOCASE`).get(alias));
}

export function deleteReferralAlias(id: unknown): boolean {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n <= 0) return false;
  return linkDb.transaction(() => {
    linkDb.prepare(`DELETE FROM referral_alias_registrations WHERE alias_id = ?`).run(n);
    return linkDb.prepare(`DELETE FROM referral_aliases WHERE id = ?`).run(n).changes > 0;
  })();
}

export function recordReferralAliasVisit(alias: unknown): void {
  linkDb.prepare(`
    UPDATE referral_aliases SET visits_count = visits_count + 1
    WHERE alias = ? COLLATE NOCASE AND enabled = 1
  `).run(normalizeAlias(alias));
}

export function recordReferralAliasRegistration(alias: unknown): void {
  linkDb.prepare(`
    UPDATE referral_aliases SET registrations_count = registrations_count + 1
    WHERE alias = ? COLLATE NOCASE AND enabled = 1
  `).run(normalizeAlias(alias));
}

export function recordReferralAliasRegistrationForUser(alias: unknown, shmUserId: unknown): boolean {
  const item = findReferralAlias(alias);
  const userId = Math.trunc(Number(shmUserId));
  if (!item || !Number.isFinite(userId) || userId <= 0) return false;

  return linkDb.transaction(() => {
    const inserted = linkDb.prepare(`
      INSERT OR IGNORE INTO referral_alias_registrations (alias_id, shm_user_id)
      VALUES (?, ?)
    `).run(item.id, userId).changes > 0;
    if (inserted) {
      linkDb.prepare(`
        UPDATE referral_aliases SET registrations_count = registrations_count + 1
        WHERE id = ?
      `).run(item.id);
    }
    return inserted;
  })();
}

/** Referral registrations at/after a UTC cutoff (dashboard "recent"). */
export function countReferralRegistrationsSince(since: string): number {
  const cutoff = String(since ?? "").trim();
  if (!cutoff) return 0;
  const row = linkDb.prepare(`
    SELECT COUNT(*) AS n FROM referral_alias_registrations
    WHERE datetime(created_at) >= datetime(?)
  `).get(cutoff) as { n?: number } | undefined;
  return Math.trunc(Number(row?.n ?? 0)) || 0;
}

/**
 * Attribution counts per alias for a cohort window. Returns a Map keyed by
 * alias id so the analytics layer never runs a query per card (no N+1).
 * `since = null` means all time.
 */
export function countReferralRegistrationsByAliasSince(since: string | null): Map<number, number> {
  const rows = (since
    ? linkDb.prepare(`
        SELECT alias_id, COUNT(*) AS n FROM referral_alias_registrations
        WHERE datetime(created_at) >= datetime(?)
        GROUP BY alias_id
      `).all(since)
    : linkDb.prepare(`
        SELECT alias_id, COUNT(*) AS n FROM referral_alias_registrations
        GROUP BY alias_id
      `).all()) as Array<{ alias_id: number; n: number }>;

  const out = new Map<number, number>();
  for (const row of rows) {
    out.set(Number(row.alias_id), Math.trunc(Number(row.n ?? 0)) || 0);
  }
  return out;
}

/** Attributed SHM user ids for a single alias (ascending by registration). */
export function listReferralAliasUserIds(aliasId: unknown): number[] {
  const n = Math.trunc(Number(aliasId));
  if (!Number.isFinite(n) || n <= 0) return [];
  const rows = linkDb.prepare(`
    SELECT shm_user_id FROM referral_alias_registrations
    WHERE alias_id = ? ORDER BY datetime(created_at) ASC, shm_user_id ASC
  `).all(n) as Array<{ shm_user_id: number }>;
  return rows
    .map((r) => Math.trunc(Number(r.shm_user_id)))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/** Recent referral registrations (alias + timestamp only) for the activity feed. */
export function listRecentReferralRegistrations(limit = 6): Array<{ alias: string; createdAt: string }> {
  const safe = Math.min(Math.max(Math.trunc(Number(limit)) || 6, 1), 20);
  const rows = linkDb.prepare(`
    SELECT a.alias AS alias, r.created_at AS created_at
    FROM referral_alias_registrations r
    JOIN referral_aliases a ON a.id = r.alias_id
    ORDER BY datetime(r.created_at) DESC, r.shm_user_id DESC
    LIMIT ?
  `).all(safe) as Array<{ alias: string; created_at: string }>;
  return rows.map((r) => ({ alias: String(r.alias || ""), createdAt: String(r.created_at || "") }));
}

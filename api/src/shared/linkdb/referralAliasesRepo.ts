import { linkDb } from "./db.js";

export type ReferralAlias = {
  id: number;
  alias: string;
  partner_id: number;
  campaign_code: string | null;
  first_payment_bonus_percent: number;
  partner_reward_percent: number;
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

function normalizeAlias(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function mapRow(row: any): ReferralAlias {
  return { ...row, enabled: Boolean(row.enabled) };
}

export function isValidReferralAlias(value: unknown): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalizeAlias(value));
}

export function listReferralAliases(): ReferralAlias[] {
  return (linkDb.prepare(`
    SELECT * FROM referral_aliases ORDER BY enabled DESC, alias ASC
  `).all() as any[]).map(mapRow);
}

export function findReferralAlias(value: unknown): ReferralAlias | null {
  const row = linkDb.prepare(`
    SELECT * FROM referral_aliases WHERE alias = ? COLLATE NOCASE AND enabled = 1
  `).get(normalizeAlias(value));
  return row ? mapRow(row) : null;
}

export function saveReferralAlias(input: {
  alias: unknown;
  partnerId: unknown;
  campaignCode?: unknown;
  firstPaymentBonusPercent?: unknown;
  partnerRewardPercent?: unknown;
  enabled?: unknown;
}): ReferralAlias {
  const alias = normalizeAlias(input.alias);
  const partnerId = Math.trunc(Number(input.partnerId));
  const campaignCode = String(input.campaignCode ?? "").trim() || null;
  const bonus = Math.trunc(Number(input.firstPaymentBonusPercent ?? 0));
  const reward = Math.trunc(Number(input.partnerRewardPercent ?? 30));
  const enabled = input.enabled === false ? 0 : 1;

  if (!isValidReferralAlias(alias)) throw new Error("invalid_alias");
  if (!Number.isFinite(partnerId) || partnerId <= 0) throw new Error("invalid_partner_id");
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100) throw new Error("invalid_bonus_percent");
  if (!Number.isFinite(reward) || reward < 0 || reward > 100) throw new Error("invalid_reward_percent");

  linkDb.prepare(`
    INSERT INTO referral_aliases
      (alias, partner_id, campaign_code, first_payment_bonus_percent, partner_reward_percent, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(alias) DO UPDATE SET
      partner_id = excluded.partner_id,
      campaign_code = excluded.campaign_code,
      first_payment_bonus_percent = excluded.first_payment_bonus_percent,
      partner_reward_percent = excluded.partner_reward_percent,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(alias, partnerId, campaignCode, bonus, reward, enabled);

  return mapRow(linkDb.prepare(`SELECT * FROM referral_aliases WHERE alias = ? COLLATE NOCASE`).get(alias));
}

export function deleteReferralAlias(id: unknown): boolean {
  const n = Math.trunc(Number(id));
  return Number.isFinite(n) && n > 0
    ? linkDb.prepare(`DELETE FROM referral_aliases WHERE id = ?`).run(n).changes > 0
    : false;
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

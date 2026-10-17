import { linkDb } from "../../shared/linkdb/db.js";

export const PROMOTION_CAMPAIGN_IDS = ["return15", "first_pay", "review_reward"] as const;
export type PromotionCampaignId = (typeof PROMOTION_CAMPAIGN_IDS)[number];

export type PromotionDisplaySetting = {
  campaignId: PromotionCampaignId;
  enabled: boolean;
  priority: number;
  description: string;
  updatedAt: string | null;
};

const DEFAULTS: Record<PromotionCampaignId, Omit<PromotionDisplaySetting, "campaignId" | "updatedAt">> = {
  return15: { enabled: true, priority: 10, description: "" },
  first_pay: { enabled: true, priority: 20, description: "" },
  review_reward: { enabled: true, priority: 30, description: "" },
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS promotion_display_settings (
  campaign_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const columns = linkDb.prepare("PRAGMA table_info(promotion_display_settings)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "description")) {
  linkDb.exec("ALTER TABLE promotion_display_settings ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

export function isPromotionCampaignId(value: unknown): value is PromotionCampaignId {
  return PROMOTION_CAMPAIGN_IDS.includes(String(value) as PromotionCampaignId);
}

function normalizePriority(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.trunc(numeric)));
}

export function getPromotionDisplaySettings(): PromotionDisplaySetting[] {
  const rows = linkDb.prepare(`
    SELECT campaign_id, enabled, priority, description, updated_at
    FROM promotion_display_settings
  `).all() as Array<{ campaign_id: string; enabled: number; priority: number; description: string; updated_at: string }>;
  const rowsById = new Map(rows.map((row) => [row.campaign_id, row]));

  return PROMOTION_CAMPAIGN_IDS.map((campaignId) => {
    const row = rowsById.get(campaignId);
    const defaults = DEFAULTS[campaignId];
    return {
      campaignId,
      enabled: row ? row.enabled === 1 : defaults.enabled,
      priority: normalizePriority(row?.priority, defaults.priority),
      description: row?.description ?? defaults.description,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export function getPromotionDisplaySettingsMap(): Map<PromotionCampaignId, PromotionDisplaySetting> {
  return new Map(getPromotionDisplaySettings().map((setting) => [setting.campaignId, setting]));
}

export function setPromotionDisplaySetting(
  campaignId: PromotionCampaignId,
  input: { enabled: unknown; priority: unknown; description?: string },
): PromotionDisplaySetting {
  const current = getPromotionDisplaySettingsMap().get(campaignId)!;
  const enabled = input.enabled === true || input.enabled === 1 || input.enabled === "1";
  const priority = normalizePriority(input.priority, current.priority);
  const description = input.description === undefined ? current.description : input.description.trim();

  linkDb.prepare(`
    INSERT INTO promotion_display_settings (campaign_id, enabled, priority, description, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(campaign_id) DO UPDATE SET
      enabled = excluded.enabled,
      priority = excluded.priority,
      description = excluded.description,
      updated_at = datetime('now')
  `).run(campaignId, enabled ? 1 : 0, priority, description);

  return getPromotionDisplaySettingsMap().get(campaignId)!;
}

import { linkDb } from "../../shared/linkdb/db.js";

export type AppearanceTheme = "classic" | "neon" | "winter";
export type AppearanceSettings = { theme: AppearanceTheme; effectsEnabled: boolean; gamesEnabled: boolean };
export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: "classic", effectsEnabled: true, gamesEnabled: true };

linkDb.exec(`CREATE TABLE IF NOT EXISTS app_appearance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export function getAppearance(): AppearanceSettings {
  const row = linkDb.prepare("SELECT value FROM app_appearance_settings WHERE id = 1").get() as { value: string } | undefined;
  if (!row) return { ...DEFAULT_APPEARANCE };
  try { return { ...DEFAULT_APPEARANCE, ...JSON.parse(row.value) }; }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function saveAppearance(value: AppearanceSettings): AppearanceSettings {
  linkDb.prepare(`INSERT INTO app_appearance_settings (id, value) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(value));
  return getAppearance();
}

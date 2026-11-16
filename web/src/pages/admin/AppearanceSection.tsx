import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import type { AppearanceSettings, SeasonalTheme } from "../../app/appearance/AppearanceProvider";
import { AdminSectionHeader, ADMIN_SECTION_ICON } from "./shared";

export function AppearanceSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppearanceSettings>({ theme: "classic", effectsEnabled: true, gamesEnabled: true });
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ settings: AppearanceSettings }>("/appearance", { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) { setSettings(result.settings); setSaved(JSON.stringify(result.settings)); }
    }).catch(() => { if (!controller.signal.aborted) setError(t("appearance.load_failed")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [t]);
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await apiFetch<{ settings: AppearanceSettings }>("/admin/appearance", { method: "PUT", body: settings });
      setSettings(result.settings); setSaved(JSON.stringify(result.settings)); setMessage(t("appearance.saved"));
      window.dispatchEvent(new Event("shpun-appearance-updated"));
    } catch { setError(t("appearance.save_failed")); }
    finally { setSaving(false); }
  };
  return <div className="card"><div className="card__body">
    <AdminSectionHeader icon={ADMIN_SECTION_ICON.appearance} title={t("appearance.admin_title")} subtitle={t("appearance.admin_sub")}
      actions={<button type="button" className="btn btn--primary" disabled={loading || saving || saved === JSON.stringify(settings)} onClick={() => void save()}>
        {t(saving ? "common.saving" : "common.save")}</button>} />
    {loading ? <p className="p">{t("common.loading")}</p> : <>
      <div className="appearance-admin-grid">
        {(["classic", "neon", "winter"] as SeasonalTheme[]).map((theme) => <label key={theme} className="appearance-admin-choice">
          {theme === "classic" ? <div className="appearance-admin-classic">Shpun App</div> : <img src={`/themes/${theme}-background.webp`} alt="" />}
          <span><input type="radio" name="global-appearance" checked={settings.theme === theme} disabled={saving}
            onChange={() => setSettings({ ...settings, theme })} /> {t(`appearance.theme.${theme}`)}</span>
        </label>)}
      </div>
      <label className="appearance-check"><input type="checkbox" checked={settings.effectsEnabled} disabled={saving}
        onChange={(event) => setSettings({ ...settings, effectsEnabled: event.target.checked })} /><span>{t("appearance.admin_effects")}</span></label>
      <label className="appearance-check"><input type="checkbox" checked={settings.gamesEnabled} disabled={saving}
        onChange={(event) => setSettings({ ...settings, gamesEnabled: event.target.checked })} /><span>{t("appearance.admin_games")}</span></label>
      <p className="p">{t("appearance.admin_switch_hint")}</p>
    </>}
    {message && <p className="p" role="status">{message}</p>}
    {error && <p className="pre" role="alert">{error}</p>}
  </div></div>;
}

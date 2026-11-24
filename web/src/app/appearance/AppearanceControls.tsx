import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { useWinterSound } from "./winterSound";

export function AppearanceControls({ showHeading = true }: { showHeading?: boolean }) {
  const { t } = useI18n();
  const { settings, disabled, motion, reducedMotion, setDisabled, setMotion, snowfall, setSnowfall, phoneSnow } = useAppearance();
  const sound = useWinterSound();
  const active = !disabled && settings.theme !== "classic";
  return <div className="appearance-controls winter-settings-controls">
    {showHeading && <h3 className="h1">{t("appearance.settings_title")}</h3>}
    <label className="winter-setting-row">
      <span><strong>{t("appearance.use_theme")}</strong><small>{t("appearance.settings_theme_hint")}</small></span>
      <input className="winter-setting-toggle" type="checkbox" role="switch" aria-label={t("appearance.use_theme")} checked={active}
        onChange={(event) => setDisabled(!event.target.checked)} disabled={settings.theme === "classic"} />
    </label>
    <label className="winter-setting-row">
      <span><strong>{t("appearance.motion")}</strong><small>{t("appearance.settings_motion_hint")}</small></span>
      <input className="winter-setting-toggle" type="checkbox" role="switch" aria-label={t("appearance.motion")} checked={motion && active}
        disabled={!active || !settings.effectsEnabled || reducedMotion} onChange={(event) => setMotion(event.target.checked)} />
    </label>
    <label className="winter-setting-row winter-setting-row--select">
      <span><strong>{t("appearance.snow.intensity")}</strong><small>{t("appearance.settings_snow_hint")}</small></span>
      <select aria-label={t("appearance.snow.intensity")} value={snowfall} disabled={!motion || !active}
        onChange={(event) => setSnowfall(event.target.value as typeof snowfall)}>
        {(["off", "light", "steady", "flurry"] as const).map((value) => <option key={value} value={value}>{t(`appearance.snow.${value}`)}</option>)}
      </select>
    </label>
    <label className="winter-setting-row">
      <span><strong>{t("appearance.settings_sound")}</strong><small>{t("appearance.settings_sound_hint")}</small></span>
      <input className="winter-setting-toggle" type="checkbox" role="switch" aria-label={t("appearance.settings_sound")} checked={sound.enabled}
        onChange={(event) => sound.setEnabled(event.target.checked)} />
    </label>
    {phoneSnow.supported && <label className="winter-setting-row">
      <span><strong>{t("appearance.phone.title")}</strong><small>{t("appearance.phone.hint")}</small></span>
      <input className="winter-setting-toggle" type="checkbox" role="switch" aria-label={t("appearance.phone.title")} checked={phoneSnow.enabled}
        disabled={!active || !motion || snowfall === "off" || phoneSnow.status === "asking"} onChange={(event) => void phoneSnow.toggle(event.target.checked)} />
    </label>}
    {phoneSnow.status === "denied" && <p className="p winter-settings-note" role="status">{t("appearance.phone.denied")}</p>}
    {phoneSnow.status === "unavailable" && <p className="p winter-settings-note" role="status">{t("appearance.phone.unavailable")}</p>}
    {reducedMotion && <p className="p winter-settings-note">{t("appearance.reduced_motion")}</p>}
    <p className="p winter-settings-note">{t("appearance.local_preference")}</p>
  </div>;
}

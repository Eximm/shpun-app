import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";

export function AppearanceControls() {
  const { t } = useI18n();
  const { settings, disabled, motion, reducedMotion, setDisabled, setMotion } = useAppearance();
  return <div className="appearance-controls">
    <div className="h1">{t("appearance.title")}</div>
    <p className="p">{t(`appearance.theme.${settings.theme}`)}</p>
    <label className="appearance-check">
      <input type="checkbox" checked={!disabled && settings.theme !== "classic"} onChange={(event) => setDisabled(!event.target.checked)} disabled={settings.theme === "classic"} />
      <span>{t("appearance.use_theme")}</span>
    </label>
    <label className="appearance-check">
      <input type="checkbox" checked={motion && !disabled && settings.theme !== "classic"} disabled={disabled || !settings.effectsEnabled || reducedMotion || settings.theme === "classic"}
        onChange={(event) => setMotion(event.target.checked)} />
      <span>{t("appearance.motion")}</span>
    </label>
    {reducedMotion && <p className="p">{t("appearance.reduced_motion")}</p>}
    <p className="p">{t("appearance.local_preference")}</p>
  </div>;
}

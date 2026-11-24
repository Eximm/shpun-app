import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";

export function AppearanceControls() {
  const { t } = useI18n();
  const { settings, disabled, motion, reducedMotion, setDisabled, setMotion, snowfall, setSnowfall } = useAppearance();
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
    <label className="winter-snowfall-control"><span>{t("appearance.snow.intensity")}</span>
      <select aria-label={t("appearance.snow.intensity")} value={snowfall} disabled={!motion || disabled || settings.theme === "classic"} onChange={(event) => setSnowfall(event.target.value as typeof snowfall)}>
        {(["off","light","steady","flurry"] as const).map((value) => <option key={value} value={value}>{t(`appearance.snow.${value}`)}</option>)}
      </select>
    </label>
    <p className="p">{t("appearance.local_preference")}</p>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";
import { useAppearance, type SeasonalTheme } from "./AppearanceProvider";
import { AppearanceControls } from "./AppearanceControls";
import { WinterPlayground } from "./WinterPlayground";


export function SeasonalGameDialog({ theme, onClose }: { theme: Exclude<SeasonalTheme, "classic">; onClose: () => void }) {
  const { t } = useI18n();
  const { settings, disabled } = useAppearance();
  const [tab, setTab] = useState<"play" | "settings">(disabled || !settings.gamesEnabled ? "settings" : "play");
  useEffect(() => { if (!settings.gamesEnabled) setTab("settings"); }, [settings.gamesEnabled]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previous; };
  }, []);
  return createPortal(<dialog ref={dialogRef} className={`seasonal-dialog seasonal-dialog--${theme}`} onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="seasonal-dialog-title">
    <div className="seasonal-dialog-inner">
      <div className="modal__head">
        <h2 className="h1" id="seasonal-dialog-title">{t(`appearance.theme.${theme}`)}</h2>
        <button className="btn modal__close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
      </div>
      <div className="seasonal-tabs" role="group" aria-label={t("appearance.title")}>
        {settings.gamesEnabled && <button type="button" className={`btn${tab === "play" ? " btn--accent" : ""}`} aria-pressed={tab === "play"}
          onClick={() => setTab("play")}>{t("appearance.play")}</button>}
        <button type="button" className={`btn${tab === "settings" ? " btn--accent" : ""}`} aria-pressed={tab === "settings"}
          onClick={() => setTab("settings")}>{t("appearance.title")}</button>
      </div>
      {tab === "settings" ? <AppearanceControls /> : <>
        <WinterPlayground />
        <p className="p seasonal-game-note">{t("appearance.game_note")}</p>
      </>}
    </div>
  </dialog>, document.body);
}

export function SeasonalLauncher() {
  const { t } = useI18n();
  const { settings, disabled } = useAppearance();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const discover = () => { if (settings.gamesEnabled) setOpen(true); };
    window.addEventListener("shpun-winter-discovery", discover);
    return () => window.removeEventListener("shpun-winter-discovery", discover);
  }, [settings.gamesEnabled]);
  if (settings.theme === "classic") return null;
  return <>
    <button type="button" className="btn seasonal-launcher" onClick={() => setOpen(true)} aria-label={t("appearance.open")}
      aria-haspopup="dialog">
      <img src="/themes/winter-bauble.webp" alt="" />
      <span>{t(disabled || !settings.gamesEnabled ? "appearance.title" : "appearance.play")}</span>
    </button>
    {open && <SeasonalGameDialog key={settings.theme} theme={settings.theme} onClose={() => setOpen(false)} />}
  </>;
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { AppearanceControls } from "./AppearanceControls";

function WinterSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previous; };
  }, []);
  return createPortal(<dialog ref={dialogRef} className="seasonal-dialog winter-settings-dialog" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="winter-settings-title">
    <div className="winter-settings-inner">
      <header className="winter-settings-header">
        <img src="/themes/icons/snowflake.png" alt="" />
        <div><h2 id="winter-settings-title">{t("appearance.settings_title")}</h2><p>{t("appearance.settings_subtitle")}</p></div>
        <button className="btn" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
      </header>
      <AppearanceControls showHeading={false} />
      <button className="btn winter-settings-done" type="button" onClick={onClose}>{t("appearance.settings_done")}</button>
    </div>
  </dialog>, document.body);
}

export function SeasonalLauncher() {
  const { t } = useI18n();
  const { settings } = useAppearance();
  const [open, setOpen] = useState(false);
  if (settings.theme === "classic") return null;
  return <>
    <button type="button" className="btn seasonal-launcher" onClick={() => setOpen(true)} aria-label={t("appearance.open")}
      aria-haspopup="dialog" aria-expanded={open}>
      <img src="/themes/icons/snowflake.png" alt="" />
      <span>{t("appearance.settings_title")}</span>
    </button>
    {open && <WinterSettingsDialog onClose={() => setOpen(false)} />}
  </>;
}

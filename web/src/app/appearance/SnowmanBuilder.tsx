import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { SNOWMAN_COSTS } from "./snowModel";
import type { WinterSound } from "./winterSound";

export function SnowmanBuilder({ play }: { play: (sound: WinterSound) => void }) {
  const { t } = useI18n();
  const { workshop, buildSnowman, resetSnowman, motion } = useAppearance();
  const [open, setOpen] = useState(false);
  const [wave, setWave] = useState(false);
  const [scarf, setScarf] = useState(0);
  const taps = useRef(0);
  const corner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visit = () => { setOpen(true); setWave(true); play("bell"); corner.current?.scrollIntoView({ behavior: motion ? "smooth" : "instant", block: "nearest" }); };
    window.addEventListener("shpun-snowman-visit", visit);
    return () => window.removeEventListener("shpun-snowman-visit", visit);
  }, [motion, play]);
  useEffect(() => { if (!wave) return; const timer = setTimeout(() => setWave(false), 1300); return () => clearTimeout(timer); }, [wave]);
  if (workshop.snow === 0 && workshop.stage === 0) return null;
  const cost = SNOWMAN_COSTS[workshop.stage];
  return <div className="winter-snowman-corner" ref={corner}>
    <button type="button" className="winter-footprints" aria-expanded={open} onClick={() => { setOpen(!open); play("snow"); }}>
      <img src="/themes/icons/snowflake.png" alt="" /><span>{t("appearance.snow.footprints")}</span><span aria-hidden="true">···</span>
    </button>
    {open && <div className="winter-snowman-workshop">
      <div className="winter-snowman-preview">
        {workshop.stage < 3 ? <svg viewBox="0 0 180 190" role="img" aria-label={t(`appearance.snow.stage${workshop.stage}`)}>
          <defs><radialGradient id="snowball-light" cx="35%" cy="25%" r="75%"><stop stopColor="#fff" /><stop offset=".65" stopColor="#e5f3fa" /><stop offset="1" stopColor="#86b3c8" /></radialGradient></defs>
          <ellipse cx="90" cy="177" rx="64" ry="8" fill="#bfdbea25" />
          {workshop.stage > 0 && <circle cx="90" cy="132" r="45" fill="url(#snowball-light)" />}
          {workshop.stage > 1 && <circle cx="90" cy="77" r="34" fill="url(#snowball-light)" />}
          {workshop.stage === 0 && <path d="M30 166 Q90 140 150 166 Q110 185 30 166" fill="url(#snowball-light)" />}
        </svg> : <button type="button" className={`winter-snowman-friend${motion && wave ? " winter-snowman-friend--wave" : ""}`}
          aria-label={t("appearance.snow.greet")} onClick={() => { taps.current++; setWave(true); play(taps.current % 3 === 0 ? "melody" : "bell"); }}>
          <img src="/themes/icons/snowman.png" alt="" style={{ filter: `hue-rotate(${scarf}deg)` }} />
        </button>}
      </div>
      <div><h4>{t(`appearance.snow.stage${workshop.stage}`)}</h4><p className="p" role="status">{t("appearance.snow.stash", { count: Math.floor(workshop.snow) })}</p>
        {workshop.stage < 3 ? <button className="btn" type="button" disabled={workshop.snow < cost}
          onClick={() => { buildSnowman(); play("roll"); }}>{t("appearance.snow.roll", { count: cost })}</button> : <>
          <p className="p">{t("appearance.snow.friend_hint")}</p>
          <button className="btn" type="button" onClick={() => { setScarf((value) => (value + 65) % 360); play("bell"); }}>{t("appearance.snow.scarf")}</button>
          <button className="btn" type="button" onClick={() => { resetSnowman(); play("snow"); }}>{t("appearance.snow.rebuild")}</button>
        </>}
        {workshop.stage < 3 && workshop.snow < cost && <p className="p">{t("appearance.snow.need_more")}</p>}
      </div>
    </div>}
  </div>;
}

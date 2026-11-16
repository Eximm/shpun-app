import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { advanceRace, newRace, steerRace } from "./raceModel";

export function NeonRace() {
  const { t } = useI18n();
  const [race, setRace] = useState(newRace);
  const [playing, setPlaying] = useState(false);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem("shpun.neon.best.v1")) || 0; } catch { return 0; } });
  const touchStart = useRef<number | null>(null);
  const roadRef = useRef<HTMLDivElement>(null);
  const steer = useCallback((direction: number) => setRace((state) => steerRace(state, direction)), []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, previous = 0;
    const frame = (time: number) => {
      if (time - previous >= 40) {
        const delta = previous ? (time - previous) / 1000 : 0;
        previous = time;
        setRace((state) => advanceRace(state, delta));
      }
      raf = requestAnimationFrame(frame);
    };
    const visibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", visibility);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility); };
  }, [playing]);
  useEffect(() => {
    if (!race.finished) return;
    setPlaying(false);
    if (race.stars > best) {
      setBest(race.stars);
      try { localStorage.setItem("shpun.neon.best.v1", String(race.stars)); } catch { /* optional */ }
    }
  }, [race.finished, race.stars, best]);
  const laneY = (lane: number) => `${[42, 64, 85][lane]}%`;
  return <div className="seasonal-race" onKeyDown={(event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (["ArrowUp", "ArrowLeft"].includes(event.key)) { event.preventDefault(); steer(-1); }
    if (["ArrowDown", "ArrowRight"].includes(event.key)) { event.preventDefault(); steer(1); }
  }}>
    <p className="p">{t("appearance.race.hint")}</p>
    <div className="seasonal-game-stats" aria-live="polite">
      <span>{t("appearance.race.stars", { count: race.stars })}</span>
      <span>{t("appearance.race.lives", { count: Math.max(0, race.lives) })}</span>
      <span>{t("appearance.race.time", { count: Math.max(0, 30 - Math.floor(race.elapsed)) })}</span>
    </div>
    <div ref={roadRef} className={`seasonal-road${playing ? " seasonal-road--playing" : ""}`} role="img" aria-label={t("appearance.race.scene")}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={(event) => {
        if (touchStart.current == null) return;
        const dy = (event.changedTouches[0]?.clientY ?? touchStart.current) - touchStart.current;
        if (Math.abs(dy) > 18) steer(dy > 0 ? 1 : -1);
        touchStart.current = null;
      }}>
      <div className="seasonal-road-lines" />
      <img className="seasonal-car" src="/themes/neon-car.webp" style={{ top: laneY(race.lane) }} alt="" draggable={false} />
      {race.items.map((item) => <span key={item.id} className="seasonal-road-item" style={{ left: `${item.x}%`, top: laneY(item.lane) }} aria-hidden="true">
        {item.kind === "star" ? "⭐" : "🚧"}
      </span>)}
      {!playing && <div className="seasonal-road-pause">{t(race.finished ? "appearance.race.finished" : race.elapsed ? "appearance.race.paused" : "appearance.race.ready")}</div>}
    </div>
    <div className="seasonal-game-buttons">
      <button className="btn" type="button" onClick={() => steer(-1)} aria-label={t("appearance.race.up")}>↑</button>
      <button className="btn btn--primary" type="button" onClick={() => {
        if (race.finished) setRace(newRace());
        setPlaying((current) => !current);
        roadRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
      }}>{t(playing ? "appearance.race.pause" : race.finished ? "appearance.race.again" : "appearance.race.start")}</button>
      <button className="btn" type="button" onClick={() => steer(1)} aria-label={t("appearance.race.down")}>↓</button>
    </div>
    <p className="p">{t("appearance.race.best", { count: best })}</p>
  </div>;
}

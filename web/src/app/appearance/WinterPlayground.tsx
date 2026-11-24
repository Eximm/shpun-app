import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { WinterTree } from "./WinterTree";
import { useWinterSound } from "./winterSound";
import { WINTER_DECORATIONS, type DecorationKind } from "./winterCatalog";

export function WinterPlayground() {
  const { t } = useI18n();
  const sound = useWinterSound();
  const [tab, setTab] = useState("tree");
  const [gift, setGift] = useState(-1);
  const [kind, setKind] = useState<DecorationKind>("bauble");
  const icons: Record<string, string> = { tree: "/themes/winter-tree.webp", collection: "/themes/icons/palette.png", snow: "/themes/icons/snowflake.png", globe: "/themes/icons/globe.png", gifts: "/themes/icons/gift.png" };
  return <div className="winter-playground">
    <div className="winter-room-intro"><img src="/themes/icons/snowman.png" alt="" /><div><p className="winter-room-eyebrow">{t("appearance.room.eyebrow")}</p>
      <h3>{t("appearance.room.title")}</h3><p className="p">{t("appearance.room.subtitle")}</p></div></div>
    <label className="appearance-check"><input type="checkbox" checked={sound.enabled} onChange={(event) => {
      sound.setEnabled(event.target.checked); if (event.target.checked) sound.play("bell", true);
    }} /><span>{t("appearance.winter.sound")}</span></label>
    <div className="winter-activity-nav" role="group" aria-label={t("appearance.winter.activities")}>
      {["tree", "collection", "snow", "globe", "gifts"].map((item) => <button key={item} type="button" className={`btn${tab === item ? " btn--accent" : ""}`}
        aria-pressed={tab === item} onClick={() => { setTab(item); sound.play("bell"); }}><img src={icons[item]} alt="" /><span>{t(`appearance.winter.${item}`)}</span></button>)}
    </div>
    {tab === "tree" && <WinterTree play={sound.play} kind={kind} setKind={setKind} />}
    {tab === "collection" && <div className="winter-collection"><p className="p">{t("appearance.room.collection_hint")}</p>
      <div className="winter-collection-grid">{WINTER_DECORATIONS.map((item) => <button key={item.id} type="button" className="btn winter-collection-item"
        onClick={() => { setKind(item.id); setTab("tree"); sound.play("bell"); }}><img src={item.image} alt="" /><span>{t(`appearance.decoration.${item.id}`)}</span></button>)}</div></div>}
    {tab === "snow" && <WinterSnow play={sound.play} />}
    {tab === "globe" && <WinterGlobe play={sound.play} />}
    {tab === "gifts" && <div className="winter-gifts">
      <p className="p">{t("appearance.winter.gifts_hint")}</p>
      <div className="winter-gift-grid">{[0, 1, 2].map((item) => <button type="button" className={`btn winter-gift${gift === item ? " winter-gift--open" : ""}`}
        key={item} aria-label={t("appearance.winter.gift", { count: item + 1 })} aria-pressed={gift === item}
        onClick={() => { setGift(item); sound.play("gift"); }}><img src={gift === item ? "/themes/icons/sparkles.png" : "/themes/icons/gift.png"} alt="" draggable={false} /></button>)}</div>
      <p className="p winter-wish" role="status">{gift >= 0 ? t(`appearance.winter.wish${gift}`) : t("appearance.winter.choose_gift")}</p>
      <button type="button" className="btn" onClick={() => { setGift(-1); sound.play("snow"); }}>{t("appearance.winter.wrap")}</button>
    </div>}
  </div>;
}

function WinterGlobe({ play }: { play: ReturnType<typeof useWinterSound>["play"] }) {
  const { t } = useI18n();
  const { motion } = useAppearance();
  const [burst, setBurst] = useState(false);
  const [tilt, setTilt] = useState(0);
  const drag = useRef<number | null>(null);
  useEffect(() => { if (!burst) return; const timer = window.setTimeout(() => setBurst(false), 2200); return () => clearTimeout(timer); }, [burst]);
  const shake = () => { setBurst(true); play("snow"); };
  return <div className="winter-globe-room"><p className="p">{t("appearance.room.globe_hint")}</p>
    <button type="button" className={`winter-globe${burst && motion ? " winter-globe--snowing" : ""}`} aria-label={t("appearance.room.globe_shake")}
      style={{ transform: `rotate(${tilt}deg)` }} onClick={shake}
      onPointerDown={(event) => { drag.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current !== null && motion) setTilt(Math.max(-12, Math.min(12, (event.clientX - drag.current) / 5))); }}
      onPointerUp={() => { drag.current = null; setTilt(0); shake(); }} onPointerCancel={() => { drag.current = null; setTilt(0); }}>
      <img className="winter-globe-image" src="/themes/icons/globe.png" alt="" draggable={false} />
      <span className="winter-globe-flakes" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <img key={index} src="/themes/icons/snowflake.png"
        style={{ left: `${16 + index * 37 % 68}%`, top: `${12 + index * 19 % 52}%`, animationDelay: `${index * -.13}s` }} alt="" />)}</span>
    </button>
    <p className="p" role="status">{t(burst ? "appearance.room.globe_wish" : "appearance.room.globe_idle")}</p>
  </div>;
}

function WinterSnow({ play }: { play: ReturnType<typeof useWinterSound>["play"] }) {
  const { t } = useI18n();
  const { motion } = useAppearance();
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [seconds, setSeconds] = useState(30);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem("shpun.winter.snow.best.v1")) || 0; } catch { return 0; } });
  const canvas = useRef<HTMLCanvasElement>(null);
  const basket = useRef(.5);
  const points = useRef(0);
  const sound = useRef(play);
  sound.current = play;
  const sprites = useRef<{ flake: HTMLImageElement; gloves: HTMLImageElement } | null>(null);
  useEffect(() => {
    const flake = new Image(), gloves = new Image();
    flake.src = "/themes/icons/snowflake.png"; gloves.src = "/themes/icons/gloves.png";
    sprites.current = { flake, gloves };
  }, []);
  useEffect(() => {
    if (!running) return;
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx) return;
    let raf = 0, previous = 0, elapsed = 0, spawn = 0;
    const flakes: { x: number; y: number; speed: number; caught: boolean }[] = [];
    const width = 600, height = 360;
    target.width = width; target.height = height;
    const frame = (now: number) => {
      if (document.hidden) { setRunning(false); return; }
      if (previous && now - previous < 32) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(previous ? (now - previous) / 1000 : 0, .05); previous = now; elapsed += dt; spawn += dt;
      setSeconds(Math.max(0, Math.ceil(30 - elapsed)));
      if (spawn > .45) { spawn = 0; flakes.push({ x: 20 + Math.random() * 560, y: -10, speed: 65 + Math.random() * 50, caught: false }); }
      ctx.clearRect(0, 0, width, height);
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i]; f.y += f.speed * dt;
        if (!f.caught && f.y >= 302 && f.y < 335 && Math.abs(f.x - basket.current * width) < 45) {
          f.caught = true; points.current++; setScore(points.current);
          sound.current("snow");
        }
        if (f.caught || f.y > 380) { flakes.splice(i, 1); continue; }
        const image = sprites.current?.flake;
        if (image?.complete && image.naturalWidth) ctx.drawImage(image, f.x - 13, f.y - 13, 26, 26);
      }
      const image = sprites.current?.gloves;
      if (image?.complete && image.naturalWidth) ctx.drawImage(image, basket.current * width - 27, 295, 54, 54);
      if (elapsed >= 30) {
        sound.current("gift");
        setRunning(false); setBest((old) => { const next = Math.max(old, points.current); try { localStorage.setItem("shpun.winter.snow.best.v1", String(next)); } catch { /* optional */ } return next; });
      } else raf = requestAnimationFrame(frame);
    };
    const hidden = () => { if (document.hidden) setRunning(false); };
    document.addEventListener("visibilitychange", hidden);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", hidden); };
  }, [running]);
  return <div>
    <p className="p">{t("appearance.winter.snow_hint")}</p>
    <div className="winter-snow-stats" role="status">{t("appearance.winter.snow_score", { count: score, seconds, best })}</div>
    <canvas ref={canvas} className="winter-snow-game" width={600} height={360} aria-label={t("appearance.winter.snow_scene")}
      onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); basket.current = Math.max(.07, Math.min(.93, (event.clientX - box.left) / box.width)); }} />
    <label className="appearance-check"><span>{t("appearance.winter.mitten")}</span><input className="winter-mitten-range" type="range" min="7" max="93" defaultValue="50"
      onChange={(event) => { basket.current = Number(event.target.value) / 100; }} /></label>
    <div className="seasonal-game-buttons"><button type="button" className="btn btn--primary" onClick={() => {
      if (running) { setRunning(false); return; } points.current = 0; setScore(0); setSeconds(30); setRunning(true); play("snow");
    }}>{t(running ? "appearance.winter.stop" : "appearance.winter.start")}</button></div>
    {!motion && <p className="p">{t("appearance.winter.manual_motion")}</p>}
  </div>;
}

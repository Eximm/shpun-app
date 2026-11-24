import { useEffect, useRef, useState } from "react";
import type { WinterSound } from "./winterSound";
import { useAppearance } from "./AppearanceProvider";
import { useI18n } from "../../shared/i18n";

import { restoreTree, type Ornament } from "./treeModel";
import { decorationImage, WINTER_DECORATIONS, type DecorationKind } from "./winterCatalog";
import { SnowmanBuilder } from "./SnowmanBuilder";
const KEY = "shpun.winter.tree.v1";
function readTree(): Ornament[] {
  try {
    return restoreTree(localStorage.getItem(KEY) || "[]");
  } catch { return []; }
}

export function WinterTree({ play, kind, setKind }: { play: (kind: WinterSound) => void; kind: DecorationKind; setKind: (kind: DecorationKind) => void }) {
  const { motion, workshop } = useAppearance();
  const [aurora, setAurora] = useState(false);
  const starTaps = useRef({ count: 0, at: 0 });
  useEffect(() => { if (!aurora) return; const timer = setTimeout(() => setAurora(false), 2600); return () => clearTimeout(timer); }, [aurora]);
  const [toolsOpen, setToolsOpen] = useState(() => window.matchMedia("(min-width: 650px)").matches);
  const [twinkle, setTwinkle] = useState(false);
  const [star, setStar] = useState(true);
  const [shake, setShake] = useState(false);
  const [history, setHistory] = useState<Ornament[][]>([]);
  const remember = () => setHistory((old) => [...old.slice(-9), ornaments.map((item) => ({ ...item }))]);
  const { t } = useI18n();
  const [ornaments, setOrnaments] = useState(readTree);
  const [color, setColor] = useState(0);
  const [lights, setLights] = useState(true);
  const [celebrate, setCelebrate] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const moved = useRef(false);
  const sequence = useRef(Math.max(0, ...ornaments.map((item) => item.id)));
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ornaments)); } catch { /* artwork is still usable for this visit */ }
  }, [ornaments]);
  useEffect(() => {
    if (!celebrate && !shake) return;
    const timer = window.setTimeout(() => { setCelebrate(false); setShake(false); }, 1600);
    return () => window.clearTimeout(timer);
  }, [celebrate, shake]);
  const point = (clientX: number, clientY: number) => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: Math.max(10, Math.min(90, (clientX - box.left) / box.width * 100)),
      y: Math.max(15, Math.min(88, (clientY - box.top) / box.height * 100)) };
  };
  return <div className="seasonal-tree-editor">
    <p className="p">{t("appearance.tree.hint")}</p>
    <details className="winter-tree-tools" open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
      <summary><img src={decorationImage(kind)} alt="" /><span>{t("appearance.room.tools")}</span></summary>
    <div className="winter-decoration-picker" role="group" aria-label={t("appearance.room.decorations")}>
      {WINTER_DECORATIONS.map((item) => <button className={`btn${kind === item.id ? " btn--accent" : ""}`} key={item.id} type="button"
        aria-pressed={kind === item.id} aria-label={t(`appearance.decoration.${item.id}`)} onClick={() => { setKind(item.id); play("bell"); }}>
        <img src={item.image} alt="" draggable={false} />
      </button>)}
    </div>
    <div className="seasonal-tree-palette" role="group" aria-label={t("appearance.tree.colors")}>
      {[0, 65, 180, 280].map((hue, index) => <button key={hue} type="button" className={`btn${color === hue ? " btn--accent" : ""}`}
        aria-pressed={color === hue} aria-label={t(`appearance.tree.color${index}`)} onClick={() => setColor(hue)}>
        <img src="/themes/winter-bauble.webp" style={{ filter: `hue-rotate(${hue}deg)` }} alt="" draggable={false} />
      </button>)}
    </div>
    </details>
    <div ref={stageRef} className={`seasonal-tree-stage${aurora ? " winter-tree--aurora" : ""}${motion && twinkle ? " winter-tree--twinkle" : ""}${motion && shake ? " winter-tree--shake" : ""}${lights ? " seasonal-tree-stage--lit" : ""}${celebrate && motion ? " seasonal-tree-stage--celebrate" : ""}`}
      onClick={(event) => {
        if (moved.current) { moved.current = false; return; }
        if ((event.target as HTMLElement).closest("button") || ornaments.length >= 24) return;
        const pos = point(event.clientX, event.clientY);
        remember(); play("bell");
        setOrnaments((items) => [...items, { id: ++sequence.current, ...pos, color, kind }]);
      }}>
      <img src="/themes/winter-tree.webp" className="seasonal-tree-image" alt={t("appearance.tree.image")} draggable={false} />
      <button type="button" className={`winter-tree-star${star ? " winter-tree-star--lit" : ""}`} aria-label={t("appearance.winter.star_ring")} onClick={() => {
        const now = performance.now(); starTaps.current = { count: now - starTaps.current.at < 1600 ? starTaps.current.count + 1 : 1, at: now };
        if (starTaps.current.count === 3) { setAurora(true); starTaps.current.count = 0; play("melody"); } else play("bell"); setCelebrate(true);
      }} />
      {workshop.stage === 3 && <button type="button" className="winter-tree-snowman" aria-label={t("appearance.snow.greet")} onClick={() => window.dispatchEvent(new Event("shpun-snowman-visit"))}>
        <img src="/themes/icons/snowman.png" alt="" />
      </button>}
      {ornaments.map((item) => <button key={item.id} type="button" className="seasonal-tree-ornament"
        style={{ left: `${item.x}%`, top: `${item.y}%`, filter: `hue-rotate(${item.color}deg)` }}
        aria-label={t("appearance.tree.ornament", { count: item.id })}
        onPointerDown={(event) => { remember(); drag.current = item.id; moved.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (drag.current !== item.id) return;
          moved.current = true;
          const pos = point(event.clientX, event.clientY);
          setOrnaments((items) => items.map((current) => current.id === item.id ? { ...current, ...pos } : current));
        }}
        onPointerUp={() => { drag.current = null; play("bell"); }} onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => { remember(); play("bell"); setOrnaments((items) => items.filter((current) => current.id !== item.id)); }}
        onKeyDown={(event) => {
          if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); setOrnaments((items) => items.filter((current) => current.id !== item.id)); }
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
          const offset = offsets[event.key];
          if (offset) { event.preventDefault(); setOrnaments((items) => items.map((current) => current.id === item.id
            ? { ...current, x: Math.max(10, Math.min(90, current.x + offset[0])), y: Math.max(15, Math.min(88, current.y + offset[1])) } : current)); }
        }}>
        <img src={decorationImage(item.kind)} alt="" draggable={false} />
      </button>)}
      <div className="seasonal-tree-sparkles" aria-hidden="true">✦　　✧　　✦　　✧　　✦</div>
    </div>
    <div className="seasonal-game-buttons">
      <button className="btn" type="button" aria-pressed={lights} onClick={() => { setLights(!lights); play("bell"); }}>{t(lights ? "appearance.tree.lights_off" : "appearance.tree.lights_on")}</button>
      <button className="btn btn--primary" type="button" onClick={() => { setCelebrate(true); play("melody"); }}>{t("appearance.tree.magic")}</button>
      <button className="btn" type="button" onClick={() => { remember(); setOrnaments([]); play("snow"); }}>{t("appearance.tree.clear")}</button>
    </div>
    <div className="seasonal-game-buttons">
      <button className="btn" type="button" onClick={() => { remember(); setOrnaments(Array.from({ length: 18 }, (_, i) => ({ id: ++sequence.current, x: 50 + Math.sin(i * 2.4) * (9 + i * 1.2), y: 25 + i * 3.3, color: [0, 65, 180, 280][i % 4], kind: WINTER_DECORATIONS[i % WINTER_DECORATIONS.length].id }))); play("gift"); }}>{t("appearance.winter.auto")}</button>
      <button className="btn" type="button" disabled={!history.length} onClick={() => { setOrnaments(history[history.length - 1]); setHistory((old) => old.slice(0, -1)); play("bell"); }}>{t("appearance.winter.undo")}</button>
      <button className="btn" type="button" aria-pressed={twinkle} onClick={() => { setTwinkle(!twinkle); play("bell"); }}>{t("appearance.winter.twinkle")}</button>
      <button className="btn" type="button" aria-pressed={star} onClick={() => { setStar(!star); play("bell"); }}>{t("appearance.winter.star")}</button>
      <button className="btn" type="button" onClick={() => { setShake(true); play("snow"); }}>{t("appearance.winter.shake")}</button>
    </div>
    <p className="p" aria-live="polite">{t("appearance.tree.count", { count: ornaments.length })}</p>
    <SnowmanBuilder play={play} />
  </div>;
}

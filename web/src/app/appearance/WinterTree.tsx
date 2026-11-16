import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";

type Ornament = { id: number; x: number; y: number; color: number };
const KEY = "shpun.winter.tree.v1";
function readTree(): Ornament[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => Number.isFinite(item?.id) && Number.isFinite(item?.x) && Number.isFinite(item?.y)
      && item.x >= 10 && item.x <= 90 && item.y >= 15 && item.y <= 88 && [0, 65, 180, 280].includes(item.color)).slice(0, 24) : [];
  } catch { return []; }
}

export function WinterTree() {
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
    if (!celebrate) return;
    const timer = window.setTimeout(() => setCelebrate(false), 1600);
    return () => window.clearTimeout(timer);
  }, [celebrate]);
  const point = (clientX: number, clientY: number) => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: Math.max(10, Math.min(90, (clientX - box.left) / box.width * 100)),
      y: Math.max(15, Math.min(88, (clientY - box.top) / box.height * 100)) };
  };
  return <div className="seasonal-tree-editor">
    <p className="p">{t("appearance.tree.hint")}</p>
    <div className="seasonal-tree-palette" role="group" aria-label={t("appearance.tree.colors")}>
      {[0, 65, 180, 280].map((hue, index) => <button key={hue} type="button" className={`btn${color === hue ? " btn--accent" : ""}`}
        aria-pressed={color === hue} aria-label={t(`appearance.tree.color${index}`)} onClick={() => setColor(hue)}>
        <img src="/themes/winter-bauble.webp" style={{ filter: `hue-rotate(${hue}deg)` }} alt="" draggable={false} />
      </button>)}
    </div>
    <div ref={stageRef} className={`seasonal-tree-stage${lights ? " seasonal-tree-stage--lit" : ""}${celebrate ? " seasonal-tree-stage--celebrate" : ""}`}
      onClick={(event) => {
        if (moved.current) { moved.current = false; return; }
        if ((event.target as HTMLElement).closest("button") || ornaments.length >= 24) return;
        const pos = point(event.clientX, event.clientY);
        setOrnaments((items) => [...items, { id: ++sequence.current, ...pos, color }]);
      }}>
      <img src="/themes/winter-tree.webp" className="seasonal-tree-image" alt={t("appearance.tree.image")} draggable={false} />
      {ornaments.map((item) => <button key={item.id} type="button" className="seasonal-tree-ornament"
        style={{ left: `${item.x}%`, top: `${item.y}%`, filter: `hue-rotate(${item.color}deg)` }}
        aria-label={t("appearance.tree.ornament", { count: item.id })}
        onPointerDown={(event) => { drag.current = item.id; moved.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (drag.current !== item.id) return;
          moved.current = true;
          const pos = point(event.clientX, event.clientY);
          setOrnaments((items) => items.map((current) => current.id === item.id ? { ...current, ...pos } : current));
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => setOrnaments((items) => items.filter((current) => current.id !== item.id))}
        onKeyDown={(event) => {
          if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); setOrnaments((items) => items.filter((current) => current.id !== item.id)); }
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
          const offset = offsets[event.key];
          if (offset) { event.preventDefault(); setOrnaments((items) => items.map((current) => current.id === item.id
            ? { ...current, x: Math.max(10, Math.min(90, current.x + offset[0])), y: Math.max(15, Math.min(88, current.y + offset[1])) } : current)); }
        }}>
        <img src="/themes/winter-bauble.webp" alt="" draggable={false} />
      </button>)}
      <div className="seasonal-tree-sparkles" aria-hidden="true">✦　　✧　　✦　　✧　　✦</div>
    </div>
    <div className="seasonal-game-buttons">
      <button className="btn" type="button" aria-pressed={lights} onClick={() => setLights(!lights)}>{t(lights ? "appearance.tree.lights_off" : "appearance.tree.lights_on")}</button>
      <button className="btn btn--primary" type="button" onClick={() => setCelebrate(true)}>{t("appearance.tree.magic")}</button>
      <button className="btn" type="button" onClick={() => setOrnaments([])}>{t("appearance.tree.clear")}</button>
    </div>
    <p className="p" aria-live="polite">{t("appearance.tree.count", { count: ornaments.length })}</p>
  </div>;
}

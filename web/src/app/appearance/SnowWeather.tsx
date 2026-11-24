import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { bankCeiling, bankPath, brushBank, createBank, depositFlake, growBank, SNOWFALL, type SnowBank } from "./snowModel";
import { useWinterSound } from "./winterSound";

type Surface = { id: number; element: HTMLElement; bank: SnowBank; x: number; y: number; width: number; limit: number };
type Cap = { id: number; x: number; y: number; width: number; path: string };
type Flake = { x: number; y: number; speed: number; radius: number; phase: number };
type Puff = { x: number; y: number; vx: number; vy: number; life: number };

export function SnowWeather() {
  const { snowfall, motion, collectSnow, workshop, settings } = useAppearance();
  const { t } = useI18n();
  const { play } = useWinterSound();
  const audio = useRef(play); audio.current = play;
  const canvas = useRef<HTMLCanvasElement>(null);
  const scaleProbe = useRef<HTMLSpanElement>(null);
  const [overlay, setOverlay] = useState({ scale: 1, x: 0, y: 0 });
  const surfaces = useRef<Surface[]>([]);
  const surfaceCache = useRef(new WeakMap<HTMLElement, Surface>());
  const sequence = useRef(1);
  const puffs = useRef<Puff[]>([]);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const gradientId = useId().replace(/:/g, "");
  const collectedFraction = useRef(0);
  const [hint, setHint] = useState(false);
  useEffect(() => { if (!hint) return; const timer = setTimeout(() => setHint(false), 9000); return () => clearTimeout(timer); }, [hint]);

  useEffect(() => {
    if (!motion || snowfall === "off") { setCaps([]); return; }
    const target = canvas.current, ctx = target?.getContext("2d");
    if (!target || !ctx) return;
    let width = 0, height = 0, raf = 0, previous = 0, published = 0, layoutAt = 0, dirty = true;
    let pointerX = -1000, pointerY = -1000;
    const particles: Flake[] = [];
    const resize = () => {
      width = innerWidth; height = innerHeight;
      // body uses CSS zoom (.87 mobile / .92 tablet). Card DOMRects and
      // pointer coordinates are visual pixels; positioned children use CSS
      // pixels. Measure the actual scale instead of applying that zoom twice.
      const measured = (scaleProbe.current?.getBoundingClientRect().width ?? 100) / 100;
      const scale = Number.isFinite(measured) && measured > 0 ? measured : 1;
      const origin = target.parentElement!.getBoundingClientRect();
      setOverlay({ scale, x: origin.left, y: origin.top });
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      target.width = Math.round(width * dpr); target.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      particles.length = 0;
      const count = Math.round(SNOWFALL[snowfall].count * Math.min(1, width / 900));
      for (let i = 0; i < count; i++) particles.push({ x: Math.random() * width, y: Math.random() * height,
        speed: 26 + Math.random() * 48, radius: .8 + Math.random() * 2.2, phase: Math.random() * 6.28 });
    };
    const layout = () => {
      const main = document.querySelector(".app[data-seasonal=winter] > .main");
      const elements = main ? Array.from(main.querySelectorAll<HTMLElement>(".home-balance-card,.card,[data-snow-surface]"))
        .filter((el) => !el.parentElement?.closest(".card,.home-balance-card,[data-snow-surface]")) : [];
      const old = surfaceCache.current;
      const headerBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 70;
      const boxes = elements.slice(0, 16).map((element) => ({ element, box: element.getBoundingClientRect() }));
      surfaces.current = boxes.filter(({ box }) => box.width > 85 && box.height > 40 && box.top > headerBottom + 18 && box.top < height - 65).map(({ element, box }) => {
        const above = boxes.filter((other) => other.element !== element && other.box.bottom <= box.top + 1 && other.box.right > box.left && other.box.left < box.right);
        const gap = above.length ? box.top - Math.max(...above.map((other) => other.box.bottom)) : 30;
        const surface = old.get(element) ?? { id: sequence.current++, element, bank: createBank(Math.random()), x: 0, y: 0, width: 0, limit: 17 };
        const positioned = { ...surface, x: box.left + 8, y: box.top, width: Math.max(1, box.width - 16), limit: Math.max(3, Math.min(17, gap - 2)) };
        old.set(element, positioned);
        return positioned;
      });
      dirty = false;
    };
    const mark = () => { dirty = true; };
    const observer = new MutationObserver(mark);
    const main = document.querySelector(".main");
    if (main) observer.observe(main, { childList: true, subtree: true });
    const ro = new ResizeObserver(mark); if (main) ro.observe(main);
    const move = (event: PointerEvent) => { pointerX = event.clientX; pointerY = event.clientY; };
    const leave = () => { pointerX = -1000; pointerY = -1000; };
    const recycle = (p: Flake, top = true) => { p.x = Math.random() * width; p.y = top ? -10 - Math.random() * 30 : Math.random() * height; };
    const frame = (time: number) => {
      if (previous && time - previous < 32) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(previous ? (time - previous) / 1000 : 0, .06); previous = time;
      const layoutChanged = dirty || time - layoutAt > 650;
      if (layoutChanged) { layout(); layoutAt = time; }
      const modal = !!document.querySelector("dialog[open]");
      ctx.clearRect(0, 0, width, height);
      if (!modal) {
        for (const surface of surfaces.current) {
          growBank(surface.bank, dt, snowfall);
          for (let i = 0; i < surface.bank.heights.length; i++) surface.bank.heights[i] = Math.min(bankCeiling(surface.bank, i, surface.limit), surface.bank.heights[i]);
        }
        for (const p of particles) {
          const before = p.y;
          p.y += p.speed * dt; p.x += (Math.sin(time / 1600 + p.phase) * 13 + 5) * dt;
          const dx = p.x - pointerX, dy = p.y - pointerY, distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 65) { p.x += dx / distance * dt * 50; p.y += dy / distance * dt * 30; }
          for (const surface of surfaces.current) {
            if (p.x < surface.x || p.x > surface.x + surface.width) continue;
            const x = (p.x - surface.x) / surface.width;
            const edge = surface.y - surface.bank.heights[Math.round(x * 47)];
            if (before <= edge && p.y >= edge) { depositFlake(surface.bank, x, p.radius * .12); recycle(p); break; }
          }
          if (p.y > height + 12 || p.x < -15 || p.x > width + 15) recycle(p);
          ctx.globalAlpha = .3 + p.radius * .17; ctx.fillStyle = "#f5fbff";
          ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = puffs.current.length - 1; i >= 0; i--) {
          const p = puffs.current[i]; p.life -= dt; p.vy += 110 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.life <= 0) { puffs.current.splice(i, 1); continue; }
          ctx.globalAlpha = p.life; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (layoutChanged || time - published > 160) {
        setCaps(modal ? [] : surfaces.current.filter((s) => Math.max(...s.bank.heights) > .6).map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, path: bankPath(s.bank, s.width) })));
        published = time;
      }
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const visibility = () => { cancelAnimationFrame(raf); previous = 0; if (!document.hidden) { dirty = true; raf = requestAnimationFrame(frame); } };
    resize(); layout(); visibility();
    window.addEventListener("resize", resize); window.addEventListener("scroll", mark, { passive: true, capture: true });
    window.addEventListener("pointermove", move, { passive: true }); window.addEventListener("pointerout", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); ctx.clearRect(0,0,width,height);
      window.removeEventListener("resize", resize); window.removeEventListener("scroll", mark, true); window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave); document.removeEventListener("visibilitychange", visibility); };
  }, [motion, snowfall]);

  const sweep = (cap: Cap, clientX: number, whole = false) => {
    const surface = surfaces.current.find((s) => s.id === cap.id); if (!surface) return;
    const x = Math.max(0, Math.min(1, (clientX - surface.x) / surface.width));
    const removed = whole ? surface.bank.heights.reduce((sum, h) => sum + h, 0) : brushBank(surface.bank, x, Math.max(.09, 40 / surface.width));
    if (whole) surface.bank.heights.fill(0);
    if (removed < .01) return;
    collectedFraction.current += removed / 6;
    const units = Math.floor(collectedFraction.current);
    if (units > 0) { collectedFraction.current -= units; collectSnow(units); if (workshop.snow < 15 && workshop.snow + units >= 15) setHint(true); }
    audio.current("snow");
    for (let i = 0; i < 12 && puffs.current.length < 90; i++) puffs.current.push({ x: clientX, y: cap.y - 4, vx: (Math.random() - .5) * 120, vy: -20 - Math.random() * 65, life: .6 + Math.random() * .4 });
    setCaps((old) => old.map((s) => s.id === cap.id ? { ...s, path: bankPath(surface.bank, surface.width) } : s));
  };
  if (!motion || snowfall === "off") return null;
  return <div className="snow-weather">
    <span ref={scaleProbe} className="snow-scale-probe" aria-hidden="true" />
    <canvas className="seasonal-particles" ref={canvas} aria-hidden="true" />
    {caps.map((cap) => <button key={cap.id} type="button" className="snowdrift" data-snow-id={cap.id} aria-label={t("appearance.snow.brush")}
      style={{ left: (cap.x - overlay.x) / overlay.scale, top: (cap.y - 22 - overlay.y) / overlay.scale,
        width: cap.width / overlay.scale, height: 28 / overlay.scale }}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: cap.id, x: event.clientX }; sweep(cap, event.clientX); }}
      onPointerMove={(event) => { if (drag.current?.id !== cap.id) return; const from = drag.current.x; const steps = Math.max(1, Math.ceil(Math.abs(event.clientX - from) / 12));
        for (let i = 1; i <= steps; i++) sweep(cap, from + (event.clientX - from) * i / steps); drag.current.x = event.clientX; }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onClick={(event) => { if (event.detail === 0) sweep(cap, cap.x + cap.width / 2, true); }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${cap.width} 28`} aria-hidden="true">
        <defs><linearGradient id={`${gradientId}-${cap.id}`} x2="0" y2="1"><stop offset="0%" stopColor="#fff" /><stop offset="55%" stopColor="#edf8ff" /><stop offset="100%" stopColor="#a9cddc" /></linearGradient></defs>
        <path d={cap.path} fill={`url(#${gradientId}-${cap.id})`} />
      </svg>
    </button>)}
    {hint && settings.gamesEnabled && <button type="button" className="snow-discovery" onClick={() => { setHint(false); window.dispatchEvent(new Event("shpun-winter-discovery")); }}>
      <img src="/themes/icons/snowman.png" alt="" /><span>{t("appearance.snow.discovery")}</span>
    </button>}
  </div>;
}

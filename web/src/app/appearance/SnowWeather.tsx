import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { useAppearance } from "./AppearanceProvider";
import { bankPath, brushBank, createDustedBank, depositFlake, growBank, restoreBanks, serializeBanks, snowOpacity, snowfallCount, SNOWFALL, loosenBank, landSnow, fallSnow, type SnowChunk, type SnowBank } from "./snowModel";
import { WINTER_ACTIVITIES_ENABLED } from "./winterFeatures";
import { useWinterSound } from "./winterSound";

const BANKS_KEY = "shpun.winter.snowbanks.v1";
type Surface = { id: number; element: HTMLElement; bank: SnowBank; x: number; y: number; width: number; limit: number; visible: boolean; borderTop: number; borderLeft: number; navigation: boolean; releaseArmed: boolean; releaseAt: number };
type Cap = { id: number; x: number; y: number; width: number; path: string; opacity: number; element: HTMLElement; borderTop: number; borderLeft: number };
type Flake = { x: number; y: number; speed: number; radius: number; phase: number; settles: boolean; life?: number };
type Puff = { x: number; y: number; vx: number; vy: number; life: number };

export function SnowWeather() {
  const { snowfall, motion, collectSnow, workshop, settings, phoneSnow, setPhoneSceneActive } = useAppearance();
  const phone = useRef(phoneSnow); phone.current = phoneSnow;
  const [gust, setGust] = useState(false);
  useEffect(() => { setPhoneSceneActive(true); return () => setPhoneSceneActive(false); }, [setPhoneSceneActive]);
  const { t } = useI18n();
  const sounds = useWinterSound();
  const audio = useRef(sounds); audio.current = sounds;
  const canvas = useRef<HTMLCanvasElement>(null);
  const scaleProbe = useRef<HTMLSpanElement>(null);
  const [overlay, setOverlay] = useState({ scale: 1 });
  const surfaces = useRef<Surface[]>([]);
  const surfaceCache = useRef(new WeakMap<HTMLElement, Surface>());
  const [savedBanks] = useState(() => { try { return restoreBanks(localStorage.getItem(BANKS_KEY)); } catch { return new Map<string, SnowBank>(); } });
  const persist = () => { try { localStorage.setItem(BANKS_KEY, serializeBanks(savedBanks)); } catch { /* session-only snow still works */ } };
  const persistence = useRef(persist); persistence.current = persist;
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
    let width = 0, height = 0, raf = 0, previous = 0, published = 0, layoutAt = 0, savedAt = 0, dirty = true;
    let pointerX = -1000, pointerY = -1000, gustUntil = 0, handledShake = -Infinity, previousGust = false;
    const particles: Flake[] = [];
    const decorated = new Set<HTMLElement>();
    const chunks: SnowChunk[] = [];
    const resize = () => {
      width = innerWidth; height = innerHeight;
      // body uses CSS zoom (.87 mobile / .92 tablet). Card DOMRects and
      // pointer coordinates are visual pixels; positioned children use CSS
      // pixels. Measure the actual scale instead of applying that zoom twice.
      const measured = (scaleProbe.current?.getBoundingClientRect().width ?? 100) / 100;
      const scale = Number.isFinite(measured) && measured > 0 ? measured : 1;
      setOverlay({ scale });
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      target.width = Math.round(width * dpr); target.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      particles.length = 0;
      const count = snowfallCount(snowfall, width, height);
      for (let i = 0; i < count; i++) particles.push({ x: Math.random() * width, y: (i + Math.random()) / count * height,
        speed: 26 + Math.random() * 48, radius: .8 + Math.random() * 2.2, phase: Math.random() * 6.28, settles: i % 4 === 0 });
    };
    const layout = () => {
      const main = document.querySelector(".app[data-seasonal=winter] > .main");
      const elements = main ? Array.from(main.querySelectorAll<HTMLElement>(".home-balance-card,.card,[data-snow-surface]"))
        .filter((el) => !el.parentElement?.closest(".card,.home-balance-card,[data-snow-surface]")) : [];
      const navigation = document.querySelector<HTMLElement>(".bottomnav");
      if (navigation) elements.push(navigation);
      const old = surfaceCache.current;
      for (const element of decorated) if (!element.isConnected) { element.classList.remove("snow-bearing-surface"); decorated.delete(element); }
      const headerBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 70;
      const boxes = elements.filter(el => el !== navigation).slice(0, 16).concat(navigation ? [navigation] : []).map((element, index) => ({ element, box: element.getBoundingClientRect(),
        key: element === navigation ? "/winter|bottom-navigation" : `${location.pathname}|${element.dataset.snowKey || (element.classList.contains("home-balance-card") ? "home-balance" : `card-${index}`)}` }));
      surfaces.current = boxes.filter(({ box }) => box.width > 85 && box.height > 40).map(({ element, box, key }) => {
        const above = boxes.filter((other) => other.element !== element && other.box.bottom <= box.top + 1 && other.box.right > box.left && other.box.left < box.right);
        const gap = above.length ? box.top - Math.max(...above.map((other) => other.box.bottom)) : 30;
        let bank = old.get(element)?.bank ?? savedBanks.get(key);
        if (!bank) {
          bank = createDustedBank(Math.random());
        }
        savedBanks.delete(key); savedBanks.set(key, bank);
        if (savedBanks.size > 64) savedBanks.delete(savedBanks.keys().next().value!);
        element.classList.add("snow-bearing-surface"); decorated.add(element);
        const css = getComputedStyle(element);
        const surface = old.get(element) ?? { id: sequence.current++, element, bank, x: 0, y: 0, width: 0, limit: 17, visible: true, borderTop: 0, borderLeft: 0, navigation: element === navigation, releaseArmed: true, releaseAt: -Infinity };
        const positioned = { ...surface, x: box.left + 8, y: box.top, width: Math.max(1, box.width - 16), limit: element === navigation ? 8 : Math.max(3, Math.min(17, gap - 2)), visible: element === navigation || (box.top > headerBottom + 18 && box.top < height - 65),
          borderTop: parseFloat(css.borderTopWidth) || 0, borderLeft: parseFloat(css.borderLeftWidth) || 0 };
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
    const shed = (surface: Surface, spill: { left: number; right: number }, tilt: number) => {
      for (const side of [-1, 1]) {
        const area = spill[side < 0 ? "left" : "right"] * surface.width / 47;
        if (area < 18 || chunks.length >= 48) continue;
        chunks.push({ x: surface.x + (side < 0 ? -10 : surface.width + 10), y: surface.y - 2,
          vx: side * (12 + Math.abs(tilt) * 24), vy: 8, area, age: 0 });
      }
    };
    const frame = (time: number) => {
      if (previous && time - previous < 32) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(previous ? (time - previous) / 1000 : 0, .06); previous = time;
      const layoutChanged = dirty || time - layoutAt > 650;
      if (layoutChanged) { layout(); layoutAt = time; }
      const modal = !!document.querySelector("dialog[open]");
      const device = phone.current;
      const movement = device.data.current;
      if (!device.enabled || modal) { handledShake = movement.shakeAt; gustUntil = 0; }
      else if (Number.isFinite(movement.shakeAt) && movement.shakeAt !== handledShake) {
        handledShake = movement.shakeAt; gustUntil = time + 2400;
        for (const surface of surfaces.current) if (surface.visible && !surface.navigation)
          shed(surface, loosenBank(surface.bank, movement.wind, surface.width), movement.wind);
        // A temporary foreground layer makes a shake visible even in light snow.
        const extra = Math.min(70, Math.round(width / 8));
        for (let i = 0; i < extra && particles.length < 310; i++) particles.push({
          x: Math.random() * width, y: (i + Math.random()) / extra * height,
          speed: 45 + Math.random() * 65, radius: 1.2 + Math.random() * 2, phase: Math.random() * Math.PI * 2, settles: false, life: 2.4,
        });
        for (let i = 0; i < 30 && puffs.current.length < 90; i++) puffs.current.push({
          x: Math.random() * width, y: Math.random() * height, vx: (Math.random() - .5) * 240, vy: -45 - Math.random() * 90, life: .8 + Math.random() * .5,
        });
      }
      const gustStrength = Math.max(0, (gustUntil - time) / 2400);
      if ((gustStrength > 0) !== previousGust) { previousGust = gustStrength > 0; setGust(previousGust); }
      const phoneWind = device.enabled ? movement.wind * 38 : 0;
      ctx.clearRect(0, 0, width, height);
      if (!modal) {
        for (const surface of surfaces.current) {
          if (!surface.visible) continue;
          growBank(surface.bank, dt, snowfall);
          for (let i = 0; i < surface.bank.heights.length; i++) surface.bank.heights[i] = Math.min(surface.limit, surface.bank.heights[i]);
          if (device.enabled && !surface.navigation) {
            const tilt = movement.wind;
            if (Math.abs(tilt) < .18 && time - surface.releaseAt > 1600) surface.releaseArmed = true;
            if (surface.releaseArmed && Math.abs(tilt) > .45 && time - surface.releaseAt > 1600) {
              surface.releaseArmed = false; surface.releaseAt = time;
              shed(surface, loosenBank(surface.bank, tilt, surface.width, false), tilt);
            }
          }
        }
        for (let index = particles.length - 1; index >= 0; index--) {
          const p = particles[index];
          if (p.life !== undefined) { p.life -= dt; if (p.life <= 0) { particles.splice(index, 1); continue; } }
          const before = p.y;
          p.y += p.speed * SNOWFALL[snowfall].speed * (1 + gustStrength * 1.8) * dt;
          p.x += (Math.sin(time / 1600 + p.phase) * (13 * SNOWFALL[snowfall].drift + gustStrength * 130) + 5 + phoneWind + gustStrength * 55) * dt;
          const dx = p.x - pointerX, dy = p.y - pointerY, distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 65) { p.x += dx / distance * dt * 50; p.y += dy / distance * dt * 30; }
          for (const surface of surfaces.current) {
            if (!surface.visible) continue;
            if (p.x < surface.x || p.x > surface.x + surface.width) continue;
            const x = (p.x - surface.x) / surface.width;
            const edge = surface.y - surface.bank.heights[Math.round(x * 47)];
            if (before <= edge && p.y >= edge && (surface.navigation || p.settles)) {
              if (p.life === undefined) depositFlake(surface.bank, x, p.radius * .18);
              // The foreground layer remains free-falling; only a quarter catches on roofs.
              // Replenish captured flakes over the viewport to preserve lower-screen coverage.
              recycle(p, surface.navigation); break;
            }
          }
          if (p.y > height + 12) recycle(p);
          if (p.x < -15) p.x = width + 14; else if (p.x > width + 15) p.x = -14;
          ctx.globalAlpha = (.3 + p.radius * .17) * (p.life === undefined ? 1 : Math.min(1, p.life / .6)); ctx.fillStyle = "#f5fbff";
          ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = chunks.length - 1; i >= 0; i--) {
          const chunk = chunks[i], before = chunk.y;
          fallSnow(chunk, dt, device.enabled ? movement.wind : 0);
          for (const surface of surfaces.current) {
            if (!surface.visible || chunk.x < surface.x || chunk.x > surface.x + surface.width) continue;
            const x = (chunk.x - surface.x) / surface.width;
            const edge = surface.y - surface.bank.heights[Math.round(x * 47)];
            if (before <= edge && chunk.y >= edge) {
              chunk.area = landSnow(surface.bank, x, chunk.area, surface.width, surface.limit);
              break;
            }
          }
          if (chunk.area < .05 || chunk.y > height + 20 || chunk.x < -30 || chunk.x > width + 30 || chunk.age > 6) { chunks.splice(i, 1); continue; }
          ctx.globalAlpha = Math.min(1, Math.max(0, (6 - chunk.age) / .4)); ctx.fillStyle = "#f1faff";
          const radius = Math.max(1.2, Math.min(6, Math.sqrt(chunk.area / Math.PI)));
          ctx.beginPath(); ctx.ellipse(chunk.x, chunk.y, radius, radius * .8, chunk.age * .9, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(chunk.x - radius * .55, chunk.y + radius * .2, radius * .55, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(chunk.x + radius * .45, chunk.y - radius * .3, radius * .6, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = puffs.current.length - 1; i >= 0; i--) {
          const p = puffs.current[i]; p.life -= dt; p.vy += 110 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.life <= 0) { puffs.current.splice(i, 1); continue; }
          ctx.globalAlpha = p.life; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (layoutChanged || time - published > 80) {
        setCaps(surfaces.current.map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, path: bankPath(s.bank, s.width), opacity: snowOpacity(s.bank), element: s.element, borderTop: s.borderTop, borderLeft: s.borderLeft })));
        published = time;
      }
      if (time - savedAt > 2000) { persistence.current(); savedAt = time; }
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const visibility = () => { cancelAnimationFrame(raf); previous = 0; if (!document.hidden) { dirty = true; raf = requestAnimationFrame(frame); } else persistence.current(); };
    const save = () => persistence.current();
    resize(); layout(); visibility();
    window.addEventListener("resize", resize); window.addEventListener("scroll", mark, { passive: true, capture: true });
    window.addEventListener("pointermove", move, { passive: true }); window.addEventListener("pointerout", leave);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", save);
    return () => { observer.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); ctx.clearRect(0,0,width,height);
      window.removeEventListener("resize", resize); window.removeEventListener("scroll", mark, true); window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", save); persistence.current();
      for (const element of decorated) element.classList.remove("snow-bearing-surface"); };
  }, [motion, snowfall, savedBanks]);

  const sweep = (cap: Cap, clientX: number, whole = false) => {
    const surface = surfaces.current.find((s) => s.id === cap.id); if (!surface) return;
    const liveBox = surface.element.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - liveBox.left - 8) / Math.max(1, liveBox.width - 16)));
    const removed = whole ? surface.bank.heights.reduce((sum, h) => sum + h, 0) : brushBank(surface.bank, x, Math.max(.09, 40 / surface.width));
    if (whole) surface.bank.heights.fill(0);
    if (removed < .01) return;
    collectedFraction.current += removed / 6;
    const units = Math.floor(collectedFraction.current);
    if (units > 0) { collectedFraction.current -= units; collectSnow(units); if (WINTER_ACTIVITIES_ENABLED && workshop.snow < 15 && workshop.snow + units >= 15) setHint(true); }
    if (whole) audio.current.play("snow"); else audio.current.brushSnow(Math.min(1, .2 + removed / 5));
    for (let i = 0; i < 12 && puffs.current.length < 90; i++) puffs.current.push({ x: clientX, y: liveBox.top - 4, vx: (Math.random() - .5) * 120, vy: -20 - Math.random() * 65, life: .6 + Math.random() * .4 });
    if (whole) persistence.current();
    setCaps((old) => old.map((s) => s.id === cap.id ? { ...s, path: bankPath(surface.bank, surface.width), opacity: snowOpacity(surface.bank) } : s));
  };
  if (!motion || snowfall === "off") return null;
  return <>
  <div className={`snow-weather${gust ? " snow-weather--gust" : ""}`}>
    <span ref={scaleProbe} className="snow-scale-probe" aria-hidden="true" />
    <canvas className="seasonal-particles" ref={canvas} aria-hidden="true" />
    {caps.map((cap) => createPortal(<button key={cap.id} type="button" className="snowdrift" data-snow-id={cap.id} aria-label={t("appearance.snow.brush")} tabIndex={cap.opacity > .05 ? 0 : -1}
      style={{ left: 8 / overlay.scale - cap.borderLeft, top: -22 / overlay.scale - cap.borderTop,
        width: cap.width / overlay.scale, height: 28 / overlay.scale, opacity: cap.opacity }}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: cap.id, x: event.clientX }; sweep(cap, event.clientX); }}
      onPointerMove={(event) => { if (drag.current?.id !== cap.id) return; const from = drag.current.x; const steps = Math.max(1, Math.ceil(Math.abs(event.clientX - from) / 12));
        for (let i = 1; i <= steps; i++) sweep(cap, from + (event.clientX - from) * i / steps); drag.current.x = event.clientX; }}
      onPointerUp={() => { drag.current = null; audio.current.stopSnow(); persistence.current(); }} onPointerCancel={() => { drag.current = null; audio.current.stopSnow(); persistence.current(); }}
      onLostPointerCapture={() => audio.current.stopSnow()}
      onClick={(event) => { if (event.detail === 0) sweep(cap, cap.x + cap.width / 2, true); }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${cap.width} 28`} aria-hidden="true">
        <defs><linearGradient id={`${gradientId}-${cap.id}`} x2="0" y2="1"><stop offset="0%" stopColor="#fff" /><stop offset="55%" stopColor="#edf8ff" /><stop offset="100%" stopColor="#a9cddc" /></linearGradient></defs>
        <path d={cap.path} fill={`url(#${gradientId}-${cap.id})`} />
      </svg>
    </button>, cap.element, String(cap.id)))}
    {WINTER_ACTIVITIES_ENABLED && hint && settings.gamesEnabled && <button type="button" className="snow-discovery" onClick={() => { setHint(false); window.dispatchEvent(new Event("shpun-winter-discovery")); }}>
      <img src="/themes/icons/snowman.png" alt="" /><span>{t("appearance.snow.discovery")}</span>
    </button>}
  </div></>;
}

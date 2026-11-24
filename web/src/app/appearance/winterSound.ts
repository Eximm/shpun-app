import { useEffect, useRef, useState } from "react";
import { createSnowFoley } from "./snowFoley";

export type WinterSound = "bell" | "snow" | "roll" | "gift" | "melody";
const KEY = "shpun.winter.sound.v1";
export function useWinterSound() {
  const [enabled, updateEnabled] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const setEnabled = (value: boolean) => {
    updateEnabled(value);
    try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* optional */ }
    window.dispatchEvent(new CustomEvent("shpun-winter-sound", { detail: value }));
  };
  const context = useRef<AudioContext | null>(null);
  const friction = useRef<ReturnType<typeof createSnowFoley> | null>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  const last = useRef<Partial<Record<WinterSound, number>>>({});
  useEffect(() => {
    if (!enabled) { friction.current?.dispose(); friction.current = null; void context.current?.close(); context.current = null; }
  }, [enabled]);
  useEffect(() => {
    const sync = (event: Event) => updateEnabled(Boolean((event as CustomEvent).detail));
    const storage = (event: StorageEvent) => { if (event.key === KEY) updateEnabled(event.newValue === "1"); };
    window.addEventListener("shpun-winter-sound", sync); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("shpun-winter-sound", sync); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { friction.current?.dispose(); friction.current = null; void context.current?.close(); context.current = null; } };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); friction.current?.dispose(); friction.current = null; void context.current?.close(); context.current = null; };
  }, []);
  const brushSnow = (strength = .5, holdMs = 160, rolling = false) => {
    if (!allowed.current || document.hidden) return;
    try {
      const ctx = context.current ??= new AudioContext();
      // Schedule during the gesture; repeated moves only change the gain of
      // this one looping voice, even while resume() is still pending.
      friction.current ??= createSnowFoley(ctx);
      friction.current.stroke(strength, holdMs, rolling ? "roll" : "brush");
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
    } catch { /* cosmetic sound remains optional */ }
  };
  const stopSnow = () => friction.current?.release();
  const play = (kind: WinterSound, force = false) => {
    const cooldown = kind === "roll" ? 650 : kind === "snow" ? 400 : 100;
    if ((!enabled && !force) || document.hidden || performance.now() - (last.current[kind] ?? -Infinity) < cooldown) return;
    last.current[kind] = performance.now();
    if (kind === "snow" || kind === "roll") { brushSnow(kind === "roll" ? .7 : .35, kind === "roll" ? 420 : 120, kind === "roll"); return; }
    try {
      const ctx = context.current ??= new AudioContext();
      void ctx.resume().then(() => {
        if (context.current !== ctx || ctx.state !== "running" || document.hidden || (!allowed.current && !force)) return;
        const at = ctx.currentTime;
        // A short original bell phrase; no downloaded music or autoplay loop.
        const notes = kind === "melody" ? [784, 988, 1175, 988, 880, 1047, 1568] : kind === "gift" ? [659, 880, 1319] : [1175, 1568];
        notes.forEach((frequency, index) => {
          const start = at + index * (kind === "melody" ? .18 : .09);
          const oscillator = ctx.createOscillator(); oscillator.type = "sine"; oscillator.frequency.value = frequency;
          const gain = ctx.createGain(); gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.026, start + .008);
          gain.gain.exponentialRampToValueAtTime(.0001, start + .65);
          oscillator.connect(gain).connect(ctx.destination); oscillator.start(start); oscillator.stop(start + .7);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        });
      }).catch(() => {});
    } catch { /* audio is optional on unsupported devices */ }
  };
  return { enabled, setEnabled, play, brushSnow, stopSnow };
}

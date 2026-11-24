import { useEffect, useRef, useState } from "react";

export type WinterSound = "bell" | "snow" | "gift" | "melody";
const KEY = "shpun.winter.sound.v1";
export function useWinterSound() {
  const [enabled, updateEnabled] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const setEnabled = (value: boolean) => {
    updateEnabled(value);
    try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* optional */ }
    window.dispatchEvent(new CustomEvent("shpun-winter-sound", { detail: value }));
  };
  const context = useRef<AudioContext | null>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) void context.current?.suspend();
  }, [enabled]);
  useEffect(() => {
    const sync = (event: Event) => updateEnabled(Boolean((event as CustomEvent).detail));
    const storage = (event: StorageEvent) => { if (event.key === KEY) updateEnabled(event.newValue === "1"); };
    window.addEventListener("shpun-winter-sound", sync); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("shpun-winter-sound", sync); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) void context.current?.suspend(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); void context.current?.close(); context.current = null; };
  }, []);
  const play = (kind: WinterSound, force = false) => {
    if ((!enabled && !force) || document.hidden || performance.now() - last.current < 100) return;
    last.current = performance.now();
    try {
      const ctx = context.current ??= new AudioContext();
      void ctx.resume().then(() => {
        if (ctx.state !== "running" || document.hidden || (!allowed.current && !force)) return;
        const at = ctx.currentTime;
        if (kind === "snow") {
          const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .16), ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
          const source = ctx.createBufferSource(); source.buffer = buffer;
          const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1800;
          const volume = ctx.createGain(); volume.gain.value = .035;
          source.connect(filter).connect(volume).connect(ctx.destination); source.start();
          source.onended = () => { source.disconnect(); filter.disconnect(); volume.disconnect(); };
          return;
        }
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
  return { enabled, setEnabled, play };
}

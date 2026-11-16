import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../shared/api/client";

export type SeasonalTheme = "classic" | "neon" | "winter";
export type AppearanceSettings = { theme: SeasonalTheme; effectsEnabled: boolean; gamesEnabled: boolean };
const defaults: AppearanceSettings = { theme: "classic", effectsEnabled: true, gamesEnabled: true };
const DISABLED_KEY = "shpun.appearance.disabled.v1";
const MOTION_KEY = "shpun.appearance.motion.v1";
function readFlag(key: string) { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function writeFlag(key: string, value: boolean) { try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* session only */ } }

type AppearanceContextValue = {
  settings: AppearanceSettings;
  theme: SeasonalTheme;
  disabled: boolean;
  motion: boolean;
  reducedMotion: boolean;
  setDisabled: (value: boolean) => void;
  setMotion: (value: boolean) => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaults);
  const [disabled, setDisabledState] = useState(() => readFlag(DISABLED_KEY));
  const [motionOff, setMotionOff] = useState(() => readFlag(MOTION_KEY));
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const setDisabled = useCallback((value: boolean) => { writeFlag(DISABLED_KEY, value); setDisabledState(value); }, []);
  const setMotion = useCallback((value: boolean) => { writeFlag(MOTION_KEY, !value); setMotionOff(!value); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const result = await apiFetch<{ settings: AppearanceSettings }>("/appearance", { signal: controller.signal });
        if (!controller.signal.aborted && ["classic", "neon", "winter"].includes(result.settings?.theme)) setSettings(result.settings);
      } catch { /* keep the app usable if the optional appearance endpoint is unavailable */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("shpun-appearance-updated", refresh);
    document.addEventListener("visibilitychange", refresh);
    const sync = (event: StorageEvent) => {
      if (event.key === DISABLED_KEY || event.key === null) setDisabledState(readFlag(DISABLED_KEY));
      if (event.key === MOTION_KEY || event.key === null) setMotionOff(readFlag(MOTION_KEY));
    };
    window.addEventListener("storage", sync);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("shpun-appearance-updated", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", change);
    };
  }, []);
  const theme = disabled ? "classic" : settings.theme;
  return <AppearanceContext.Provider value={{ settings, theme, disabled, motion: settings.effectsEnabled && !motionOff && !reducedMotion,
    reducedMotion, setDisabled, setMotion }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppearanceProvider missing");
  return value;
}

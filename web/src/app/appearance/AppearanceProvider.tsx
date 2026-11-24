import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../shared/api/client";
import { SNOWMAN_COSTS, type Snowfall } from "./snowModel";
import { usePhoneSnow } from "./usePhoneSnow";

export type SeasonalTheme = "classic" | "winter";
export type AppearanceSettings = { theme: SeasonalTheme; effectsEnabled: boolean; gamesEnabled: boolean };
const defaults: AppearanceSettings = { theme: "classic", effectsEnabled: true, gamesEnabled: true };
const DISABLED_KEY = "shpun.appearance.disabled.v1";
const MOTION_KEY = "shpun.appearance.motion.v1";
const SNOW_KEY = "shpun.winter.snowfall.v1";
const WORKSHOP_KEY = "shpun.winter.snowman.v1";
function readSnowfall(): Snowfall { try { const value = localStorage.getItem(SNOW_KEY); return ["off", "light", "steady", "flurry"].includes(value || "") ? value as Snowfall : "steady"; } catch { return "steady"; } }
function readWorkshop() {
  try { const value = JSON.parse(localStorage.getItem(WORKSHOP_KEY) || "{}");
    return { snow: Math.max(0, Math.min(300, Number(value?.snow) || 0)), stage: [0,1,2,3].includes(value?.stage) ? Number(value.stage) : 0 }; }
  catch { return { snow: 0, stage: 0 }; }
}
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
  snowfall: Snowfall;
  setSnowfall: (value: Snowfall) => void;
  workshop: { snow: number; stage: number };
  collectSnow: (amount: number) => void;
  buildSnowman: () => void;
  resetSnowman: () => void;
  phoneSnow: ReturnType<typeof usePhoneSnow>;
  setPhoneSceneActive: (value: boolean) => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaults);
  const [phoneSceneActive, setPhoneSceneActive] = useState(false);
  const [snowfall, updateSnowfall] = useState(readSnowfall);
  const [workshop, setWorkshop] = useState(readWorkshop);
  const setSnowfall = useCallback((value: Snowfall) => { updateSnowfall(value); try { localStorage.setItem(SNOW_KEY, value); } catch { /* optional */ } }, []);
  const collectSnow = useCallback((amount: number) => { if (Number.isFinite(amount) && amount > 0) setWorkshop((old) => ({ ...old, snow: Math.min(300, old.snow + amount) })); }, []);
  const buildSnowman = useCallback(() => setWorkshop((old) => {
    const cost = SNOWMAN_COSTS[old.stage];
    return cost && old.snow >= cost ? { snow: old.snow - cost, stage: old.stage + 1 } : old;
  }), []);
  const resetSnowman = useCallback(() => setWorkshop((old) => ({ ...old, stage: 0 })), []);
  useEffect(() => { try { localStorage.setItem(WORKSHOP_KEY, JSON.stringify(workshop)); } catch { /* session only */ } }, [workshop]);
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
        if (!controller.signal.aborted && ["classic", "winter"].includes(result.settings?.theme)) setSettings(result.settings);
      } catch { /* keep the app usable if the optional appearance endpoint is unavailable */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("shpun-appearance-updated", refresh);
    document.addEventListener("visibilitychange", refresh);
    const sync = (event: StorageEvent) => {
      if (event.key === SNOW_KEY || event.key === null) updateSnowfall(readSnowfall());
      if (event.key === WORKSHOP_KEY || event.key === null) setWorkshop(readWorkshop());
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
  const motion = settings.effectsEnabled && !motionOff && !reducedMotion;
  const phoneSnow = usePhoneSnow(phoneSceneActive && theme === "winter" && motion && snowfall !== "off");
  return <AppearanceContext.Provider value={{ settings, theme, disabled, motion: settings.effectsEnabled && !motionOff && !reducedMotion,
    reducedMotion, setDisabled, setMotion, snowfall, setSnowfall, workshop, collectSnow, buildSnowman, resetSnowman, phoneSnow, setPhoneSceneActive }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppearanceProvider missing");
  return value;
}

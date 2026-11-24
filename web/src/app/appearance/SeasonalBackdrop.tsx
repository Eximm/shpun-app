import { useEffect, useRef } from "react";
import { useAppearance } from "./AppearanceProvider";
import { SnowWeather } from "./SnowWeather";

export function SeasonalBackdrop() {
  const { theme, motion } = useAppearance();
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!motion) return;
    const move = (event: PointerEvent) => {
      scene.current?.style.setProperty("--scene-x", `${(event.clientX / innerWidth - .5) * 7}px`);
      scene.current?.style.setProperty("--scene-y", `${(event.clientY / innerHeight - .5) * 5}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [motion]);
  if (theme === "classic") return null;
  return <>
    <div className="seasonal-backdrop" aria-hidden="true"><div ref={scene} className={`seasonal-scene seasonal-scene--winter${motion ? " seasonal-scene--moving" : ""}`} /></div>
    <SnowWeather />
  </>;
}

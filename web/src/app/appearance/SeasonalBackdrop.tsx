import { useEffect, useRef } from "react";
import { useAppearance } from "./AppearanceProvider";

type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number };

export function SeasonalBackdrop() {
  const { theme, motion } = useAppearance();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (theme === "classic" || !motion) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 0, height = 0, raf = 0, previous = 0;
    let pointerX = -1000, pointerY = -1000;
    const particles: Particle[] = [];
    const bursts: Particle[] = [];
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width; height = box.height;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles.length = 0;
      const count = Math.min(65, Math.floor(width / 12));
      for (let i = 0; i < count; i++) particles.push({ x: Math.random() * width, y: Math.random() * height,
        vx: Math.random() * 6 - 3, vy: theme === "winter" ? 12 + Math.random() * 22 : 3 + Math.random() * 9,
        life: 1, size: theme === "winter" ? 1 + Math.random() * 2 : .6 + Math.random() });
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const move = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointerX = event.clientX - box.left; pointerY = event.clientY - box.top;
      sceneRef.current?.style.setProperty("--scene-x", `${(pointerX / Math.max(width, 1) - .5) * 7}px`);
      sceneRef.current?.style.setProperty("--scene-y", `${(pointerY / Math.max(height, 1) - .5) * 5}px`);
    };
    const burst = (event: PointerEvent) => {
      if ((event.target as HTMLElement)?.closest("button,a,input,textarea,select,[role=dialog]")) return;
      const box = canvas.getBoundingClientRect();
      for (let i = 0; i < 12 && bursts.length < 60; i++) bursts.push({ x: event.clientX - box.left, y: event.clientY - box.top,
        vx: Math.cos(i / 12 * Math.PI * 2) * 55, vy: Math.sin(i / 12 * Math.PI * 2) * 55, life: 1, size: 2 });
    };
    const paint = (time: number) => {
      if (previous && time - previous < 33) { raf = requestAnimationFrame(paint); return; }
      const dt = Math.min((time - previous) / 1000 || 0, .05); previous = time;
      context.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y += p.vy * dt; p.x += p.vx * dt;
        if (theme === "winter") {
          const dx = p.x - pointerX, dy = p.y - pointerY, distance = Math.hypot(dx, dy);
          if (distance < 70 && distance > 0) { p.x += dx / distance * dt * 80; p.y += dy / distance * dt * 60; }
        }
        if (p.y > height + 15) { p.y = -15; p.x = Math.random() * width; }
        if (p.x < -15) p.x = width + 15;
        context.globalAlpha = theme === "winter" ? .5 : .3;
        context.fillStyle = theme === "winter" ? "#f3f6ff" : "#ffd9a7";
        context.beginPath();
        context.arc(p.x, p.y, p.size, 0, Math.PI * 2); context.fill();
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const p = bursts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.life <= 0) { bursts.splice(i, 1); continue; }
        context.globalAlpha = p.life; context.fillStyle = theme === "winter" ? "#ffe7a9" : "#f182d9";
        context.beginPath(); context.arc(p.x, p.y, p.size, 0, Math.PI * 2); context.fill();
      }
      if (!document.hidden) raf = requestAnimationFrame(paint);
    };
    const visibility = () => { cancelAnimationFrame(raf); previous = 0; if (!document.hidden) raf = requestAnimationFrame(paint); };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", burst, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    resize(); visibility();
    return () => { observer.disconnect(); cancelAnimationFrame(raf); window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", burst); document.removeEventListener("visibilitychange", visibility); };
  }, [theme, motion]);
  if (theme === "classic") return null;
  return <div className="seasonal-backdrop" aria-hidden="true">
    <div ref={sceneRef} className={`seasonal-scene seasonal-scene--${theme}${motion ? " seasonal-scene--moving" : ""}`} />
    {motion && <canvas ref={canvasRef} className="seasonal-particles" />}
  </div>;
}

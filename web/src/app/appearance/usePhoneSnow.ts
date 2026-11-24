import { useCallback, useEffect, useRef, useState } from "react";
import { motionVector, normalizeMotion, usesAppleMotionConvention, newPhoneSnowState, updatePhoneSnow } from "./phoneSnowModel";

const KEY = "shpun.winter.phone-motion.v1";
type MotionPermission = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
function sensor() { return typeof DeviceMotionEvent === "undefined" ? null : DeviceMotionEvent as MotionPermission; }
function screenAngle() { return screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0; }
function preferred() { const automatic = !sensor()?.requestPermission; try { const saved = localStorage.getItem(KEY); return saved === null ? automatic : saved === "1"; } catch { return automatic; } }
function remember(value: boolean) { try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* session only */ } }
export function usePhoneSnow(allowed: boolean) {
  const supported = !!sensor() && window.isSecureContext && navigator.maxTouchPoints > 0;
  const [enabled, setEnabled] = useState(() => supported && preferred());
  const [status, setStatus] = useState<"idle" | "asking" | "active" | "denied" | "unavailable">("idle");
  const data = useRef(newPhoneSnowState());
  const mounted = useRef(true), requestId = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++; }; }, []);
  const toggle = useCallback(async (value: boolean) => {
    const id = ++requestId.current;
    if (!value) { setEnabled(false); setStatus("idle"); remember(false); data.current = newPhoneSnowState(); return; }
    if (!supported || !allowed) return;
    const api = sensor(); setStatus("asking");
    try {
      if (api?.requestPermission && await api.requestPermission() !== "granted") {
        if (mounted.current && id === requestId.current) { setStatus("denied"); setEnabled(false); remember(false); } return;
      }
      if (mounted.current && id === requestId.current) { setEnabled(true); setStatus("active"); remember(true); }
    } catch { if (mounted.current && id === requestId.current) { setStatus("denied"); setEnabled(false); remember(false); } }
  }, [supported, allowed]);
  useEffect(() => {
    if (!enabled || !allowed || !supported) { data.current = newPhoneSnowState(); return; }
    let received = false, attached = false;
    const appleMotion = usesAppleMotionConvention(navigator);
    const sample = (event: DeviceMotionEvent) => {
      if (document.hidden) return;
      const gravity = normalizeMotion(motionVector(event.accelerationIncludingGravity), appleMotion), acceleration = normalizeMotion(motionVector(event.acceleration), appleMotion);
      if (!gravity && !acceleration) return;
      received = true;
      data.current = updatePhoneSnow(data.current, gravity, acceleration, performance.now(), screenAngle());
    };
    const reset = () => { data.current = newPhoneSnowState(); };
    const rotate = () => {
      const state = data.current;
      data.current = { ...state, gravity: null, impulse: null, lastAt: -Infinity };
    };
    const visibility = () => {
      reset();
      if (document.hidden && attached) { window.removeEventListener("devicemotion", sample); attached = false; }
      else if (!document.hidden && !attached) { window.addEventListener("devicemotion", sample, { passive: true }); attached = true; }
    };
    visibility(); setStatus("active");
    const check = setTimeout(() => {
      if (!received && !document.hidden) { setEnabled(false); setStatus("unavailable"); }
    }, 7000);
    document.addEventListener("visibilitychange", visibility); screen.orientation?.addEventListener("change", rotate); window.addEventListener("orientationchange", rotate);
    return () => { clearTimeout(check); window.removeEventListener("devicemotion", sample); document.removeEventListener("visibilitychange", visibility);
      screen.orientation?.removeEventListener("change", rotate); window.removeEventListener("orientationchange", rotate); reset(); };
  }, [enabled, allowed, supported]);
  return { supported, enabled: enabled && allowed, status, toggle, data };
}

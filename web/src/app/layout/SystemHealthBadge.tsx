// web/src/app/layout/SystemHealthBadge.tsx
//
// Compact public system-health indicator for the app header.
//
// Uses ONLY `/api/health` — a public-safe, aggregated endpoint. It never calls
// admin endpoints and never receives hostnames, IPs, exporter URLs or raw
// metrics. The admin bell and this badge intentionally use different APIs and
// different permission models.

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { useMe } from "../auth/useMe";

type SystemHealthStatus = "ok" | "degraded" | "down" | "unknown";

function isStatus(value: unknown): value is SystemHealthStatus {
  return value === "ok" || value === "degraded" || value === "down" || value === "unknown";
}

export function SystemHealthBadge() {
  const { t, formatDate } = useI18n();
  const { me } = useMe();
  const [status, setStatus] = useState<SystemHealthStatus>("unknown");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const enabled = Boolean(me);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      try {
        const response = await apiFetch<{ ok: true; status?: string; updatedAt?: string | null }>("/health", { method: "GET" });
        if (cancelled) return;
        setStatus(isStatus(response.status) ? response.status : "unknown");
        setUpdatedAt(response.updatedAt ?? null);
      } catch {
        if (!cancelled) setStatus("unknown");
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: PointerEvent) => {
      const el = wrapRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;

  const safeStatus: SystemHealthStatus = status === "ok" || status === "degraded" || status === "down" ? status : "unknown";
  const label = t(`system_health.${safeStatus}`);
  const shortLabel = t(`system_health.short.${safeStatus}`);
  const updatedText = (() => {
    if (!updatedAt) return null;
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return t("system_health.updated", { time: formatDate(date, { hour: "2-digit", minute: "2-digit" }) });
  })();

  return (
    <div className="healthBadgeWrap" ref={wrapRef}>
      <button
        type="button"
        className={`healthBadge healthBadge--${safeStatus}`}
        aria-label={`${t("system_health.aria")}: ${label}`}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="healthBadge__dot" aria-hidden="true" />
        <span className="healthBadge__full">{label}</span>
        <span className="healthBadge__short">{shortLabel}</span>
      </button>

      {open && (
        <div className="healthBadgePopover" role="status">
          <div className={`healthBadgePopover__title healthBadgePopover__title--${safeStatus}`}>
            <span className="healthBadge__dot" aria-hidden="true" />
            {label}
          </div>
          <div className="healthBadgePopover__text">{t(`system_health.popover.${safeStatus}`)}</div>
          {updatedText && <div className="healthBadgePopover__meta">{updatedText}</div>}
        </div>
      )}
    </div>
  );
}
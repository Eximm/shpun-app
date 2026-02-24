import React, { useEffect, useRef, useState } from "react";
import { toastStore } from "./toast";
import type { ToastItem } from "./toast";
import "./toast.css";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  // timers + pause/resume bookkeeping
  const timers = useRef<Record<string, number>>({});
  const remaining = useRef<Record<string, number>>({});
  const startedAt = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsub = toastStore.subscribe(setItems);
    return () => unsub();
  }, []);

  useEffect(() => {
    // start timers for newly added toasts
    for (const t of items) {
      if (timers.current[t.id]) continue;

      remaining.current[t.id] = t.durationMs;
      startedAt.current[t.id] = Date.now();

      timers.current[t.id] = window.setTimeout(() => {
        toastStore.remove(t.id);
        cleanup(t.id);
      }, t.durationMs);
    }

    // cleanup timers for removed toasts
    const ids = new Set(items.map(i => i.id));
    for (const id of Object.keys(timers.current)) {
      if (!ids.has(id)) cleanup(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function cleanup(id: string) {
    const timer = timers.current[id];
    if (timer) clearTimeout(timer);
    delete timers.current[id];
    delete remaining.current[id];
    delete startedAt.current[id];
  }

  function close(id: string) {
    toastStore.remove(id);
    cleanup(id);
  }

  function pause(id: string) {
    const timer = timers.current[id];
    if (!timer) return;

    const start = startedAt.current[id] ?? Date.now();
    const elapsed = Date.now() - start;
    remaining.current[id] = Math.max(0, (remaining.current[id] ?? 0) - elapsed);

    clearTimeout(timer);
    delete timers.current[id];
  }

  function resume(id: string) {
    if (timers.current[id]) return;

    const ms = remaining.current[id] ?? 0;
    if (ms <= 0) {
      close(id);
      return;
    }

    startedAt.current[id] = Date.now();
    timers.current[id] = window.setTimeout(() => {
      toastStore.remove(id);
      cleanup(id);
    }, ms);
  }

  return (
    <>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions removals">
        {items.map(t => (
          <div
            key={t.id}
            className={`toast-card toast-${t.variant}`}
            role="status"
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
          >
            <div className="toast-bar" />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.description ? <div className="toast-desc">{t.description}</div> : null}
            </div>
            <button className="toast-close" onClick={() => close(t.id)} aria-label="Закрыть">
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
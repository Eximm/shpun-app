// web/src/app/layout/FloatingSupport.tsx
//
// Compact, draggable floating support FAB for authenticated users.
//
//  - fixed, only an icon (no permanent label); title/aria-label = "Поддержка"
//  - draggable with mouse and touch, clamped to the viewport (safe-area aware)
//  - position persisted in localStorage as normalized coordinates
//  - long-press / right-click opens a small menu:
//      "Открыть поддержку" / "Скрыть до конца сессии"
//  - session hide persisted in sessionStorage
//  - yields while the referral nudge toast is visible (existing toast store)

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { toastStore } from "../../shared/ui/toast";

const HIDDEN_PREFIXES = ["/support", "/admin", "/login", "/legal"];
const FAB_SIZE = 48;
const MARGIN = 12;
const NAV_H = 74;
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 500;
const POS_KEY = "supportFab.pos.v1";
const HIDDEN_KEY = "supportFab.hidden.v1";

type Pos = { x: number; y: number };
type Normalized = { nx: number; ny: number };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function safeInset(side: "top" | "right" | "bottom" | "left"): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`).trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function bounds() {
  const safeTop = safeInset("top");
  const safeRight = safeInset("right");
  const safeBottom = safeInset("bottom");
  const safeLeft = safeInset("left");

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const minX = MARGIN + safeLeft;
  const maxX = Math.max(minX, vw - FAB_SIZE - MARGIN - safeRight);
  const minY = MARGIN + safeTop;
  const maxY = Math.max(minY, vh - NAV_H - Math.max(MARGIN, safeBottom) - FAB_SIZE);

  return { minX, maxX, minY, maxY };
}

function readSavedPos(): Normalized | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const nx = Number(parsed?.nx);
    const ny = Number(parsed?.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    return { nx: clamp01(nx), ny: clamp01(ny) };
  } catch {
    return null;
  }
}

function computePosition(saved: Normalized | null): Pos {
  const b = bounds();
  const nx = saved ? clamp01(saved.nx) : 1;
  const ny = saved ? clamp01(saved.ny) : 1;
  return {
    x: b.minX + nx * (b.maxX - b.minX),
    y: b.minY + ny * (b.maxY - b.minY),
  };
}

function clampPosition(x: number, y: number): Pos {
  const b = bounds();
  return {
    x: Math.min(Math.max(x, b.minX), b.maxX),
    y: Math.min(Math.max(y, b.minY), b.maxY),
  };
}

function saveNormalized(pos: Pos): void {
  const b = bounds();
  const nx = b.maxX > b.minX ? (pos.x - b.minX) / (b.maxX - b.minX) : 0;
  const ny = b.maxY > b.minY ? (pos.y - b.minY) / (b.maxY - b.minY) : 0;
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ nx: clamp01(nx), ny: clamp01(ny) }));
  } catch {
    // ignore
  }
}

function readSessionHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function SupportIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H11l-5 4v-4.3A3.5 3.5 0 0 1 5 12V6.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 8.5h6M9 11.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function isHiddenRoute(pathname: string): boolean {
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function FloatingSupport() {
  const { me } = useMe();
  const loc = useLocation();
  const navigate = useNavigate();

  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [sessionHidden, setSessionHidden] = useState<boolean>(() => readSessionHidden());
  const [pos, setPos] = useState<Pos>(() => computePosition(readSavedPos()));
  const [menuOpen, setMenuOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Pos>(pos);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const longPressRef = useRef<number | null>(null);

  // Referral nudge visibility comes from the existing toast store.
  useEffect(() => {
    const unsubscribe = toastStore.subscribe((items) => {
      setNudgeVisible(items.some((item) => item.origin === "referral"));
    });
    return unsubscribe;
  }, []);

  // Keep the FAB inside the viewport on resize/orientation change.
  const reposition = useCallback(() => {
    const next = computePosition(readSavedPos());
    posRef.current = next;
    setPos(next);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", reposition);
    window.addEventListener("orientationchange", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("orientationchange", reposition);
    };
  }, [reposition]);

  // Close the context menu on outside interaction / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (event: PointerEvent) => {
      const el = wrapRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
  }, []);

  function clearLongPress() {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (menuOpen) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: rect.left,
      baseY: rect.top,
      moved: false,
      pointerId: event.pointerId,
    };
    movedRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      if (!movedRef.current) {
        suppressClickRef.current = true;
        setMenuOpen(true);
      }
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    drag.moved = true;
    movedRef.current = true;
    clearLongPress();

    const next = clampPosition(drag.baseX + dx, drag.baseY + dy);
    posRef.current = next;
    setPos(next);
    event.preventDefault();
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    clearLongPress();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    dragRef.current = null;

    if (drag?.moved) {
      suppressClickRef.current = true;
      saveNormalized(posRef.current);
      // Allow the next real click after this one is swallowed.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function onContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    clearLongPress();
    suppressClickRef.current = true;
    setMenuOpen(true);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function onClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (menuOpen) return;
    navigate("/support");
  }

  function hideForSession() {
    try {
      sessionStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // ignore
    }
    setSessionHidden(true);
    setMenuOpen(false);
  }

  if (!me) return null;
  if (isHiddenRoute(loc.pathname)) return null;

  const hidden = sessionHidden || nudgeVisible;
  // Priority: session hidden > referral toast hidden > visible.
  const menuBelow = pos.y < 150;
  const menuLeft = pos.x > window.innerWidth / 2;

  return (
    <div
      ref={wrapRef}
      className={`floatingSupportWrap${hidden ? " floatingSupportWrap--hidden" : ""}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {menuOpen && (
        <div
          className={`floatingSupportMenu${menuBelow ? " floatingSupportMenu--below" : ""}${menuLeft ? "" : " floatingSupportMenu--left"}`}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className="floatingSupportMenu__item"
            onClick={() => { setMenuOpen(false); navigate("/support"); }}
          >
            Открыть поддержку
          </button>
          <button
            type="button"
            role="menuitem"
            className="floatingSupportMenu__item floatingSupportMenu__item--danger"
            onClick={hideForSession}
          >
            Скрыть до конца сессии
          </button>
        </div>
      )}

      <button
        type="button"
        className="floatingSupport"
        aria-label="Поддержка"
        title="Поддержка"
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : 0}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={onContextMenu}
      >
        <SupportIcon />
      </button>
    </div>
  );
}
// web/src/app/layout/FloatingSupport.tsx
//
// Compact, draggable floating support FAB for authenticated users.
//
//  - fixed, icon only (title/aria-label = "Поддержка")
//  - draggable with mouse and touch, clamped to the VIEWPORT
//  - position persisted in localStorage as normalized visual coordinates
//  - long-press / right-click opens a menu: "Открыть поддержку" / "Скрыть до конца сессии"
//  - session hide in sessionStorage
//  - yields while the referral nudge toast is visible
//
// IMPORTANT: the app sets `body { zoom: var(--ui-scale) }` (0.87 / 0.92 / 1).
// Inside a zoomed subtree, CSS `left/top` are rendered scaled, while
// `window.innerWidth/Height` and pointer client coordinates are in visual
// (unzoomed) viewport pixels. We therefore compute all bounds/positions in
// VISUAL pixels and divide by the measured effective scale only when writing
// `left/top`. This keeps the drag range and the stored normalized position
// independent of the UI scale.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { toastStore } from "../../shared/ui/toast";

const HIDDEN_PREFIXES = ["/support", "/admin", "/login", "/legal"];
const FAB_SIZE = 48;
const MARGIN = 12;
const NAV_H = 74; // fallback if .bottomnav cannot be measured
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 500;
const POS_KEY = "supportFab.pos.v1";
const HIDDEN_KEY = "supportFab.hidden.v1";

type Pos = { x: number; y: number }; // visual (unzoomed) viewport px
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

/**
 * Effective visual scale of the (possibly zoomed) page.
 * A 100px probe is measured via getBoundingClientRect: under `body { zoom }`
 * it returns 100 * scale, so we can convert between CSS and visual pixels.
 */
let scaleProbe: HTMLDivElement | null = null;
function effectiveScale(): number {
  try {
    if (!scaleProbe || !scaleProbe.isConnected) {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:100px;height:1px;pointer-events:none;visibility:hidden;";
      document.body.appendChild(probe);
      scaleProbe = probe;
    }
    const w = scaleProbe.getBoundingClientRect().width;
    const s = w > 0 ? w / 100 : 1;
    return Number.isFinite(s) && s > 0 ? s : 1;
  } catch {
    return 1;
  }
}

function bottomNavHeight(scale: number): number {
  try {
    const nav = document.querySelector(".bottomnav");
    const h = nav ? nav.getBoundingClientRect().height : 0;
    return h > 0 ? h : NAV_H * scale;
  } catch {
    return NAV_H * scale;
  }
}

/** Allowed visual viewport area for the FAB (safe-area aware, above bottom nav). */
function bounds(scale: number) {
  const s = scale > 0 ? scale : 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const margin = MARGIN * s;
  const fab = FAB_SIZE * s;
  const safeTop = safeInset("top") * s;
  const safeRight = safeInset("right") * s;
  const safeBottom = safeInset("bottom") * s;
  const safeLeft = safeInset("left") * s;
  const navH = bottomNavHeight(s);

  const minX = safeLeft + margin;
  const maxX = Math.max(minX, vw - safeRight - margin - fab);
  const minY = safeTop + margin;
  const maxY = Math.max(minY, vh - navH - safeBottom - margin - fab);

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

function computePosition(saved: Normalized | null, scale: number): Pos {
  const b = bounds(scale);
  const nx = saved ? clamp01(saved.nx) : 1;
  const ny = saved ? clamp01(saved.ny) : 1;
  return {
    x: b.minX + nx * (b.maxX - b.minX),
    y: b.minY + ny * (b.maxY - b.minY),
  };
}

function clampPosition(x: number, y: number, scale: number): Pos {
  const b = bounds(scale);
  return {
    x: Math.min(Math.max(x, b.minX), b.maxX),
    y: Math.min(Math.max(y, b.minY), b.maxY),
  };
}

function saveNormalized(pos: Pos, scale: number): void {
  const b = bounds(scale);
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
  const [{ scale: initScale, pos: initPos }] = useState(() => {
    const s = effectiveScale();
    return { scale: s, pos: computePosition(readSavedPos(), s) };
  });
  const [scale, setScale] = useState(initScale);
  const [pos, setPos] = useState<Pos | null>(initPos);
  const [menuOpen, setMenuOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Pos | null>(initPos);
  const scaleRef = useRef(initScale);
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

  // Recompute scale + position (initial and on viewport changes).
  const reposition = useCallback(() => {
    const nextScale = effectiveScale();
    const nextPos = computePosition(readSavedPos(), nextScale);
    scaleRef.current = nextScale;
    posRef.current = nextPos;
    setScale(nextScale);
    setPos(nextPos);
  }, []);

  useEffect(() => {
    const onResize = () => reposition();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
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

    const next = clampPosition(drag.baseX + dx, drag.baseY + dy, scaleRef.current);
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

    if (drag?.moved && posRef.current) {
      suppressClickRef.current = true;
      saveNormalized(posRef.current, scaleRef.current);
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
  const safeScale = scale > 0 ? scale : 1;
  const menuBelow = pos ? pos.y < 150 : false;
  const menuLeft = pos ? pos.x > window.innerWidth / 2 : true;

  return (
    <div
      ref={wrapRef}
      className={`floatingSupportWrap${hidden ? " floatingSupportWrap--hidden" : ""}`}
      style={{
        left: pos ? pos.x / safeScale : 0,
        top: pos ? pos.y / safeScale : 0,
        visibility: pos ? undefined : "hidden",
      }}
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
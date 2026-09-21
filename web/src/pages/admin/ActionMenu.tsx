// web/src/pages/admin/ActionMenu.tsx
//
// Viewport-aware action menu rendered in a portal, so it can never be clipped
// by card overflow. Anchored to the trigger button, flips above near the bottom
// edge and clamps to the viewport on the right.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ActionMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

const MENU_W = 184;
const MENU_H = 96;
const MARGIN = 8;

export function ActionMenu({
  anchorEl,
  open,
  onClose,
  items,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  items: ActionMenuItem[];
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - MENU_W - MARGIN, Math.max(MARGIN, r.right - MENU_W));
    let top = r.bottom + 6;
    if (top + MENU_H > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, r.top - MENU_H - 6);
    }
    setPos({ top, left });
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (anchorEl?.contains(ev.target as Node)) return;
      if (menuRef.current?.contains(ev.target as Node)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorEl, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="mon-actionMenu"
      role="menu"
      style={{ top: pos.top, left: pos.left, width: MENU_W }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`mon-actionMenu__item${item.danger ? " is-danger" : ""}`}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
// web/src/app/layout/FloatingSupport.tsx
//
// Floating support launcher for authenticated users.
// Fixed bottom-right, above the bottom navigation, hidden inside the support
// screen, admin pages and public/auth pages.
//
// While the referral nudge is visible it yields (the two never compete for the
// same floating slot). Nudge visibility is read from the existing toast store
// (the nudge presents itself as a toast tagged `origin: "referral"`), so no
// duplicated state is introduced.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { toastStore } from "../../shared/ui/toast";

// Routes where the launcher must not appear.
const HIDDEN_PREFIXES = ["/support", "/admin", "/login", "/legal"];

function SupportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function isHidden(pathname: string): boolean {
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function FloatingSupport() {
  const { me } = useMe();
  const loc = useLocation();
  const navigate = useNavigate();
  const [nudgeVisible, setNudgeVisible] = useState(false);

  // Reuse the existing toast store as the single source of "nudge is visible".
  useEffect(() => {
    const unsubscribe = toastStore.subscribe((items) => {
      setNudgeVisible(items.some((item) => item.origin === "referral"));
    });
    return unsubscribe;
  }, []);

  // Only authenticated users see the launcher.
  if (!me) return null;
  if (isHidden(loc.pathname)) return null;

  return (
    <button
      type="button"
      className={`floatingSupport${nudgeVisible ? " floatingSupport--hidden" : ""}`}
      aria-label="Поддержка"
      title="Поддержка"
      aria-hidden={nudgeVisible || undefined}
      tabIndex={nudgeVisible ? -1 : 0}
      onClick={() => navigate("/support")}
    >
      <SupportIcon />
      <span className="floatingSupport__label">Поддержка</span>
    </button>
  );
}
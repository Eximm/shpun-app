// web/src/app/layout/SupportBell.tsx
//
// Compact admin notification bell for support unread events.
// Hidden for non-admins. Clicking opens the admin support tab.

import { useNavigate } from "react-router-dom";
import { useMe } from "../auth/useMe";
import { useSupportUnread } from "../notifications/supportUnread";
import { useI18n } from "../../shared/i18n";

function BellIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function SupportBell() {
  const { me } = useMe();
  const { t, tp } = useI18n();
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const { total: count } = useSupportUnread(isAdmin);
  const navigate = useNavigate();

  if (!isAdmin) return null;

  const label = count > 0 ? tp("support.bell.unread", count) : t("support.title");

  return (
    <button
      className="topbar__bell"
      type="button"
      aria-label={label}
      title={t("support.bell.title")}
      onClick={() => navigate("/admin?tab=support")}
    >
      <BellIcon />
      {count > 0 && <span className="topbar__bellBadge">{count > 99 ? "99+" : count}</span>}
    </button>
  );
}
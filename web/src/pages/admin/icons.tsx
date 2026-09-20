// web/src/pages/admin/icons.tsx
//
// Canonical admin icon system.
//
// One outline set, one style contract:
//   viewBox 0 0 24 24, fill none, stroke currentColor,
//   strokeWidth 1.75, round caps/joins, decorative (aria-hidden).
//
// One entity -> one icon everywhere (sidebar, mobile picker, overview cards,
// recent activity, section headers). No emoji as system admin icons.
//
// The project has no icon package installed; this registry keeps the icon
// language centralized so a future swap (e.g. Lucide) touches one file.

import type { AdminNavIconName } from "./adminIconMap";

export type { AdminNavIconName } from "./adminIconMap";

const STROKE = 1.75;

export function AdminSectionIcon({ name, size = 18 }: { name: AdminNavIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="9" rx="1.8" />
          <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.8" />
          <rect x="13.5" y="12" width="7.5" height="9" rx="1.8" />
          <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.8" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M12 3.6l2.6 5.2 5.7.8-4.1 4 1 5.7-5.2-2.7-5.2 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z" />
        </svg>
      );
    case "megaphone":
      return (
        <svg {...common}>
          <path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l4.5 3.5V5L7 8.5H5.5A1.5 1.5 0 0 0 4 10.5Z" />
          <path d="M15.5 9a4.5 4.5 0 0 1 0 6" />
          <path d="M18 6.5a8 8 0 0 1 0 11" opacity="0.6" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <path d="M4 5h2l1.6 9.2a1 1 0 0 0 1 .8h7.9a1 1 0 0 0 1-.8L19 7H7" />
          <circle cx="9.5" cy="19" r="1.4" />
          <circle cx="17" cy="19" r="1.4" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 3.5 20 8l-8 4.5L4 8l8-4.5Z" />
          <path d="M4 12l8 4.5 8-4.5" opacity="0.75" />
          <path d="M4 16l8 4.5 8-4.5" opacity="0.5" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <circle cx="6.5" cy="12" r="2.5" />
          <circle cx="17.5" cy="6" r="2.5" />
          <circle cx="17.5" cy="18" r="2.5" />
          <path d="M8.7 10.8l6.6-3.3M8.7 13.2l6.6 3.3" />
        </svg>
      );
    case "lifebuoy":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="3.4" />
          <path d="M12 3.5v5.1M12 15.4v5.1M3.5 12h5.1M15.4 12h5.1" />
        </svg>
      );
    case "server":
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="6" rx="2" />
          <rect x="3.5" y="14" width="17" height="6" rx="2" />
          <path d="M7.5 7h.01M7.5 17h.01" />
          <path d="M12 7h5M12 17h5" opacity="0.7" />
        </svg>
      );
    case "handshake":
      return (
        <svg {...common}>
          <path d="M8 12.5l2.4 2.4a1.4 1.4 0 0 0 2 0l1.2-1.2" />
          <path d="M3.5 10.5l3-3 5.5 5.5" />
          <path d="M20.5 10.5l-3-3-2.2 2.2 2.7 2.7a1.4 1.4 0 0 1-2 2l-1-1" />
          <path d="M12 13l-1.2 1.2" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.2-6 3.6 12L15 12h6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      );
    case "userPlus":
      return (
        <svg {...common}>
          <circle cx="10" cy="8" r="3.6" />
          <path d="M4 20a6 6 0 0 1 12 0" />
          <path d="M18.5 8v5M16 10.5h5" />
        </svg>
      );
    case "package":
      return (
        <svg {...common}>
          <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
          <path d="M4 8l8 4.5L20 8" />
          <path d="M12 12.5V20" opacity="0.7" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2.4" />
          <path d="M3 10h18" />
          <path d="M7 14.5h4" opacity="0.8" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-.6 4.5" />
          <path d="M20 6v5h-5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 4.5 21 19.5H3L12 4.5Z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    default:
      return null;
  }
}
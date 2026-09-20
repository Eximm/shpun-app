// web/src/pages/admin/adminIconMap.ts
//
// Canonical admin "entity -> icon" mapping (pure, no React).
// Kept separate from the icon component so react-refresh stays happy and the
// mapping can be statically tested.

import type { AdminTab } from "./types";

export type AdminNavIconName =
  | "dashboard"
  | "star"
  | "megaphone"
  | "cart"
  | "shield"
  | "layers"
  | "share"
  | "lifebuoy"
  | "server"
  | "handshake"
  | "activity"
  | "clock"
  | "userPlus"
  | "package"
  | "card"
  | "refresh"
  | "check"
  | "alert";

/** Canonical section -> icon mapping (single entity, single icon). */
export const ADMIN_SECTION_ICON: Record<AdminTab, AdminNavIconName> = {
  overview: "dashboard",
  reviews: "star",
  broadcasts: "megaphone",
  orderRules: "cart",
  trialProtection: "shield",
  serviceCategories: "layers",
  referralAliases: "share",
  support: "lifebuoy",
  serverStatus: "server",
};

/** Icon for a recent-activity event type. */
export function activityIconName(type: string): AdminNavIconName {
  switch (type) {
    case "support.ticket":        return "lifebuoy";
    case "partnership.ticket":    return "handshake";
    case "review.new":            return "star";
    case "referral.registration": return "share";
    default:                      return "activity";
  }
}
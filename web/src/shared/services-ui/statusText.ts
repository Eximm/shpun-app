// web/src/shared/services-ui/statusText.ts

import { tGlobal } from "../i18n/runtime";

export type UiStatus = "active" | "blocked" | "pending" | "not_paid" | "removed" | "error" | "init";

const STATUS_KEYS: Record<UiStatus, string> = {
  active: "services.status.active",
  pending: "services.status.pending",
  not_paid: "services.status.not_paid",
  blocked: "services.status.blocked",
  removed: "services.status.removed",
  error: "services.status.error",
  init: "services.status.init",
};

export function statusLabel(s: UiStatus) {
  return tGlobal(STATUS_KEYS[s] ?? "services.status.default");
}

export function statusTone(s: UiStatus): "ok" | "warn" | "danger" | "default" {
  switch (s) {
    case "active":
      return "ok";
    case "pending":
      return "default";
    case "not_paid":
      return "warn";
    case "blocked":
    case "error":
      return "danger";
    case "removed":
      return "default";
    default:
      return "default";
  }
}
export type UiStatus = "active" | "blocked" | "pending" | "not_paid" | "removed" | "error" | "init";

export function statusLabel(s: UiStatus) {
  switch (s) {
    case "active":
      return "Активна";
    case "pending":
      return "Активируется";
    case "not_paid":
      return "Не оплачена";
    case "blocked":
      return "Заблокирована";
    case "removed":
      return "Удалена";
    case "error":
      return "Ошибка";
    case "init":
    default:
      return "…";
  }
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
// FILE: api/src/modules/notifications/format.ts
import type { BillingPushEvent } from "./inbox.js";

type Level = "info" | "success" | "error";

/**
 * Helpers
 */
function compact(s: string, max = 220) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function rub(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${Math.trunc(n)} ₽`;
}

function pick(obj: any, path: string): any {
  try {
    return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
  } catch {
    return undefined;
  }
}

function firstForecastItem(meta: any) {
  const items = pick(meta, "items");
  if (!Array.isArray(items) || !items.length) return null;
  const it = items[0] ?? {};
  const id = pick(it, "id") ?? pick(it, "usi") ?? pick(it, "service.id");
  const name = pick(it, "name") ?? pick(it, "service.name");
  const expire = pick(it, "expire") ?? pick(it, "expiresAt");
  const total = pick(it, "next.total") ?? pick(it, "nextTotal") ?? pick(it, "total");
  return { id, name, expire, total };
}

/**
 * bool normalization:
 * billing may send "", "1", 1, "true", true, etc.
 */
function parseBoolLike(v: any): boolean | undefined {
  if (v == null) return undefined;

  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v !== 0 : undefined;

  const s = String(v).trim().toLowerCase();
  if (!s) return false;

  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;

  return true;
}

/**
 * Build navigation hint for UI (feed cards).
 * Feed can use meta.action to navigate:
 * - service.blocked / activated / renewed -> /services (+ optional ?usi=)
 * - service.forecast -> /payments
 * - broadcast.news -> no action
 */
function addActionToMeta(type: string, metaIn: any) {
  const meta = metaIn && typeof metaIn === "object" ? { ...metaIn } : {};

  if (meta.action) return meta;

  const usi = pick(meta, "service.id") ?? pick(meta, "usi") ?? pick(meta, "service.usi");

  if (type === "service.blocked" || type === "service.activated" || type === "service.renewed") {
    meta.action = { kind: "nav", to: "/services", usi: usi ?? undefined };
  } else if (type === "service.forecast") {
    meta.action = { kind: "nav", to: "/payments" };
  } else if (type === "broadcast.news") {
    // no navigation
  }

  return meta;
}

export function formatIncoming(e: BillingPushEvent): BillingPushEvent {
  const type = String(e.type || "").trim();

  const level: Level =
    (e.level as any) ||
    (type === "balance.credited" || type === "service.renewed" || type === "service.activated"
      ? "success"
      : type === "service.blocked"
        ? "error"
        : "info");

  let toast = parseBoolLike((e as any).toast);
  if (toast === undefined) {
    if (type === "balance.credited") toast = true;
    else if (type === "service.blocked") toast = true;
    else if (type === "service.renewed") toast = true;
    else if (type === "service.activated") toast = true;
    else if (type === "service.forecast") toast = false;
    else if (type === "broadcast.news") toast = false;
    else toast = false;
  }

  let push = parseBoolLike((e as any).push);
  if (push === undefined) {
    push = false;
  }

  const metaRaw = (e as any).meta || {};
  const meta = addActionToMeta(type, metaRaw);

  const serviceId = pick(meta, "service.id") ?? pick(meta, "usi");
  const serviceName = pick(meta, "service.name") ?? pick(meta, "name");

  let title = (e as any).title || "";
  let message = (e as any).message || "";

  if (type === "balance.credited") {
    const amount = pick(meta, "amount") ?? pick(meta, "money") ?? pick(meta, "sum");
    const a = rub(amount);
    title = a ? `💰 ${a}` : "💰 Пополнение";
    message = "Баланс пополнен";
  } else if (type === "service.blocked") {
    title = "⛔ Услуга приостановлена";
    const name = serviceName ? String(serviceName) : "Услуга";
    const idPart = serviceId ? ` #${serviceId}` : "";
    message = `${name}${idPart} · нужно пополнение`;
  } else if (type === "service.activated") {
    title = "✅ Активировано";
    const name = serviceName ? String(serviceName) : "Услуга";
    const idPart = serviceId ? ` #${serviceId}` : "";
    const expire = pick(meta, "expire");
    message = expire ? `${name}${idPart} · до ${String(expire)}` : `${name}${idPart} · активировано`;
  } else if (type === "service.renewed") {
    title = "✅ Продлено";
    const name = serviceName ? String(serviceName) : "Услуга";
    const idPart = serviceId ? ` #${serviceId}` : "";
    const expireNew = pick(meta, "expire_new") ?? pick(meta, "expireNew") ?? pick(meta, "expire");
    message = expireNew ? `${name}${idPart} · до ${String(expireNew)}` : `${name}${idPart} · продлено`;
  } else if (type === "service.forecast") {
    title = "⏳ Скоро нужна оплата";

    const total = pick(meta, "total");
    const t = rub(total);

    const cnt = Number(pick(meta, "items_count") ?? pick(meta, "count"));
    const balance = pick(meta, "balance");
    const bonus = pick(meta, "bonus") ?? pick(meta, "get_bonus");

    const b = rub(balance);
    const bn = rub(bonus);

    const it = firstForecastItem(meta);
    if (it) {
      const name = it.name ? String(it.name) : "Услуга";
      const idPart = it.id ? ` #${it.id}` : "";
      const ex = it.expire ? `до ${String(it.expire)}` : "";
      const p = rub(it.total);
      message = `${name}${idPart}${ex ? ` · ${ex}` : ""}${p ? ` · ~${p}` : ""}`;
      if (Number.isFinite(cnt) && cnt > 1) message += ` (и ещё ${cnt - 1})`;
      if (!p && t) message += ` · всего ~${t}`;
    } else if (t) {
      message = `Нужно ~${t}`;
      if (Number.isFinite(cnt) && cnt > 0) message += ` · услуг: ${cnt}`;
      if (b) message += ` · баланс ${b}`;
      if (bn) message += ` (+${bn} бонус)`;
    } else if (Number.isFinite(cnt) && cnt > 0) {
      message = `Услуг под риском: ${cnt}`;
    } else {
      message = "Проверьте оплату услуг";
    }
  } else if (type === "broadcast.news") {
    title = title || "📢 Сообщение";
    message = message || "";
  } else {
    title = title || "Сообщение";
  }

  title = compact(title, 80);
  message = String(message || "").trim();

  return {
    ...e,
    type: type || e.type,
    level,
    toast,
    push,
    title,
    message,
    meta,
  };
}
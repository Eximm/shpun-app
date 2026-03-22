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

function setShort(meta: any, title: string, message: string) {
  return {
    ...meta,
    short: {
      title: compact(title, 80),
      message: compact(message, 160),
    },
  };
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
    push = Boolean(toast);
  }

  const metaRaw = (e as any).meta || {};
  let meta = addActionToMeta(type, metaRaw);

  const serviceId = pick(meta, "service.id") ?? pick(meta, "usi");
  const serviceName = pick(meta, "service.name") ?? pick(meta, "name");
  const idPart = serviceId ? ` #${serviceId}` : "";
  const namePart = serviceName ? String(serviceName) : "Услуга";

  let title = (e as any).title || "";
  let message = (e as any).message || "";

  if (type === "balance.credited") {
    const amount = pick(meta, "amount") ?? pick(meta, "money") ?? pick(meta, "sum");
    const a = rub(amount);

    title = "💰 Баланс пополнен";
    message = a ? `Зачислено ${a} на баланс аккаунта.` : "Баланс успешно пополнен.";

    meta = setShort(meta, "💰 Баланс пополнен", a ? `+${a}` : "");
  } else if (type === "service.blocked") {
    title = "⛔ Услуга заблокирована";
    message = `${namePart}${idPart} · проверьте статус услуги`;

    meta = setShort(meta, "⛔ Заблокирована", `${namePart}${idPart} · проверьте статус`);
  } else if (type === "service.activated") {
    const expire = pick(meta, "expire");

    title = "✅ Активировано";
    message = expire
      ? `${namePart}${idPart} · до ${String(expire)}`
      : `${namePart}${idPart} · услуга активирована`;

    meta = setShort(
      meta,
      "✅ Активировано",
      expire ? `${namePart}${idPart} · до ${String(expire)}` : `${namePart}${idPart}`,
    );
  } else if (type === "service.renewed") {
    const expireNew = pick(meta, "expire_new") ?? pick(meta, "expireNew") ?? pick(meta, "expire");

    title = "✅ Продлено";
    message = expireNew
      ? `${namePart}${idPart} · до ${String(expireNew)}`
      : `${namePart}${idPart} · услуга продлена`;

    meta = setShort(
      meta,
      "✅ Продлено",
      expireNew ? `${namePart}${idPart} · до ${String(expireNew)}` : `${namePart}${idPart}`,
    );
  } else if (type === "service.forecast") {
    const total = pick(meta, "total");
    const cnt = Number(pick(meta, "items_count") ?? pick(meta, "count") ?? 0);
    const balance = pick(meta, "balance");
    const bonus = pick(meta, "bonus") ?? pick(meta, "get_bonus");

    const t = rub(total);
    const b = rub(balance);
    const bn = rub(bonus);

    title = "⏳ Скоро нужна оплата";

    const fullParts: string[] = [];

    if (Number.isFinite(cnt) && cnt > 0 && t) {
      fullParts.push(
        cnt === 1
          ? `По 1 услуге скоро потребуется оплата на ${t}`
          : `По ${cnt} услугам скоро потребуется оплата на ${t}`
      );
    } else if (t) {
      fullParts.push(`Скоро потребуется оплата на ${t}`);
    } else if (Number.isFinite(cnt) && cnt > 0) {
      fullParts.push(
        cnt === 1
          ? "По 1 услуге скоро потребуется оплата"
          : `По ${cnt} услугам скоро потребуется оплата`
      );
    }

    if (b) fullParts.push(`баланс ${b}`);
    if (bn) fullParts.push(`бонус ${bn}`);

    message = fullParts.length ? fullParts.join(" · ") : "Проверьте ближайшую оплату услуг";

    let shortMessage = "Проверьте оплату";
    if (Number.isFinite(cnt) && cnt > 0 && t) shortMessage = `Услуг: ${cnt} · нужно ${t}`;
    else if (t) shortMessage = `Нужно ${t}`;
    else if (Number.isFinite(cnt) && cnt > 0) shortMessage = `Услуг: ${cnt}`;

    meta = setShort(meta, "💳 Скоро нужна оплата", shortMessage);
  } else if (type === "broadcast.news") {
    title = title || "📢 Сообщение";
    message = message || "";

    meta = setShort(meta, "📰 Новость", "Откройте Инфоцентр");
  } else {
    title = title || "Сообщение";
    meta = setShort(meta, title, message || "");
  }

  title = compact(title, 80);
  message = compact(String(message || "").trim(), 220);

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
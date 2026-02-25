// api/src/modules/notifications/format.ts
import type { BillingPushEvent } from "./inbox.js";

type Level = "info" | "success" | "error";

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

// Главная функция: превращаем входное событие в “готовое для людей”
export function formatIncoming(e: BillingPushEvent): BillingPushEvent {
  const type = String(e.type || "").trim();

  // level по умолчанию
  const level: Level =
    e.level ||
    (type === "balance.credited" || type === "service.renewed"
      ? "success"
      : type === "service.blocked"
      ? "error"
      : "info");

  // toast policy (MVP)
  let toast = e.toast;
  if (toast == null) {
    if (type === "balance.credited") toast = true;
    else if (type === "service.blocked") toast = true;
    else if (type === "service.renewed") toast = true;
    else if (type === "service.forecast") toast = true; // позже сделаем умнее
    else if (type === "broadcast.news") toast = false;
    else toast = false;
  }

  // meta (если пришло)
  const meta = (e as any).meta || {};
  const serviceId = pick(meta, "service.id") ?? pick(meta, "usi");
  const serviceName = pick(meta, "service.name") ?? pick(meta, "name");

  // ====== Форматирование по типам ======
  let title = e.title || "";
  let message = e.message || "";

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
    if (t) message = `Нужно ~${t}${Number.isFinite(cnt) && cnt > 0 ? ` · услуг: ${cnt}` : ""}`;
    else if (Number.isFinite(cnt) && cnt > 0) message = `Услуг под риском: ${cnt}`;
    else message = "Проверьте оплату услуг";
  } else if (type === "broadcast.news") {
    // новости оставляем “как есть”, только подчищаем
    title = title || "📢 Сообщение";
    message = message || "";
  } else {
    // fallback: просто чистим
    title = title || "Сообщение";
  }

  title = compact(title, 80);
  message = compact(message, 220);

  return {
    ...e,
    type: type || e.type,
    level,
    toast,
    title,
    message,
  };
}
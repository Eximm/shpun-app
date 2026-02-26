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

function firstForecastItem(meta: any) {
  const items = pick(meta, "items");
  if (!Array.isArray(items) || !items.length) return null;
  // берём первый как “ближайший” (биллинг может сортировать)
  const it = items[0] ?? {};
  const id = pick(it, "id") ?? pick(it, "usi") ?? pick(it, "service.id");
  const name = pick(it, "name") ?? pick(it, "service.name");
  const expire = pick(it, "expire") ?? pick(it, "expiresAt");
  const total = pick(it, "next.total") ?? pick(it, "nextTotal") ?? pick(it, "total");
  return { id, name, expire, total };
}

export function formatIncoming(e: BillingPushEvent): BillingPushEvent {
  const type = String(e.type || "").trim();

  const level: Level =
    e.level ||
    (type === "balance.credited" || type === "service.renewed" || type === "service.activated"
      ? "success"
      : type === "service.blocked"
      ? "error"
      : "info");

  // toast: если биллинг прислал — уважаем. Если нет — дефолты только для базовых событий.
  let toast = e.toast;
  if (toast == null) {
    if (type === "balance.credited") toast = true;
    else if (type === "service.blocked") toast = true;
    else if (type === "service.renewed") toast = true;
    else if (type === "service.activated") toast = true;
    else if (type === "service.forecast") toast = false; // forecast лучше контролировать из биллинга
    else if (type === "broadcast.news") toast = false; // новости: тост только если биллинг выставит toast=true
    else toast = false;
  }

  const meta = (e as any).meta || {};
  const serviceId = pick(meta, "service.id") ?? pick(meta, "usi");
  const serviceName = pick(meta, "service.name") ?? pick(meta, "name");

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
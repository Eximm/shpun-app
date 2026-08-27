import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";

type StatusItem = {
  id: number;
  title: string;
  host: string;
  kind: "vpn" | "infra";
  countryCode: string | null;
  online: boolean | null;
  latencyMs: number | null;
  uptime: string | null;
  loadPct: number | null;
  cpuLoadPct?: number | null;
  uplinkLoadPct?: number | null;
  memoryLoadPct?: number | null;
  rxMbps?: number | null;
  txMbps?: number | null;
  checkedAt: string | null;
};

type StatusResp = {
  ok: true;
  updatedAt: string | null;
  refreshing?: boolean;
  refreshIntervalMs?: number;
  manualCooldownMs?: number;
  vpn: StatusItem[];
  infra: StatusItem[];
};

type SummaryTone = "online" | "warn" | "offline" | "pending";

function timeAgo(iso?: string | null) {
  const ts = iso ? Date.parse(iso) : 0;
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.round(sec / 60);
  return `${min} мин назад`;
}

function loadTone(v: number | null) {
  if (v == null) return "soft";
  if (v >= 85) return "bad";
  if (v >= 65) return "warn";
  return "ok";
}

function pickVariant(items: string[], seed: number) {
  if (!items.length) return "";
  return items[Math.abs(seed) % items.length];
}

function summarySeed(total: number, online: number, offline: number, hot: number) {
  const minute = Math.floor(Date.now() / 60_000);
  return total * 17 + online * 13 + offline * 7 + hot * 5 + minute;
}

function countHot(items: StatusItem[], threshold: number) {
  return items.filter((x) => (x.loadPct ?? 0) >= threshold).length;
}

function buildSummary(data: StatusResp | null) {
  const vpn = data?.vpn ?? [];
  const infra = data?.infra ?? [];
  const items = [...vpn, ...infra];
  const total = items.length;
  const checked = items.filter((x) => x.online != null).length;
  const online = items.filter((x) => x.online === true).length;
  const infraOffline = infra.filter((x) => x.online === false).length;
  const vpnOffline = vpn.filter((x) => x.online === false).length;
  const infraHot = countHot(infra, 65);
  const vpnHot = countHot(vpn, 65);
  const overloaded = countHot(items, 85);
  const maxLoad = Math.max(0, ...items.map((x) => x.loadPct ?? 0));
  const seed = summarySeed(total, online, infraOffline + vpnOffline, infraHot + vpnHot);

  if (!total) {
    return {
      tone: "pending" as SummaryTone,
      title: "Мониторинг готовится",
      text: pickVariant([
        "Список серверов пока пустой. Добавим узлы — и здесь появится нормальная живая сводка.",
        "Пока смотреть не на кого, но место под табло уже занято.",
        "Мониторинг включён, осталось добавить серверы в админке.",
      ], seed),
      stats: "0/0",
    };
  }

  if (!checked) {
    return {
      tone: "pending" as SummaryTone,
      title: "Собираем телеметрию",
      text: pickVariant([
        "Первый снимок ещё готовится. Страница не ждёт опрос — данные появятся сами.",
        "Даём серверам ответить по очереди, без набега всей толпой.",
        "Мониторинг проснулся и раскладывает первые ответы по полочкам.",
      ], seed),
      stats: `${checked}/${total}`,
    };
  }

  if (infraOffline > 0) {
    return {
      tone: "offline" as SummaryTone,
      title: infraOffline > 1 ? "Служебный контур просел" : "Нужна проверка инфраструктуры",
      text: pickVariant([
        "Кабинет или сервер подписок не отвечает. Это важнее отдельной VPN-ноды — лучше проверить сразу.",
        "Есть проблема в служебной части: авторизация, кабинет или подписки могут вести себя неровно.",
        "VPN-направления могут быть живы, но служебный узел не ответил. Это уже повод заглянуть внутрь.",
      ], seed),
      stats: `${online}/${total}`,
    };
  }

  if (infraHot > 0) {
    return {
      tone: "warn" as SummaryTone,
      title: "Служебные серверы под нагрузкой",
      text: pickVariant([
        "Кабинет и подписки отвечают, но один из служебных узлов работает плотнее обычного.",
        "Сервис доступен, однако служебная часть сейчас трудится заметнее. Держим глаз на табло.",
        "Основные узлы на связи, но нагрузка в инфраструктуре уже просит внимания.",
      ], seed),
      stats: `${online}/${total}`,
    };
  }

  if (vpnOffline > 0) {
    const vpnRatio = vpn.length ? vpnOffline / vpn.length : 0;
    const serious = vpnOffline >= 3 || vpnRatio >= 0.25;
    return {
      tone: serious ? "offline" as SummaryTone : "warn" as SummaryTone,
      title: serious ? "Часть VPN-сети недоступна" : "Точечная проблема на VPN-ноде",
      text: pickVariant(
        serious
          ? [
              `${vpnOffline} VPN-ноды сейчас не отвечают. Служебная часть жива, но сеть стоит проверить.`,
              "Несколько VPN-направлений выпали из мониторинга. Пользователи могут заметить просадку по отдельным локациям.",
              "VPN-сеть не в полном составе. Не катастрофа, но уже не то состояние, где можно махнуть рукой.",
            ]
          : [
              "Одна-две VPN-ноды не отвечают. Основная система работает, остальные направления остаются доступными.",
              "Есть точечная проблема на VPN-направлении. Не пожар, но заметку на полях оставляем.",
              "Служебные серверы в порядке, а одна VPN-нода решила взять паузу. Проверить стоит, паниковать — нет.",
            ],
        seed,
      ),
      stats: `${online}/${total}`,
    };
  }

  if (overloaded > 0) {
    return {
      tone: "warn" as SummaryTone,
      title: "Есть высокая нагрузка",
      text: pickVariant([
        `Все узлы отвечают, но один из серверов дошёл до ${maxLoad}% нагрузки.`,
        "Связь есть, но часть системы работает на повышенных оборотах.",
        "Сервис доступен, однако нагрузка местами высокая. Наблюдаем внимательнее.",
      ], seed),
      stats: `${online}/${total}`,
    };
  }

  if (vpnHot > 1) {
    return {
      tone: "warn" as SummaryTone,
      title: "VPN-сеть трудится плотнее",
      text: pickVariant([
        "Все узлы отвечают, но несколько VPN-направлений сегодня не прохлаждаются.",
        "Сеть живая, нагрузка местами подросла. Пока штатно, но без сна на посту.",
        "Пользоваться можно спокойно, просто отдельные VPN-ноды сейчас работают активнее обычного.",
      ], seed),
      stats: `${online}/${total}`,
    };
  }

  return {
    tone: "online" as SummaryTone,
    title: "Система стабильна",
    text: pickVariant([
      "Кабинет, подписки и VPN-ноды на связи. Всё зелёное и бодрое.",
      "Служебные серверы отвечают, VPN-направления в строю. Можно без лишней драматургии.",
      "Картина хорошая: узлы доступны, нагрузка спокойная, поводов для суеты нет.",
      "Шпун держит строй: кабинет живой, подписки доступны, VPN-ноды отвечают.",
    ], seed),
    stats: `${online}/${total}`,
  };
}

function buildGroupSummary(items: StatusItem[], emptyTitle: string, important = false) {
  const total = items.length;
  const online = items.filter((x) => x.online === true).length;
  const offline = items.filter((x) => x.online === false).length;
  const pending = items.filter((x) => x.online == null).length;
  const maxLoad = Math.max(0, ...items.map((x) => x.loadPct ?? 0));

  if (!total) {
    return {
      tone: "pending" as const,
      title: emptyTitle,
      value: "0/0",
      sub: "пока пусто",
      load: null as number | null,
    };
  }

  if (pending === total) {
    return {
      tone: "pending" as const,
      title: "Опрос ещё идёт",
      value: `${online}/${total}`,
      sub: "ждём первый снимок",
      load: null as number | null,
    };
  }

  if (offline > 0) {
    return {
      tone: important || offline > 2 ? "offline" as const : "warn" as const,
      title: offline === 1 ? "1 не отвечает" : `${offline} не отвечают`,
      value: `${online}/${total}`,
      sub: important ? "важный контур" : "остальные в строю",
      load: maxLoad,
    };
  }

  if (maxLoad >= 85) {
    return {
      tone: "warn" as const,
      title: "Высокая нагрузка",
      value: `${online}/${total}`,
      sub: `пик ${maxLoad}%`,
      load: maxLoad,
    };
  }

  if (maxLoad >= 65) {
    return {
      tone: "warn" as const,
      title: "Работает плотнее",
      value: `${online}/${total}`,
      sub: `пик ${maxLoad}%`,
      load: maxLoad,
    };
  }

  return {
    tone: "online" as const,
    title: "В строю",
    value: `${online}/${total}`,
    sub: maxLoad > 0 ? `пик ${maxLoad}%` : "нагрузка тихая",
    load: maxLoad,
  };
}

function statusTone(online: StatusItem["online"]) {
  if (online == null) return "pending";
  return online ? "online" : "offline";
}

function regionForTitle(title: string) {
  const t = title.toLowerCase();
  if (/\bpl\b|warszawa|poland|польш/.test(t)) return "PL";
  if (/\bcz\b|prague|czech|праг|чех/.test(t)) return "CZ";
  if (/\bru\b|moscow|saint-petersburg|spb|моск|петербург|росс/.test(t)) return "RU";
  if (/\bswe\b|stockholm|sweden|швец/.test(t)) return "SE";
  if (/\bus\b|fremont|usa|сша/.test(t)) return "US";
  if (/\bfi\b|helsinki|finland|фин/.test(t)) return "FI";
  if (/\bnl\b|meppel|netherlands|нидер/.test(t)) return "NL";
  if (/\btl\b|tallin|tallinn|estonia|эстон/.test(t)) return "EE";
  if (/\blv\b|riga|latvia|латв/.test(t)) return "LV";
  if (/\bde\b|frankfurt|germany|герман/.test(t)) return "DE";
  return "VPN";
}

function regionForItem(item: StatusItem) {
  const explicit = String(item.countryCode ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(explicit) ? explicit : regionForTitle(item.title || item.host);
}

function ServerCard({ item }: { item: StatusItem }) {
  const tone = statusTone(item.online);
  const loadPct = Math.max(0, Math.min(100, item.loadPct ?? 0));
  return (
    <div className={`serverStatus-card serverStatus-card--${tone}`}>
      <div className="serverStatus-card__top">
        <span className={`serverStatus-dot serverStatus-dot--${tone}`} />
        <span className="serverStatus-card__region" aria-hidden="true">{regionForItem(item)}</span>
        <div className="serverStatus-card__title">{item.title || item.host}</div>
      </div>
      <div className="serverStatus-card__line" aria-hidden="true">
        <span style={{ width: `${loadPct}%` }} />
      </div>
      <div className="serverStatus-metrics" aria-label="Показатели сервера">
        <span><small>аптайм</small><b>{item.uptime || "—"}</b></span>
        <span className={`serverStatus-load serverStatus-load--${loadTone(item.loadPct)}`}><small>нагрузка</small><b>{item.loadPct != null ? `${item.loadPct}%` : "—"}</b></span>
        <span className="serverStatus-card__checked"><small>проверка</small><b>{item.checkedAt ? timeAgo(item.checkedAt) : "ждём"}</b></span>
      </div>
    </div>
  );
}

function StatusOverview({ data }: { data: StatusResp | null }) {
  const summary = useMemo(() => buildSummary(data), [data]);
  const vpnSummary = useMemo(() => buildGroupSummary(data?.vpn ?? [], "VPN-ноды не добавлены"), [data]);
  const infraSummary = useMemo(() => buildGroupSummary(data?.infra ?? [], "Кабинет не добавлен", true), [data]);
  return (
    <div className={`serverStatus-summary serverStatus-summary--${summary.tone}`}>
      <div className="serverStatus-summary__top">
        <div>
          <div className="serverStatus-summary__kicker">Общий статус</div>
          <div className="serverStatus-summary__title">{summary.title}</div>
          <p>{summary.text}</p>
        </div>
        <div className="serverStatus-summary__stat">
          <b>{summary.stats}</b>
          <small>узлов в строю</small>
        </div>
      </div>
      <div className="serverStatus-summaryGrid">
        <SummaryTile label="Кабинет и подписки" summary={infraSummary} />
        <SummaryTile label="VPN-ноды" summary={vpnSummary} />
      </div>
    </div>
  );
}

function SummaryTile({ label, summary }: { label: string; summary: ReturnType<typeof buildGroupSummary> }) {
  return (
    <div className={`serverStatus-summaryTile serverStatus-summaryTile--${summary.tone}`}>
      <div className="serverStatus-summaryTile__head">
        <span className={`serverStatus-dot serverStatus-dot--${summary.tone}`} />
        <span>{label}</span>
        <b>{summary.value}</b>
      </div>
      <div className="serverStatus-summaryTile__title">{summary.title}</div>
      <div className="serverStatus-summaryTile__sub">{summary.sub}</div>
      <div className="serverStatus-summaryTile__bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, summary.load ?? 0))}%` }} />
      </div>
    </div>
  );
}

function StatusGroup({ title, sub, items, defaultOpen = false }: { title: string; sub: string; items: StatusItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const online = useMemo(() => items.filter((x) => x.online === true).length, [items]);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <section className="serverStatus-group">
      <button className="serverStatus-group__head" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
        <span className="serverStatus-group__meta">
          <span className="serverStatus-group__count">{online}/{items.length}</span>
          <span className={`serverStatus-group__chevron ${open ? "is-open" : ""}`}>⌄</span>
        </span>
      </button>
      {open && items.length ? (
        <div className="serverStatus-grid">
          {items.map((item) => <ServerCard key={item.id} item={item} />)}
        </div>
      ) : open ? (
        <div className="card serverStatus-empty"><div className="card__body">Серверы пока не добавлены в мониторинг.</div></div>
      ) : null}
    </section>
  );
}

export function ServerStatus() {
  const [data, setData] = useState<StatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await apiFetch<StatusResp>("/server-status", { method: "GET" });
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить статус серверов.");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="section miniPage serverStatus-page">
      <div className="pageBackRow">
        <PageBackButton />
      </div>
      <div className="card miniPage__hero serverStatus-hero">
        <div className="card__body">
          <div className="serverStatus-hero__title">
            <h1 className="h1">Состояние системы</h1>
            <p className="p miniPage__subtitle">Короткая сводка по кабинету, подпискам и VPN-нодам.</p>
          </div>
          {error && <div className="pre" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>

      <StatusOverview data={data} />
      <StatusGroup
        title="VPN-серверы"
        sub="Направления для подключений. Подробности закрыты, чтобы не занимать экран без нужды."
        items={data?.vpn ?? []}
        defaultOpen={(data?.vpn ?? []).some((x) => x.online !== true)}
      />
      <StatusGroup
        title="Кабинет и подписки"
        sub="Служебная часть сервиса: кабинет, авторизация и выдача подписок."
        items={data?.infra ?? []}
        defaultOpen={(data?.infra ?? []).some((x) => x.online !== true)}
      />
    </div>
  );
}

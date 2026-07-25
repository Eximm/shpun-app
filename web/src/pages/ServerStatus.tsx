import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";

type StatusItem = {
  id: number;
  title: string;
  host: string;
  kind: "vpn" | "infra";
  online: boolean | null;
  latencyMs: number | null;
  uptime: string | null;
  loadPct: number | null;
  checkedAt: string | null;
};

type StatusResp = {
  ok: true;
  updatedAt: string | null;
  refreshing?: boolean;
  refreshIntervalMs?: number;
  vpn: StatusItem[];
  infra: StatusItem[];
};

function timeAgo(iso?: string) {
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

function buildSummary(data: StatusResp | null) {
  const items = [...(data?.vpn ?? []), ...(data?.infra ?? [])];
  const total = items.length;
  const checked = items.filter((x) => x.online != null).length;
  const online = items.filter((x) => x.online === true).length;
  const offline = items.filter((x) => x.online === false).length;
  const hot = items.filter((x) => (x.loadPct ?? 0) >= 65).length;
  const overloaded = items.filter((x) => (x.loadPct ?? 0) >= 85).length;

  if (!total) {
    return {
      tone: "pending" as const,
      title: "Мониторинг готовится",
      text: "Серверы пока не добавлены, но место под лампочки уже заняли.",
      stats: "0/0",
    };
  }

  if (!checked) {
    return {
      tone: "pending" as const,
      title: "Собираем телеметрию",
      text: "Первый снимок ещё готовится. Страница уже не ждёт — данные подтянутся сами.",
      stats: `${checked}/${total}`,
    };
  }

  if (offline > 0) {
    return {
      tone: offline >= Math.ceil(total / 3) ? "offline" as const : "warn" as const,
      title: offline >= Math.ceil(total / 3) ? "Часть системы отдыхает" : "Есть локальные вопросы",
      text: `${offline} из ${total} узлов сейчас не отвечают. Остальные продолжают держать строй.`,
      stats: `${online}/${total}`,
    };
  }

  if (overloaded > 0 || hot > 1) {
    return {
      tone: "warn" as const,
      title: "Система трудится",
      text: "Все узлы на связи, но часть серверов заметно занята. Shpun ворчит, но работает.",
      stats: `${online}/${total}`,
    };
  }

  return {
    tone: "online" as const,
    title: "Система стабильна",
    text: "Все наблюдаемые узлы на связи, нагрузка спокойная. Интернету выдан зелёный чай.",
    stats: `${online}/${total}`,
  };
}

function buildGroupSummary(items: StatusItem[], emptyTitle: string) {
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
      sub: "не настроено",
      load: null as number | null,
    };
  }

  if (pending === total) {
    return {
      tone: "pending" as const,
      title: "Собираем данные",
      value: `${online}/${total}`,
      sub: "первый опрос",
      load: null as number | null,
    };
  }

  if (offline > 0) {
    return {
      tone: "offline" as const,
      title: offline === 1 ? "Есть один молчун" : "Есть молчуны",
      value: `${online}/${total}`,
      sub: `${offline} не отвечает`,
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
      title: "Трудится плотнее",
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
  if (/\bde\b|frankfurt|germany|герман/.test(t)) return "DE";
  return "VPN";
}

function ServerCard({ item }: { item: StatusItem }) {
  const tone = statusTone(item.online);
  const loadPct = Math.max(0, Math.min(100, item.loadPct ?? 0));
  return (
    <div className={`serverStatus-card serverStatus-card--${tone}`}>
      <div className="serverStatus-card__top">
        <span className={`serverStatus-dot serverStatus-dot--${tone}`} />
        <span className="serverStatus-card__region" aria-hidden="true">{regionForTitle(item.title || item.host)}</span>
        <div className="serverStatus-card__title">{item.title || item.host}</div>
      </div>
      <div className="serverStatus-card__line" aria-hidden="true">
        <span style={{ width: `${loadPct}%` }} />
      </div>
      <div className="serverStatus-metrics" aria-label="Показатели сервера">
        <span><small>апт</small><b>{item.uptime || "—"}</b></span>
        <span><small>пинг</small><b>{item.latencyMs != null ? `${item.latencyMs} мс` : "—"}</b></span>
        <span className={`serverStatus-load serverStatus-load--${loadTone(item.loadPct)}`}><small>load</small><b>{item.loadPct != null ? `${item.loadPct}%` : "—"}</b></span>
        <span className="serverStatus-card__checked"><small>опрос</small><b>{item.checkedAt ? timeAgo(item.checkedAt) : "ждём"}</b></span>
      </div>
    </div>
  );
}

function StatusOverview({ data }: { data: StatusResp | null }) {
  const summary = useMemo(() => buildSummary(data), [data]);
  const vpnSummary = useMemo(() => buildGroupSummary(data?.vpn ?? [], "VPN-ноды не добавлены"), [data]);
  const infraSummary = useMemo(() => buildGroupSummary(data?.infra ?? [], "Кабинет не добавлен"), [data]);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<StatusResp>("/server-status", { method: "GET" });
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить статус серверов.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
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
            <p className="p miniPage__subtitle">Коротко: что живо, что занято, куда Shpun сейчас внимательно смотрит.</p>
          </div>
          <div className="serverStatus-actions">
            <button className="btn btn--primary" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Проверяем…" : "Обновить"}
            </button>
          </div>
          {error && <div className="pre" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>

      <StatusOverview data={data} />
      <StatusGroup
        title="VPN-серверы"
        sub="Ноды, которые используются для подключений."
        items={data?.vpn ?? []}
        defaultOpen={(data?.vpn ?? []).some((x) => x.online !== true)}
      />
      <StatusGroup
        title="Кабинет и подписки"
        sub="Служебные узлы приложения и инфраструктуры."
        items={data?.infra ?? []}
        defaultOpen={(data?.infra ?? []).some((x) => x.online !== true)}
      />
    </div>
  );
}

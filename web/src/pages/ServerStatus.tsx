import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { PageBackButton } from "../shared/ui/PageBackButton";

type TFn = ReturnType<typeof useI18n>["t"];

type StatusItem = {
  id: number;
  title: string;
  kind: "vpn" | "infra";
  countryCode: string | null;
  online: boolean | null;
  uptime: string | null;
  loadPct: number | null;
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

function timeAgo(iso: string | null | undefined, t: TFn) {
  const ts = iso ? Date.parse(iso) : 0;
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return t("serverStatus.time.sec", { n: sec });
  const min = Math.round(sec / 60);
  return t("serverStatus.time.min", { n: min });
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

function buildSummary(data: StatusResp | null, t: TFn) {
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
      title: t("serverStatus.summary.none.title"),
      text: t(pickVariant([
        "serverStatus.summary.none.0",
        "serverStatus.summary.none.1",
        "serverStatus.summary.none.2",
      ], seed)),
      stats: "0/0",
    };
  }

  if (!checked) {
    return {
      tone: "pending" as SummaryTone,
      title: t("serverStatus.summary.pending.title"),
      text: t(pickVariant([
        "serverStatus.summary.pending.0",
        "serverStatus.summary.pending.1",
        "serverStatus.summary.pending.2",
      ], seed)),
      stats: `${checked}/${total}`,
    };
  }

  if (infraOffline > 0) {
    return {
      tone: "offline" as SummaryTone,
      title: infraOffline > 1
        ? t("serverStatus.summary.infra_offline.title.many")
        : t("serverStatus.summary.infra_offline.title.one"),
      text: t(pickVariant([
        "serverStatus.summary.infra_offline.0",
        "serverStatus.summary.infra_offline.1",
        "serverStatus.summary.infra_offline.2",
      ], seed)),
      stats: `${online}/${total}`,
    };
  }

  if (infraHot > 0) {
    return {
      tone: "warn" as SummaryTone,
      title: t("serverStatus.summary.infra_hot.title"),
      text: t(pickVariant([
        "serverStatus.summary.infra_hot.0",
        "serverStatus.summary.infra_hot.1",
        "serverStatus.summary.infra_hot.2",
      ], seed)),
      stats: `${online}/${total}`,
    };
  }

  if (vpnOffline > 0) {
    const vpnRatio = vpn.length ? vpnOffline / vpn.length : 0;
    const serious = vpnOffline >= 3 || vpnRatio >= 0.25;
    return {
      tone: serious ? "offline" as SummaryTone : "warn" as SummaryTone,
      title: serious
        ? t("serverStatus.summary.vpn_offline.title.many")
        : t("serverStatus.summary.vpn_offline.title.one"),
      text: serious
        ? t(pickVariant([
            "serverStatus.summary.vpn_offline.many.0",
            "serverStatus.summary.vpn_offline.many.1",
            "serverStatus.summary.vpn_offline.many.2",
          ], seed), { count: vpnOffline })
        : t(pickVariant([
            "serverStatus.summary.vpn_offline.one.0",
            "serverStatus.summary.vpn_offline.one.1",
            "serverStatus.summary.vpn_offline.one.2",
          ], seed)),
      stats: `${online}/${total}`,
    };
  }

  if (overloaded > 0) {
    return {
      tone: "warn" as SummaryTone,
      title: t("serverStatus.summary.overloaded.title"),
      text: t(pickVariant([
        "serverStatus.summary.overloaded.0",
        "serverStatus.summary.overloaded.1",
        "serverStatus.summary.overloaded.2",
      ], seed), { load: maxLoad }),
      stats: `${online}/${total}`,
    };
  }

  if (vpnHot > 1) {
    return {
      tone: "warn" as SummaryTone,
      title: t("serverStatus.summary.vpn_hot.title"),
      text: t(pickVariant([
        "serverStatus.summary.vpn_hot.0",
        "serverStatus.summary.vpn_hot.1",
        "serverStatus.summary.vpn_hot.2",
      ], seed)),
      stats: `${online}/${total}`,
    };
  }

  return {
    tone: "online" as SummaryTone,
    title: t("serverStatus.summary.online.title"),
    text: t(pickVariant([
      "serverStatus.summary.online.0",
      "serverStatus.summary.online.1",
      "serverStatus.summary.online.2",
      "serverStatus.summary.online.3",
    ], seed)),
    stats: `${online}/${total}`,
  };
}

function buildGroupSummary(items: StatusItem[], emptyTitleKey: string, important: boolean, t: TFn) {
  const total = items.length;
  const online = items.filter((x) => x.online === true).length;
  const offline = items.filter((x) => x.online === false).length;
  const pending = items.filter((x) => x.online == null).length;
  const maxLoad = Math.max(0, ...items.map((x) => x.loadPct ?? 0));

  if (!total) {
    return {
      tone: "pending" as const,
      title: t(emptyTitleKey),
      value: "0/0",
      sub: t("serverStatus.groups.empty_sub"),
      load: null as number | null,
    };
  }

  if (pending === total) {
    return {
      tone: "pending" as const,
      title: t("serverStatus.groups.polling"),
      value: `${online}/${total}`,
      sub: t("serverStatus.groups.polling_sub"),
      load: null as number | null,
    };
  }

  if (offline > 0) {
    return {
      tone: important || offline > 2 ? "offline" as const : "warn" as const,
      title: offline === 1 ? t("serverStatus.groups.down_one") : t("serverStatus.groups.down", { n: offline }),
      value: `${online}/${total}`,
      sub: important ? t("serverStatus.groups.important") : t("serverStatus.groups.rest_ok"),
      load: maxLoad,
    };
  }

  if (maxLoad >= 85) {
    return {
      tone: "warn" as const,
      title: t("serverStatus.groups.high"),
      value: `${online}/${total}`,
      sub: t("serverStatus.groups.peak", { n: maxLoad }),
      load: maxLoad,
    };
  }

  if (maxLoad >= 65) {
    return {
      tone: "warn" as const,
      title: t("serverStatus.groups.dense"),
      value: `${online}/${total}`,
      sub: t("serverStatus.groups.peak", { n: maxLoad }),
      load: maxLoad,
    };
  }

  return {
    tone: "online" as const,
    title: t("serverStatus.groups.ok"),
    value: `${online}/${total}`,
    sub: maxLoad > 0 ? t("serverStatus.groups.peak", { n: maxLoad }) : t("serverStatus.groups.load_quiet"),
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
  return /^[A-Z]{2}$/.test(explicit) ? explicit : regionForTitle(item.title || "");
}

function ServerCard({ item }: { item: StatusItem }) {
  const { t } = useI18n();
  const tone = statusTone(item.online);
  const loadPct = Math.max(0, Math.min(100, item.loadPct ?? 0));
  return (
    <div className={`serverStatus-card serverStatus-card--${tone}`}>
      <div className="serverStatus-card__top">
        <span className={`serverStatus-dot serverStatus-dot--${tone}`} />
        <span className="serverStatus-card__region" aria-hidden="true">{regionForItem(item)}</span>
        <div className="serverStatus-card__title">{item.title || "—"}</div>
      </div>
      <div className="serverStatus-card__line" aria-hidden="true">
        <span style={{ width: `${loadPct}%` }} />
      </div>
      <div className="serverStatus-metrics" aria-label={t("serverStatus.card.metrics_aria")}>
        <span><small>{t("serverStatus.card.uptime")}</small><b>{item.uptime || "—"}</b></span>
        <span className={`serverStatus-load serverStatus-load--${loadTone(item.loadPct)}`}><small>{t("serverStatus.card.load")}</small><b>{item.loadPct != null ? `${item.loadPct}%` : "—"}</b></span>
        <span className="serverStatus-card__checked"><small>{t("serverStatus.card.check")}</small><b>{item.checkedAt ? timeAgo(item.checkedAt, t) : t("serverStatus.card.waiting")}</b></span>
      </div>
    </div>
  );
}

function StatusOverview({ data }: { data: StatusResp | null }) {
  const { t } = useI18n();
  const summary = useMemo(() => buildSummary(data, t), [data, t]);
  const vpnSummary = useMemo(() => buildGroupSummary(data?.vpn ?? [], "serverStatus.groups.vpn_empty", false, t), [data, t]);
  const infraSummary = useMemo(() => buildGroupSummary(data?.infra ?? [], "serverStatus.groups.infra_empty", true, t), [data, t]);
  return (
    <div className={`serverStatus-summary serverStatus-summary--${summary.tone}`}>
      <div className="serverStatus-summary__top">
        <div>
          <div className="serverStatus-summary__kicker">{t("serverStatus.summary.kicker")}</div>
          <div className="serverStatus-summary__title">{summary.title}</div>
          <p>{summary.text}</p>
        </div>
        <div className="serverStatus-summary__stat">
          <b>{summary.stats}</b>
          <small>{t("serverStatus.summary.nodes")}</small>
        </div>
      </div>
      <div className="serverStatus-summaryGrid">
        <SummaryTile label={t("serverStatus.tiles.infra")} summary={infraSummary} />
        <SummaryTile label={t("serverStatus.tiles.vpn")} summary={vpnSummary} />
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
  const { t } = useI18n();
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
        <div className="card serverStatus-empty"><div className="card__body">{t("serverStatus.group.empty")}</div></div>
      ) : null}
    </section>
  );
}

export function ServerStatus() {
  const { t } = useI18n();
  const [data, setData] = useState<StatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await apiFetch<StatusResp>("/server-status", { method: "GET" });
      setData(r);
    } catch (e: any) {
      setError(e?.message || t("serverStatus.error"));
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
            <h1 className="h1">{t("serverStatus.kicker")}</h1>
            <p className="p miniPage__subtitle">{t("serverStatus.subtitle")}</p>
          </div>
          {error && <div className="pre" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>

      <StatusOverview data={data} />
      <StatusGroup
        title={t("serverStatus.group.vpn.title")}
        sub={t("serverStatus.group.vpn.sub")}
        items={data?.vpn ?? []}
        defaultOpen={(data?.vpn ?? []).some((x) => x.online !== true)}
      />
      <StatusGroup
        title={t("serverStatus.group.infra.title")}
        sub={t("serverStatus.group.infra.sub")}
        items={data?.infra ?? []}
        defaultOpen={(data?.infra ?? []).some((x) => x.online !== true)}
      />
    </div>
  );
}
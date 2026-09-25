import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { AdminSectionHeader, ADMIN_SECTION_ICON, ModalShell } from "./shared";
import { ActionMenu } from "./ActionMenu";

type AliasItem = {
  id: number;
  alias: string;
  link_type: "partner" | "campaign";
  partner_id: number;
  campaign_code: string | null;
  billing_comment: string | null;
  first_payment_bonus_percent: number;
  partner_reward_percent: number;
  ad_cost_minor: number;
  enabled: boolean;
  visits_count: number;
  registrations_count: number;
  created_at: string;
};

type PartnerForm = {
  linkType: "partner" | "campaign";
  alias: string;
  partnerId: string;
  campaignCode: string;
  billingComment: string;
  firstPaymentBonusPercent: string;
  partnerRewardPercent: string;
  adCost: string;
  enabled: boolean;
};

type PartnerStats = {
  totalUsers: number;
  activeUsers: number;
  scannedUsers: number;
  truncated: boolean;
  serviceCheckedUsers?: number;
  serviceCheckFailedUsers?: number;
  serviceStatsMethod?: string;
  scannedServices?: number;
  serviceRowsWithOwner?: number;
  serviceStatsTruncated?: boolean;
  referralUserIdsCount?: number;
  templateVersion?: string;
  templateActiveUsers?: number;
  activeSource?: "services" | "template" | "billing" | "local";
};

type TFn = ReturnType<typeof useI18n>["t"];

type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";
const ANALYTICS_PERIODS: AnalyticsPeriod[] = ["7d", "30d", "90d", "all"];

type StatusFilter = "all" | "active" | "inactive";
type TypeFilter = "all" | "partner" | "campaign";
type SortKey = "new" | "name" | "visits" | "registrations";

// Mirrors the backend ReferralAnalytics DTO (see api/src/modules/referrals/analytics.ts).
// `null` means "not available" - never rendered as 0.
type ReferralAnalytics = {
  aliasId: number;
  alias: string;
  linkType: "partner" | "campaign";
  period: AnalyticsPeriod;
  acquisition: {
    clicks: number | null;
    allTimeClicks: number;
    registrations: number;
    firstTopups: number | null;
    payingUsers: number | null;
    activeUsers: number | null;
    registrationsConversionPct: number | null;
    payingConversionPct: number | null;
  };
  finance: {
    totalTopups: number | null;
    serviceRevenue: number | null;
    bonusDebits: number | null;
    adCost: number | null;
    allTimeAdCost: number | null;
    partnerCommissionAccrued: number | null;
    partnerCommissionPaid: number | null;
    acquisitionCost: number | null;
    result: number | null;
  };
  efficiency: {
    cac: number | null;
    arppu: number | null;
    roasPct: number | null;
    roiPct: number | null;
  };
  availability: {
    finance: boolean;
    reason: string | null;
    periodModel: string;
    clicksPeriodLimited: boolean;
    adCostPeriodLimited: boolean;
  };
};

const createEmptyForm = (): PartnerForm => ({
  linkType: "partner",
  alias: "",
  partnerId: "",
  campaignCode: "",
  billingComment: "",
  firstPaymentBonusPercent: "",
  partnerRewardPercent: "",
  adCost: "",
  enabled: true,
});

function readEnv(key: string): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function getTelegramBotUsername(): string {
  const raw = readEnv("VITE_TG_BOT_USERNAME");
  return raw.startsWith("@") ? raw.slice(1).trim() : raw.trim();
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildTelegramBotLink(botUsername: string, item: AliasItem): string {
  if (!botUsername) return "";
  const payload = item.link_type === "campaign"
    ? new URLSearchParams({ campaign: item.alias }).toString()
    : new URLSearchParams({ referral_alias: item.alias, partner_id: String(item.partner_id) }).toString();
  return `https://t.me/${botUsername}?start=${toBase64Url(payload)}`;
}

function buildAppLink(alias: string): string {
  return `https://app.shpun.net/?${alias}`;
}

/** SQLite `datetime('now')` is "YYYY-MM-DD HH:MM:SS" (UTC); normalise before parsing. */
function parseSqliteDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Keep the ad-spend input to a non-negative money string with max 2 decimals. */
function sanitizeMoneyInput(value: string): string {
  const cleaned = String(value ?? "").replace(/[^\d.]/g, "");
  const [head, ...rest] = cleaned.split(".");
  return rest.length ? `${head}.${rest.join("").slice(0, 2)}` : head;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function activeStatsTitle(stats: PartnerStats | undefined, t: TFn): string {
  if (!stats) return "";
  if (stats.activeSource === "template") {
    return t("admin.referral.stats.template", {
      version: stats.templateVersion ? `: ${stats.templateVersion}` : "",
    });
  }
  if (stats.activeSource === "services") {
    const parts = [
      stats.serviceStatsMethod || "services",
      typeof stats.scannedServices === "number" ? t("admin.referral.stats.services_count", { n: stats.scannedServices }) : "",
      typeof stats.serviceRowsWithOwner === "number" ? t("admin.referral.stats.with_owner", { n: stats.serviceRowsWithOwner }) : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }
  return "";
}

function InfoRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="refAnalytics__row">
      <span>{label}</span>
      <strong className={`refAnalytics__value${tone ?? ""}`}>{value}</strong>
    </div>
  );
}

export function ReferralAliasesSection() {
  const { t, formatCurrency, formatNumber, formatDate } = useI18n();
  const [items, setItems] = useState<AliasItem[]>([]);
  const [form, setForm] = useState<PartnerForm>(createEmptyForm);
  const [editingAlias, setEditingAlias] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<Record<number, PartnerStats>>({});
  const [statsLoading, setStatsLoading] = useState<Record<number, boolean>>({});
  const [analytics, setAnalytics] = useState<Record<number, ReferralAnalytics>>({});
  const [analyticsItem, setAnalyticsItem] = useState<AliasItem | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("all");
  const [analyticsData, setAnalyticsData] = useState<ReferralAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [infoItem, setInfoItem] = useState<AliasItem | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [menuItem, setMenuItem] = useState<AliasItem | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("new");
  const [copiedLink, setCopiedLink] = useState("");
  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  async function fetchAnalytics(period: AnalyticsPeriod): Promise<ReferralAnalytics[]> {
    const response = await apiFetch<{ ok: true; items: ReferralAnalytics[] }>(
      `/admin/referral-aliases/analytics?period=${period}`,
      { method: "GET" }
    );
    return Array.isArray(response.items) ? response.items : [];
  }

  // Analytics modal: refetch when the alias or period changes. Cancellation
  // avoids a stale response overwriting a newer period selection.
  useEffect(() => {
    if (!analyticsItem) return;
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsData(null);
    fetchAnalytics(analyticsPeriod)
      .then((rows) => {
        if (!cancelled) setAnalyticsData(rows.find((row) => row.aliasId === analyticsItem.id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setAnalyticsData(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => { cancelled = true; };
  }, [analyticsItem, analyticsPeriod]);

  async function copyLink(key: string, value: string) {
    const ok = await copyToClipboard(value);
    if (!ok) {
      setMessage(t("admin.referral.msg.copy_failed"));
      return;
    }
    setCopiedLink(key);
    setMessage(t("admin.referral.msg.copied"));
    window.setTimeout(() => {
      setCopiedLink((current) => current === key ? "" : current);
    }, 1800);
  }

  async function loadStats(item: AliasItem) {
    setStatsLoading((current) => ({ ...current, [item.id]: true }));
    try {
      const response = await apiFetch<{ ok: true } & PartnerStats>(
        `/admin/referral-aliases/${item.id}/stats`,
        { method: "GET" }
      );
      setStats((current) => ({ ...current, [item.id]: response }));
    } catch {
      // Keep the card usable if billing statistics are temporarily unavailable.
    } finally {
      setStatsLoading((current) => ({ ...current, [item.id]: false }));
    }
  }

  async function load() {
    const response = await apiFetch<{ ok: true; items: AliasItem[] }>(
      "/admin/referral-aliases",
      { method: "GET" }
    );
    setItems(response.items);
    void Promise.allSettled(response.items.map((item) => loadStats(item)));
    try {
      const rows = await fetchAnalytics("all");
      const map: Record<number, ReferralAnalytics> = {};
      for (const row of rows) map[row.aliasId] = row;
      setAnalytics(map);
    } catch {
      // Analytics are additive; never block the alias list on them.
    }
  }

  // Initial admin snapshot; subsequent reloads are explicit after mutations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  function clearForm() {
    setForm(createEmptyForm());
    setEditingAlias("");
    setCreating(false);
    setMessage("");
  }

  function createLink(linkType: "partner" | "campaign") {
    setForm({ ...createEmptyForm(), linkType });
    setEditingAlias("");
    setCreating(true);
    setMessage("");
  }

  function edit(item: AliasItem) {
    setCreating(false);
    setEditingAlias(item.alias);
    setForm({
      linkType: item.link_type,
      alias: item.alias,
      partnerId: String(item.partner_id),
      campaignCode: item.campaign_code || "",
      billingComment: item.billing_comment || "",
      firstPaymentBonusPercent: String(item.first_payment_bonus_percent),
      partnerRewardPercent: String(item.partner_reward_percent),
      adCost: item.ad_cost_minor ? String(item.ad_cost_minor / 100) : "",
      enabled: item.enabled,
    });
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setMessage("");
    try {
      await apiFetch("/admin/referral-aliases", {
        method: "PUT",
        body: {
          ...form,
          partnerId: Number(form.partnerId),
          firstPaymentBonusPercent: form.firstPaymentBonusPercent === ""
            ? 0
            : Number(form.firstPaymentBonusPercent),
          partnerRewardPercent: form.partnerRewardPercent === ""
            ? 0
            : Number(form.partnerRewardPercent),
          adCostMinor: form.linkType === "campaign"
            ? Math.max(0, Math.round((Number(form.adCost) || 0) * 100))
            : 0,
        },
      });
      clearForm();
      await load();
      void refreshAdminOverview();
      setMessage(form.linkType === "campaign" ? t("admin.referral.msg.saved_campaign") : t("admin.referral.msg.saved_partner"));
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : t("admin.referral.err.save"));
    }
  }

  async function remove(id: number) {
    await apiFetch(`/admin/referral-aliases/${id}`, { method: "DELETE" });
    await load();
    void refreshAdminOverview();
  }

  async function confirmRemove(item: AliasItem) {
    if (!window.confirm(t("admin.referral.confirm.delete", { alias: item.alias }))) return;
    await remove(item.id);
    setInfoItem((current) => (current && current.id === item.id ? null : current));
  }

  function openAnalytics(item: AliasItem) {
    setAnalyticsPeriod("all");
    setAnalyticsItem(item);
  }

  function openMenu(item: AliasItem, anchor: HTMLElement) {
    setMenuItem(item);
    setMenuAnchor(anchor);
  }

  const dash = "—";
  const money = (value: number | null) => (value === null ? dash : formatCurrency(value));
  const count = (value: number | null) => (value === null ? dash : formatNumber(value));
  const pct = (value: number | null) =>
    value === null ? dash : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const tone = (value: number | null) =>
    value === null || value === 0 ? "" : value > 0 ? " is-positive" : " is-negative";
  const createdLabel = (value: string) => {
    const d = parseSqliteDate(value);
    return d ? formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" }) : dash;
  };

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (statusFilter === "active" && !item.enabled) return false;
      if (statusFilter === "inactive" && item.enabled) return false;
      if (typeFilter !== "all" && item.link_type !== typeFilter) return false;
      if (!q) return true;
      const haystack = [
        item.alias,
        item.partner_id > 0 ? `#${item.partner_id}` : "",
        item.partner_id > 0 ? String(item.partner_id) : "",
        item.campaign_code || "",
        item.billing_comment || "",
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });

    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.alias.localeCompare(b.alias));
    else if (sort === "visits") sorted.sort((a, b) => (b.visits_count || 0) - (a.visits_count || 0));
    else if (sort === "registrations") sorted.sort((a, b) => (b.registrations_count || 0) - (a.registrations_count || 0));
    else sorted.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return sorted;
  }, [items, query, statusFilter, typeFilter, sort]);

  const campaignItems = visibleItems.filter((item) => item.link_type === "campaign");
  const partnerItems = visibleItems.filter((item) => item.link_type !== "campaign");
  const hasFilter = query.trim() !== "" || statusFilter !== "all" || typeFilter !== "all";

  function statusChip(enabled: boolean) {
    return (
      <span className={`chip ${enabled ? "chip--ok" : "chip--soft"}`}>
        {enabled ? t("admin.referral.status.active") : t("admin.referral.status.off")}
      </span>
    );
  }

  function placementLinks(item: AliasItem, appLink: string, botLink: string) {
    return (
      <div className="refPartnerLinks" aria-label={t("admin.referral.links.aria")}>
        <div className="refPartnerLinks__row">
          <div className="refPartnerLinks__body">
            <span>{t("admin.referral.links.app")}</span>
            <code>{appLink}</code>
          </div>
          <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`app-${item.id}`, appLink)}>
            {copiedLink === `app-${item.id}` ? t("admin.referral.action.copied") : t("admin.referral.action.copy")}
          </button>
        </div>
        {botLink && (
          <div className="refPartnerLinks__row">
            <div className="refPartnerLinks__body">
              <span>{t("admin.referral.links.bot")}</span>
              <code>{botLink}</code>
            </div>
            <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`bot-${item.id}`, botLink)}>
              {copiedLink === `bot-${item.id}` ? t("admin.referral.action.copied") : t("admin.referral.action.copy")}
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderKpis(item: AliasItem, isPartner: boolean, activeTitle: string) {
    const itemStats = stats[item.id];
    const itemAnalytics = analytics[item.id];
    const kpis: Array<{ key: string; label: string; value: string; tone: string; title?: string }> = [
      { key: "visits", label: t("admin.referral.metric.visits"), value: count(item.visits_count || 0), tone: "" },
      { key: "regs", label: t("admin.referral.metric.registrations"), value: count(item.registrations_count || 0), tone: "" },
    ];

    if (isPartner) {
      kpis.push({
        key: "active",
        label: t("admin.referral.metric.active_short"),
        value: statsLoading[item.id] ? "…" : (itemStats ? count(itemStats.activeUsers) : dash),
        tone: "",
        title: activeTitle || undefined,
      });
      if (itemAnalytics?.availability.finance) {
        kpis.push({ key: "result", label: t("admin.referral.metric.result"), value: money(itemAnalytics.finance.result), tone: tone(itemAnalytics.finance.result) });
      }
    } else {
      kpis.push({ key: "conv", label: t("admin.referral.metric.reg_conversion"), value: pct(itemAnalytics?.acquisition.registrationsConversionPct ?? null), tone: "" });
      kpis.push({ key: "cost", label: t("admin.referral.metric.ad_cost"), value: money(itemAnalytics?.finance.adCost ?? null), tone: "" });
      if (itemAnalytics?.availability.finance) {
        kpis.push({ key: "roi", label: t("admin.referral.metric.roi"), value: pct(itemAnalytics.efficiency.roiPct), tone: tone(itemAnalytics.efficiency.roiPct) });
      }
    }

    return (
      <div className="refCard__kpis">
        {kpis.map((kpi) => (
          <span className="refCard__kpi" key={kpi.key} title={kpi.title}>
            <strong className={kpi.tone}>{kpi.value}</strong>
            <span>{kpi.label}</span>
          </span>
        ))}
      </div>
    );
  }

  function renderCard(item: AliasItem) {
    const isPartner = item.link_type === "partner";
    const expanded = expandedId === item.id;
    const itemStats = stats[item.id];
    const itemAnalytics = analytics[item.id];
    const activeTitle = activeStatsTitle(itemStats, t);
    const created = createdLabel(item.created_at);

    return (
      <article className={`refCard${item.enabled ? "" : " is-off"}${expanded ? " is-expanded" : ""}`} key={item.id}>
        <div className="refCard__top">
          <button
            type="button"
            className="refCard__summary"
            onClick={() => setExpandedId(expanded ? null : item.id)}
            aria-expanded={expanded}
            aria-controls={`ref-card-${item.id}`}
          >
            <span className={`refCard__dot${item.enabled ? " is-on" : " is-off"}`} aria-hidden="true" />
            <span className="refCard__identity">
              <span className="refCard__name">{item.alias}</span>
              <span className="refCard__meta">
                {isPartner ? `#${item.partner_id}` : t("admin.referral.detail.type.campaign")}
                {item.campaign_code ? ` · ${item.campaign_code}` : ""}
                {item.billing_comment ? ` · ${item.billing_comment}` : ""}
                {` · ${created}`}
              </span>
            </span>
            {statusChip(item.enabled)}
            <span className="refCard__chevron" aria-hidden="true">{"\u25BE"}</span>
          </button>
        </div>

        {renderKpis(item, isPartner, activeTitle)}

        {expanded && (
          <div className="refCard__details" id={`ref-card-${item.id}`}>
            <span className="refCard__detail">
              <span>{t("admin.referral.detail.type")}</span>
              <strong>{isPartner ? t("admin.referral.detail.type.partner") : t("admin.referral.detail.type.campaign")}</strong>
            </span>
            <span className="refCard__detail">
              <span>{t("admin.referral.detail.created")}</span>
              <strong>{created}</strong>
            </span>
            {isPartner ? (
              <>
                <span className="refCard__detail">
                  <span>{t("admin.referral.field.first_bonus")}</span>
                  <strong>+{item.first_payment_bonus_percent}%</strong>
                </span>
                <span className="refCard__detail">
                  <span>{t("admin.referral.field.reward")}</span>
                  <strong>{item.partner_reward_percent}%</strong>
                </span>
              </>
            ) : (
              <span className="refCard__detail">
                <span>{t("admin.referral.field.ad_cost")}</span>
                <strong>{money(itemAnalytics?.finance.allTimeAdCost ?? null)}</strong>
              </span>
            )}
            <button className="btn btn--soft refCard__detailsBtn" type="button" onClick={() => setInfoItem(item)}>
              {t("admin.referral.action.details")}
            </button>
          </div>
        )}

        <div className="refCard__actions">
          <button className="btn btn--soft" type="button" onClick={() => openAnalytics(item)}>
            {t("admin.referral.action.stats")}
          </button>
          <button
            className="refCard__menuBtn"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuItem?.id === item.id}
            aria-label={t("admin.referral.actions.menu")}
            onClick={(event) => openMenu(item, event.currentTarget)}
          >
            {"\u22EE"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="card"><div className="card__body">
      <AdminSectionHeader
          icon={ADMIN_SECTION_ICON.referralAliases}
        kicker={t("admin.tab.referral")}
        title={t("admin.section.referral.title")}
        subtitle={t("admin.section.referral.subtitle")}
        actions={
          !creating && !editingAlias ? (
            <>
              <button className="btn btn--primary" type="button" onClick={() => createLink("campaign")}>
                {t("admin.referral.action.new_campaign")}
              </button>
              <button className="btn btn--soft" type="button" onClick={() => createLink("partner")}>
                {t("admin.referral.action.new_partner")}
              </button>
            </>
          ) : null
        }
      />

      {(creating || editingAlias) && <>
      <h3 className="h2 admin-gap-top-md">
        {editingAlias
          ? t("admin.referral.edit_title", { alias: editingAlias })
          : form.linkType === "campaign" ? t("admin.referral.create_campaign") : t("admin.referral.create_partner")}
      </h3>
      <p className="p">
        {form.linkType === "campaign"
          ? t("admin.referral.hint.campaign")
          : t("admin.referral.hint.partner")}
      </p>

      <div className="grid2 admin-gap-top-md">
        <label className="field">
          <span className="field__label">{t("admin.referral.field.alias")}</span>
          <input
            className="input"
            value={form.alias}
            placeholder={t("admin.referral.field.alias_ph")}
            disabled={Boolean(editingAlias)}
            onChange={(event) => setForm({
              ...form,
              alias: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
            })}
          />
        </label>

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">{t("admin.referral.field.partner_id")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.partnerId}
            placeholder={t("admin.referral.field.partner_id_ph")}
            onChange={(event) => setForm({ ...form, partnerId: event.target.value.replace(/\D/g, "") })}
          />
        </label>}

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">{t("admin.referral.field.campaign_code")}</span>
          <input
            className="input"
            value={form.campaignCode}
            placeholder={t("admin.referral.field.campaign_code_ph")}
            onChange={(event) => setForm({ ...form, campaignCode: event.target.value })}
          />
        </label>}

        {form.linkType === "campaign" && <label className="field">
          <span className="field__label">{t("admin.referral.field.billing_comment")}</span>
          <input
            className="input"
            value={form.billingComment}
            maxLength={255}
            placeholder={t("admin.referral.field.billing_comment_ph")}
            onChange={(event) => setForm({ ...form, billingComment: event.target.value })}
          />
        </label>}

        {form.linkType === "campaign" && <label className="field">
          <span className="field__label">{t("admin.referral.field.ad_cost")}</span>
          <input
            className="input"
            inputMode="decimal"
            value={form.adCost}
            placeholder={t("admin.referral.field.ad_cost_ph")}
            onChange={(event) => setForm({ ...form, adCost: sanitizeMoneyInput(event.target.value) })}
          />
        </label>}

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">{t("admin.referral.field.first_bonus")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.firstPaymentBonusPercent}
            placeholder={t("admin.referral.field.percent_ph")}
            onChange={(event) => setForm({
              ...form,
              firstPaymentBonusPercent: event.target.value.replace(/\D/g, ""),
            })}
          />
        </label>}

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">{t("admin.referral.field.reward")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.partnerRewardPercent}
            placeholder={t("admin.referral.field.percent_ph")}
            onChange={(event) => setForm({
              ...form,
              partnerRewardPercent: event.target.value.replace(/\D/g, ""),
            })}
          />
        </label>}

        <label className="field">
          <span className="field__label">{t("admin.referral.field.state")}</span>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>{t("admin.referral.field.enabled")}</span>
          </label>
        </label>
      </div>

      <div className="row admin-gap-top-md">
        <button className="btn btn--primary" type="button" onClick={() => void save()}>
          {editingAlias
            ? t("admin.referral.action.save_changes")
            : form.linkType === "campaign" ? t("admin.referral.action.add_campaign") : t("admin.referral.action.add_partner")}
        </button>
        <button className="btn btn--soft" type="button" onClick={clearForm}>{t("common.cancel")}</button>
      </div>
      </>}
      {message && <div className="refPartnerNotice">{message}</div>}

      <div className="refToolbar admin-gap-top-md">
        <input
          className="input refToolbar__search"
          type="search"
          value={query}
          placeholder={t("admin.referral.search.placeholder")}
          aria-label={t("admin.referral.search.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="refToolbar__group" role="group" aria-label={t("admin.referral.filter.status.all")}>
          {(["all", "active", "inactive"] as StatusFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${statusFilter === value ? "chip--ok" : "chip--soft"}`}
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              {t(`admin.referral.filter.status.${value}`)}
            </button>
          ))}
        </div>
        <div className="refToolbar__group" role="group" aria-label={t("admin.referral.filter.type.all")}>
          {(["all", "partner", "campaign"] as TypeFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${typeFilter === value ? "chip--ok" : "chip--soft"}`}
              aria-pressed={typeFilter === value}
              onClick={() => setTypeFilter(value)}
            >
              {t(`admin.referral.filter.type.${value}`)}
            </button>
          ))}
        </div>
        <label className="refToolbar__sort">
          <span>{t("admin.referral.sort.label")}</span>
          <select className="input" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="new">{t("admin.referral.sort.new")}</option>
            <option value="name">{t("admin.referral.sort.name")}</option>
            <option value="visits">{t("admin.referral.sort.visits")}</option>
            <option value="registrations">{t("admin.referral.sort.registrations")}</option>
          </select>
        </label>
      </div>

      {hasFilter && visibleItems.length === 0 ? <p className="p admin-gap-top-md">{t("admin.referral.empty.filtered")}</p> : null}

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">{t("admin.referral.campaigns_title")}</h3>
          {campaignItems.length > 0 && <span className="chip chip--soft">{campaignItems.length}</span>}
        </div>
        <p className="p">{t("admin.referral.campaigns_hint")}</p>
        {campaignItems.length === 0 && !hasFilter && <p className="p">{t("admin.referral.campaigns_empty")}</p>}
        {campaignItems.map((item) => renderCard(item))}
      </div>

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">{t("admin.referral.partners_title")}</h3>
          {partnerItems.length > 0 && <span className="chip chip--soft">{partnerItems.length}</span>}
        </div>
        {partnerItems.length === 0 && !hasFilter && <p className="p">{t("admin.referral.partners_empty")}</p>}
        {partnerItems.map((item) => renderCard(item))}
      </div>

      {infoItem ? (
        <ModalShell
          title={t("admin.referral.detailsModal.title", { alias: infoItem.alias })}
          kicker={infoItem.link_type === "campaign"
            ? t("admin.referral.detail.type.campaign")
            : t("admin.referral.detail.type.partner")}
          onClose={() => setInfoItem(null)}
        >
          <div className="refDetails">
            <section className="refAnalytics__section">
              <h4 className="refAnalytics__title">{t("admin.referral.detailsModal.general")}</h4>
              <InfoRow
                label={t("admin.referral.detail.id")}
                value={infoItem.link_type === "partner" ? `#${infoItem.partner_id}` : infoItem.alias}
              />
              <InfoRow
                label={t("admin.referral.detail.type")}
                value={infoItem.link_type === "campaign"
                  ? t("admin.referral.detail.type.campaign")
                  : t("admin.referral.detail.type.partner")}
              />
              <InfoRow
                label={t("admin.referral.detail.comment")}
                value={(infoItem.link_type === "campaign" ? infoItem.billing_comment : infoItem.campaign_code) || dash}
              />
              <InfoRow
                label={t("admin.referral.detail.status")}
                value={infoItem.enabled ? t("admin.referral.status.active") : t("admin.referral.status.off")}
              />
              <InfoRow label={t("admin.referral.detail.created")} value={createdLabel(infoItem.created_at)} />
            </section>

            <section className="refAnalytics__section">
              <h4 className="refAnalytics__title">{t("admin.referral.detailsModal.links")}</h4>
              {placementLinks(infoItem, buildAppLink(infoItem.alias), buildTelegramBotLink(botUsername, infoItem))}
            </section>

            <section className="refAnalytics__section">
              <h4 className="refAnalytics__title">{t("admin.referral.detailsModal.settings")}</h4>
              {infoItem.link_type === "partner" ? (
                <>
                  <InfoRow label={t("admin.referral.field.first_bonus")} value={`+${infoItem.first_payment_bonus_percent}%`} />
                  <InfoRow label={t("admin.referral.field.reward")} value={`${infoItem.partner_reward_percent}%`} />
                </>
              ) : (
                <InfoRow
                  label={t("admin.referral.field.ad_cost")}
                  value={money(analytics[infoItem.id]?.finance.allTimeAdCost ?? null)}
                />
              )}
            </section>

            <div className="refDetails__actions">
              <button className="btn btn--primary" type="button" onClick={() => { setInfoItem(null); edit(infoItem); }}>
                {t("common.edit")}
              </button>
              <button className="btn btn--soft" type="button" onClick={() => void loadStats(infoItem)}>
                {t("common.refresh")}
              </button>
              <button className="btn refPartnerCard__delete" type="button" onClick={() => void confirmRemove(infoItem)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {analyticsItem ? (
        <ModalShell
          title={t("admin.referral.details.title", { alias: analyticsItem.alias })}
          kicker={analyticsItem.link_type === "campaign"
            ? t("admin.referral.detail.type.campaign")
            : t("admin.referral.detail.type.partner")}
          onClose={() => setAnalyticsItem(null)}
        >
          <div className="refAnalytics">
            <div className="refAnalytics__periods" role="group" aria-label={t("admin.referral.period.label")}>
              {ANALYTICS_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`chip ${analyticsPeriod === period ? "chip--ok" : "chip--soft"}`}
                  aria-pressed={analyticsPeriod === period}
                  onClick={() => setAnalyticsPeriod(period)}
                >
                  {t(`admin.referral.period.${period}`)}
                </button>
              ))}
            </div>
            <p className="refAnalytics__note">{t("admin.referral.period.model")}</p>

            {analyticsLoading ? (
              <p className="p">{t("common.loading")}</p>
            ) : !analyticsData ? (
              <p className="p">{t("admin.referral.details.empty")}</p>
            ) : (
              <>
                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.funnel")}</h4>
                  <InfoRow label={t("admin.referral.metric.visits")} value={count(analyticsData.acquisition.clicks)} />
                  {analyticsData.availability.clicksPeriodLimited ? (
                    <InfoRow label={t("admin.referral.metric.clicks_all_time")} value={count(analyticsData.acquisition.allTimeClicks)} />
                  ) : null}
                  <InfoRow label={t("admin.referral.metric.registrations")} value={count(analyticsData.acquisition.registrations)} />
                  <InfoRow label={t("admin.referral.metric.paying")} value={count(analyticsData.acquisition.payingUsers)} />
                  <InfoRow label={t("admin.referral.metric.first_topup")} value={count(analyticsData.acquisition.firstTopups)} />
                  <InfoRow label={t("admin.referral.metric.reg_conversion")} value={pct(analyticsData.acquisition.registrationsConversionPct)} />
                  <InfoRow label={t("admin.referral.metric.paying_conversion")} value={pct(analyticsData.acquisition.payingConversionPct)} />
                  {analyticsData.availability.clicksPeriodLimited ? (
                    <p className="refAnalytics__note">{t("admin.referral.period.clicks_note")}</p>
                  ) : null}
                </section>

                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.finance")}</h4>
                  <InfoRow label={t("admin.referral.metric.total_topups")} value={money(analyticsData.finance.totalTopups)} />
                  <InfoRow label={t("admin.referral.metric.service_revenue")} value={money(analyticsData.finance.serviceRevenue)} />
                  <InfoRow label={t("admin.referral.metric.bonus_debits")} value={money(analyticsData.finance.bonusDebits)} />
                  <InfoRow label={t("admin.referral.metric.ad_cost")} value={money(analyticsData.finance.adCost)} />
                  {analyticsData.availability.adCostPeriodLimited && analyticsData.finance.allTimeAdCost !== null ? (
                    <InfoRow label={t("admin.referral.metric.ad_cost_all_time")} value={money(analyticsData.finance.allTimeAdCost)} />
                  ) : null}
                  <InfoRow label={t("admin.referral.metric.commission_accrued")} value={money(analyticsData.finance.partnerCommissionAccrued)} />
                  <InfoRow label={t("admin.referral.metric.commission_paid")} value={money(analyticsData.finance.partnerCommissionPaid)} />
                  <InfoRow label={t("admin.referral.metric.acquisition_cost")} value={money(analyticsData.finance.acquisitionCost)} />
                  <InfoRow label={t("admin.referral.metric.result")} value={money(analyticsData.finance.result)} tone={tone(analyticsData.finance.result)} />
                  {analyticsData.availability.adCostPeriodLimited ? (
                    <p className="refAnalytics__note">{t("admin.referral.period.ad_cost_note")}</p>
                  ) : null}
                  {!analyticsData.availability.finance ? (
                    <p className="refAnalytics__note refAnalytics__note--warn">{t("admin.referral.finance.unavailable")}</p>
                  ) : null}
                </section>

                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.efficiency")}</h4>
                  <InfoRow label={t("admin.referral.metric.cac")} value={money(analyticsData.efficiency.cac)} />
                  <InfoRow label={t("admin.referral.metric.arppu")} value={money(analyticsData.efficiency.arppu)} />
                  <InfoRow label={t("admin.referral.metric.roas")} value={pct(analyticsData.efficiency.roasPct)} />
                  <InfoRow label={t("admin.referral.metric.roi")} value={pct(analyticsData.efficiency.roiPct)} tone={tone(analyticsData.efficiency.roiPct)} />
                </section>
              </>
            )}
          </div>
        </ModalShell>
      ) : null}

      <ActionMenu
        anchorEl={menuAnchor}
        open={Boolean(menuItem && menuAnchor)}
        onClose={() => { setMenuItem(null); setMenuAnchor(null); }}
        items={menuItem ? [
          { label: t("admin.referral.action.details"), onClick: () => setInfoItem(menuItem) },
          { label: t("common.refresh"), onClick: () => { void loadStats(menuItem); } },
          { label: t("common.edit"), onClick: () => edit(menuItem) },
          { label: t("common.delete"), danger: true, onClick: () => { void confirmRemove(menuItem); } },
        ] : []}
      />
    </div></div>
  );
}

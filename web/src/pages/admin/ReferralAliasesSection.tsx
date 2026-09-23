import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { refreshAdminOverview } from "../../app/notifications/adminOverview";
import { AdminSectionHeader, ADMIN_SECTION_ICON, ModalShell } from "./shared";

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

function AnalyticsRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="refAnalytics__row">
      <span>{label}</span>
      <strong className={`refAnalytics__value${tone ?? ""}`}>{value}</strong>
    </div>
  );
}

export function ReferralAliasesSection() {
  const { t, formatCurrency, formatNumber } = useI18n();
  const [items, setItems] = useState<AliasItem[]>([]);
  const [form, setForm] = useState<PartnerForm>(createEmptyForm);
  const [editingAlias, setEditingAlias] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<Record<number, PartnerStats>>({});
  const [statsLoading, setStatsLoading] = useState<Record<number, boolean>>({});
  const [analytics, setAnalytics] = useState<Record<number, ReferralAnalytics>>({});
  const [detailsItem, setDetailsItem] = useState<AliasItem | null>(null);
  const [detailsPeriod, setDetailsPeriod] = useState<AnalyticsPeriod>("all");
  const [detailsAnalytics, setDetailsAnalytics] = useState<ReferralAnalytics | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState("");
  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  async function fetchAnalytics(period: AnalyticsPeriod): Promise<ReferralAnalytics[]> {
    const response = await apiFetch<{ ok: true; items: ReferralAnalytics[] }>(
      `/admin/referral-aliases/analytics?period=${period}`,
      { method: "GET" }
    );
    return Array.isArray(response.items) ? response.items : [];
  }

  // Details view: refetch when the alias or period changes. Cancellation avoids
  // a stale response overwriting a newer period selection.
  useEffect(() => {
    if (!detailsItem) return;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsAnalytics(null);
    fetchAnalytics(detailsPeriod)
      .then((rows) => {
        if (!cancelled) setDetailsAnalytics(rows.find((row) => row.aliasId === detailsItem.id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetailsAnalytics(null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => { cancelled = true; };
  }, [detailsItem, detailsPeriod]);

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

  const campaignItems = items.filter((item) => item.link_type === "campaign");
  const partnerItems = items.filter((item) => item.link_type !== "campaign");

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
        <div className="refPartnerLinks__title">{t("admin.referral.links.title")}</div>
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

  const dash = "—";
  const money = (value: number | null) => (value === null ? dash : formatCurrency(value));
  const count = (value: number | null) => (value === null ? dash : formatNumber(value));
  const pct = (value: number | null) =>
    value === null ? dash : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const tone = (value: number | null) =>
    value === null || value === 0 ? "" : value > 0 ? " is-positive" : " is-negative";

  function openDetails(item: AliasItem) {
    setDetailsPeriod("all");
    setDetailsItem(item);
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

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">{t("admin.referral.campaigns_title")}</h3>
          {campaignItems.length > 0 && <span className="chip chip--soft">{campaignItems.length}</span>}
        </div>
        <p className="p">{t("admin.referral.campaigns_hint")}</p>
        {campaignItems.length === 0 && <p className="p">{t("admin.referral.campaigns_empty")}</p>}
        {campaignItems.map((item) => {
          const itemStats = stats[item.id];
          const itemAnalytics = analytics[item.id];
          const appLink = buildAppLink(item.alias);
          const botLink = buildTelegramBotLink(botUsername, item);
          return (
          <article className="refPartnerCard" key={item.id}>
            <div className="refPartnerCard__head">
              <div className="refPartnerCard__identity">
                <span className="refPartnerCard__eyebrow">{t("admin.referral.eyebrow.campaign")}</span>
                <strong className="refPartnerCard__title">{item.alias}</strong>
                <span className="refPartnerCard__campaign">{t("admin.referral.comment", { text: item.billing_comment || "—" })}</span>
              </div>
              {statusChip(item.enabled)}
            </div>
            {placementLinks(item, appLink, botLink)}
            <div className="refPartnerCard__metrics">
              <div className="refPartnerCard__metric">
                <span>{t("admin.referral.metric.visits")}</span>
                <strong>{item.visits_count || 0}</strong>
              </div>
              <div className="refPartnerCard__metric refPartnerCard__metric--active">
                <span>{t("admin.referral.metric.comments")}</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats ? itemStats.totalUsers : item.registrations_count || 0}
                </strong>
              </div>
            </div>
            {itemAnalytics ? (
              <div
                className="refPartnerCard__finance"
                title={itemAnalytics.availability.finance ? undefined : t("admin.referral.finance.unavailable")}
              >
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.reg_conversion")}</span>
                  <strong>{pct(itemAnalytics.acquisition.registrationsConversionPct)}</strong>
                </div>
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.ad_cost")}</span>
                  <strong>{money(itemAnalytics.finance.adCost)}</strong>
                </div>
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.roi")}</span>
                  <strong className={tone(itemAnalytics.efficiency.roiPct)}>{pct(itemAnalytics.efficiency.roiPct)}</strong>
                </div>
              </div>
            ) : null}
            <div className="refPartnerCard__actions">
              <button className="btn btn--soft" type="button" onClick={() => openDetails(item)}>{t("admin.referral.action.stats")}</button>
              <button className="btn btn--soft" type="button" onClick={() => edit(item)}>{t("common.edit")}</button>
              <button
                className="btn btn--soft"
                type="button"
                disabled={Boolean(statsLoading[item.id])}
                onClick={() => void loadStats(item)}
              >
                {t("common.refresh")}
              </button>
              <button className="btn refPartnerCard__delete" type="button" onClick={() => void remove(item.id)}>{t("common.delete")}</button>
            </div>
          </article>
          );
        })}
      </div>

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">{t("admin.referral.partners_title")}</h3>
          {partnerItems.length > 0 && <span className="chip chip--soft">{partnerItems.length}</span>}
        </div>
        {partnerItems.length === 0 && <p className="p">{t("admin.referral.partners_empty")}</p>}
        {partnerItems.map((item) => {
          const itemStats = stats[item.id];
          const itemAnalytics = analytics[item.id];
          const activeTitle = activeStatsTitle(itemStats, t);
          const appLink = buildAppLink(item.alias);
          const botLink = buildTelegramBotLink(botUsername, item);
          return (
          <article className="refPartnerCard" key={item.id}>
            <div className="refPartnerCard__head">
              <div className="refPartnerCard__identity">
                <span className="refPartnerCard__eyebrow">{t("admin.referral.eyebrow.partner", { id: item.partner_id })}</span>
                <strong className="refPartnerCard__title">{item.alias}</strong>
                {item.campaign_code && (
                  <span className="refPartnerCard__campaign">{item.campaign_code}</span>
                )}
              </div>
              {statusChip(item.enabled)}
            </div>
            {placementLinks(item, appLink, botLink)}

            <div className="refPartnerCard__metrics">
              <div className="refPartnerCard__metric">
                <span>{t("admin.referral.metric.first_topup")}</span>
                <strong>+{item.first_payment_bonus_percent}%</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>{t("admin.referral.metric.to_partner")}</span>
                <strong>{item.partner_reward_percent}%</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>{t("admin.referral.metric.visits")}</span>
                <strong>{item.visits_count || 0}</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>{t("admin.referral.metric.billing_clients")}</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats
                      ? itemStats.totalUsers
                      : "—"}
                </strong>
              </div>
              <div className="refPartnerCard__metric refPartnerCard__metric--active" title={activeTitle || undefined}>
                <span>{t("admin.referral.metric.active_services")}</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats
                      ? itemStats.activeUsers
                      : "—"}
                </strong>
              </div>
            </div>

            {itemAnalytics ? (
              <div
                className="refPartnerCard__finance"
                title={itemAnalytics.availability.finance ? undefined : t("admin.referral.finance.unavailable")}
              >
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.registrations")}</span>
                  <strong>{count(itemAnalytics.acquisition.registrations)}</strong>
                </div>
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.commission_accrued")}</span>
                  <strong>{money(itemAnalytics.finance.partnerCommissionAccrued)}</strong>
                </div>
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.commission_paid")}</span>
                  <strong>{money(itemAnalytics.finance.partnerCommissionPaid)}</strong>
                </div>
                <div className="refPartnerCard__financeItem">
                  <span>{t("admin.referral.metric.result")}</span>
                  <strong className={tone(itemAnalytics.finance.result)}>{money(itemAnalytics.finance.result)}</strong>
                </div>
              </div>
            ) : null}

            <div className="refPartnerCard__actions">
              <button className="btn btn--soft" type="button" onClick={() => openDetails(item)}>{t("admin.referral.action.stats")}</button>
              <button
                className="btn btn--soft"
                type="button"
                disabled={Boolean(statsLoading[item.id])}
                onClick={() => void loadStats(item)}
              >
                {t("common.refresh")}
              </button>
              <button className="btn btn--soft" type="button" onClick={() => edit(item)}>{t("common.edit")}</button>
              <button className="btn refPartnerCard__delete" type="button" onClick={() => void remove(item.id)}>{t("common.delete")}</button>
            </div>
          </article>
        )})}
      </div>

      {detailsItem ? (
        <ModalShell
          title={t("admin.referral.details.title", { alias: detailsItem.alias })}
          kicker={detailsItem.link_type === "campaign"
            ? t("admin.referral.eyebrow.campaign")
            : t("admin.referral.eyebrow.partner", { id: detailsItem.partner_id })}
          onClose={() => setDetailsItem(null)}
        >
          <div className="refAnalytics">
            <div className="refAnalytics__periods" role="group" aria-label={t("admin.referral.period.label")}>
              {ANALYTICS_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`chip ${detailsPeriod === period ? "chip--ok" : "chip--soft"}`}
                  aria-pressed={detailsPeriod === period}
                  onClick={() => setDetailsPeriod(period)}
                >
                  {t(`admin.referral.period.${period}`)}
                </button>
              ))}
            </div>
            <p className="refAnalytics__note">{t("admin.referral.period.model")}</p>

            {detailsLoading ? (
              <p className="p">{t("common.loading")}</p>
            ) : !detailsAnalytics ? (
              <p className="p">{t("admin.referral.details.empty")}</p>
            ) : (
              <>
                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.funnel")}</h4>
                  <AnalyticsRow label={t("admin.referral.metric.visits")} value={count(detailsAnalytics.acquisition.clicks)} />
                  {detailsAnalytics.availability.clicksPeriodLimited ? (
                    <AnalyticsRow label={t("admin.referral.metric.clicks_all_time")} value={count(detailsAnalytics.acquisition.allTimeClicks)} />
                  ) : null}
                  <AnalyticsRow label={t("admin.referral.metric.registrations")} value={count(detailsAnalytics.acquisition.registrations)} />
                  <AnalyticsRow label={t("admin.referral.metric.paying")} value={count(detailsAnalytics.acquisition.payingUsers)} />
                  <AnalyticsRow label={t("admin.referral.metric.first_topup")} value={count(detailsAnalytics.acquisition.firstTopups)} />
                  <AnalyticsRow label={t("admin.referral.metric.reg_conversion")} value={pct(detailsAnalytics.acquisition.registrationsConversionPct)} />
                  <AnalyticsRow label={t("admin.referral.metric.paying_conversion")} value={pct(detailsAnalytics.acquisition.payingConversionPct)} />
                  {detailsAnalytics.availability.clicksPeriodLimited ? (
                    <p className="refAnalytics__note">{t("admin.referral.period.clicks_note")}</p>
                  ) : null}
                </section>

                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.finance")}</h4>
                  <AnalyticsRow label={t("admin.referral.metric.total_topups")} value={money(detailsAnalytics.finance.totalTopups)} />
                  <AnalyticsRow label={t("admin.referral.metric.service_revenue")} value={money(detailsAnalytics.finance.serviceRevenue)} />
                  <AnalyticsRow label={t("admin.referral.metric.bonus_debits")} value={money(detailsAnalytics.finance.bonusDebits)} />
                  <AnalyticsRow label={t("admin.referral.metric.ad_cost")} value={money(detailsAnalytics.finance.adCost)} />
                  {detailsAnalytics.availability.adCostPeriodLimited && detailsAnalytics.finance.allTimeAdCost !== null ? (
                    <AnalyticsRow label={t("admin.referral.metric.ad_cost_all_time")} value={money(detailsAnalytics.finance.allTimeAdCost)} />
                  ) : null}
                  <AnalyticsRow label={t("admin.referral.metric.commission_accrued")} value={money(detailsAnalytics.finance.partnerCommissionAccrued)} />
                  <AnalyticsRow label={t("admin.referral.metric.commission_paid")} value={money(detailsAnalytics.finance.partnerCommissionPaid)} />
                  <AnalyticsRow label={t("admin.referral.metric.acquisition_cost")} value={money(detailsAnalytics.finance.acquisitionCost)} />
                  <AnalyticsRow label={t("admin.referral.metric.result")} value={money(detailsAnalytics.finance.result)} tone={tone(detailsAnalytics.finance.result)} />
                  {detailsAnalytics.availability.adCostPeriodLimited ? (
                    <p className="refAnalytics__note">{t("admin.referral.period.ad_cost_note")}</p>
                  ) : null}
                  {!detailsAnalytics.availability.finance ? (
                    <p className="refAnalytics__note refAnalytics__note--warn">{t("admin.referral.finance.unavailable")}</p>
                  ) : null}
                </section>

                <section className="refAnalytics__section">
                  <h4 className="refAnalytics__title">{t("admin.referral.section.efficiency")}</h4>
                  <AnalyticsRow label={t("admin.referral.metric.cac")} value={money(detailsAnalytics.efficiency.cac)} />
                  <AnalyticsRow label={t("admin.referral.metric.arppu")} value={money(detailsAnalytics.efficiency.arppu)} />
                  <AnalyticsRow label={t("admin.referral.metric.roas")} value={pct(detailsAnalytics.efficiency.roasPct)} />
                  <AnalyticsRow label={t("admin.referral.metric.roi")} value={pct(detailsAnalytics.efficiency.roiPct)} tone={tone(detailsAnalytics.efficiency.roiPct)} />
                </section>
              </>
            )}
          </div>
        </ModalShell>
      ) : null}
    </div></div>
  );
}
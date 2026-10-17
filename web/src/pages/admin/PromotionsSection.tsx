import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, ADMIN_SECTION_ICON } from "./shared";

type PromotionCatalogItem = {
  campaignId: "return15" | "first_pay" | "review_reward";
  kind: "return" | "first_pay" | "review";
  billingConnected: boolean;
  billingActive: boolean;
  billingReason?: string;
  enabled: boolean;
  priority: number;
  description: string;
  code?: string;
  percent?: number;
  inactiveDays?: number;
  tariffDays?: number;
  amount?: number;
};

type CatalogResponse = {
  ok: true;
  source: "billing";
  scannedAt: string;
  items: PromotionCatalogItem[];
};

const PRIORITIES = [10, 20, 30] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function PromotionsSection() {
  const { t, formatNumber, formatDate } = useI18n();
  const [items, setItems] = useState<PromotionCatalogItem[]>([]);
  const [scannedAt, setScannedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<CatalogResponse>("/admin/promo-catalog", { method: "GET" });
      setItems(response.items);
      setDescriptionDrafts(Object.fromEntries(response.items.map((item) => [item.campaignId, item.description || ""])));
      setScannedAt(response.scannedAt);
    } catch (cause) {
      setError(errorMessage(cause, t("admin.promotions.error.load")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(item: PromotionCatalogItem, patch: Partial<Pick<PromotionCatalogItem, "enabled" | "priority" | "description">>) {
    const next = { ...item, ...patch };
    setBusyId(item.campaignId);
    setError("");
    setItems((current) => current.map((entry) => entry.campaignId === item.campaignId ? next : entry));
    try {
      await apiFetch(`/admin/promo-catalog/${item.campaignId}`, {
        method: "PATCH",
        body: { enabled: next.enabled, priority: next.priority, description: next.description },
      });
      setItems((current) => [...current].sort((left, right) => left.priority - right.priority));
    } catch (cause) {
      setItems((current) => current.map((entry) => entry.campaignId === item.campaignId ? item : entry));
      setError(errorMessage(cause, t("admin.promotions.error.save")));
    } finally {
      setBusyId(null);
    }
  }

  function title(item: PromotionCatalogItem) {
    if (item.kind === "return") return item.code
      ? t("admin.promotions.return.title", { code: item.code })
      : t("admin.promotions.return.missing");
    if (item.kind === "first_pay") return t("admin.promotions.first_pay.title");
    return t("admin.promotions.review.title");
  }

  function description(item: PromotionCatalogItem) {
    if (item.kind === "return") {
      return t("admin.promotions.return.description", {
        percent: item.percent ?? 15,
        days: item.tariffDays ?? 7,
        inactiveDays: item.inactiveDays ?? 30,
      });
    }
    if (item.kind === "first_pay") return t("admin.promotions.first_pay.description");
    return t("admin.promotions.review.description", { amount: formatNumber(item.amount ?? 0) });
  }

  const scannedLabel = scannedAt
    ? t("admin.promotions.scanned", { time: formatDate(scannedAt, { hour: "2-digit", minute: "2-digit" }) })
    : "";

  return (
    <div className="card"><div className="card__body">
      <AdminSectionHeader
        icon={ADMIN_SECTION_ICON.promotions}
        kicker={t("admin.tab.promotions")}
        title={t("admin.promotions.title")}
        subtitle={t("admin.promotions.subtitle")}
        actions={
          <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || busyId !== null}>
            {t("admin.promotions.refresh")}
          </button>
        }
      />

      <div className="admin-promoSource admin-gap-top-md">
        <span className="chip chip--ok">{t("admin.promotions.source.billing")}</span>
        {scannedLabel ? <span>{scannedLabel}</span> : null}
      </div>

      {error ? <div className="pre admin-gap-top-md" role="alert">{error}</div> : null}

      {loading ? (
        <div className="list admin-gap-top-md" aria-busy="true"><div className="skeleton h1" /><div className="skeleton p" /></div>
      ) : (
        <div className="list admin-gap-top-md">
          {items.map((item) => {
            const busy = busyId !== null;
            const descriptionDraft = descriptionDrafts[item.campaignId] ?? item.description ?? "";
            return (
              <article className={`list__item admin-promoCard${item.enabled ? "" : " is-disabled"}`} key={item.campaignId}>
                <div className="admin-promoCard__head">
                  <div className="list__main">
                    <div className="list__title">{title(item)}</div>
                    <div className="list__sub">{description(item)}</div>
                  </div>
                  <span className={`chip ${item.billingActive ? "chip--ok" : "chip--warn"}`}>
                    {!item.billingConnected
                      ? t("admin.promotions.not_connected")
                      : item.billingActive
                        ? t("admin.promotions.active")
                        : t("admin.promotions.inactive")}
                  </span>
                </div>

                <div className="admin-promoCard__controls">
                  <label className="admin-pushToggle admin-promoCard__toggle">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      disabled={busy || !item.billingConnected}
                      onChange={(event) => void save(item, { enabled: event.target.checked })}
                    />
                    <span className={`admin-pushToggle__track${item.enabled ? " is-on" : ""}`} aria-hidden="true" />
                    <span>
                      <strong>{item.enabled ? t("admin.promotions.visible") : t("admin.promotions.hidden")}</strong>
                      <small>{t("admin.promotions.visibility_hint")}</small>
                    </span>
                  </label>

                  <label className="admin-promoCard__priority">
                    <span>{t("admin.promotions.priority")}</span>
                    <select
                      className="input"
                      value={item.priority}
                      disabled={busy || !item.billingConnected}
                      onChange={(event) => void save(item, { priority: Number(event.target.value) })}
                    >
                      {PRIORITIES.map((priority, index) => (
                        <option key={priority} value={priority}>{index + 1}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <details className="admin-promoCard__editor">
                  <summary>{t("admin.promotions.description.label")}</summary>
                  <label htmlFor={`promotion-description-${item.campaignId}`} className="admin-fieldHint">
                    {t("admin.promotions.description.hint")}
                  </label>
                  <textarea
                    id={`promotion-description-${item.campaignId}`}
                    className="input"
                    rows={3}
                    maxLength={280}
                    value={descriptionDraft}
                    disabled={busy}
                    placeholder={t("admin.promotions.description.placeholder")}
                    onChange={(event) => setDescriptionDrafts((current) => ({ ...current, [item.campaignId]: event.target.value }))}
                  />
                  <div className="admin-promoCard__editorActions">
                    <span className="admin-fieldHint">{descriptionDraft.length}/280</span>
                    <button
                      className="btn btn--soft"
                      type="button"
                      disabled={busy || descriptionDraft.trim() === (item.description || "")}
                      onClick={() => void save(item, { description: descriptionDraft.trim() })}
                    >
                      {t("admin.promotions.description.save")}
                    </button>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <p className="admin-fieldHint admin-gap-top-md">{t("admin.promotions.safe_note")}</p>
    </div></div>
  );
}

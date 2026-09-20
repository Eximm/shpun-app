// web/src/pages/admin/OrderRulesSection.tsx

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, ADMIN_SECTION_ICON } from "./shared";
import type { AdminSettingsResp, AdminSettingsSaveResp, OrderBlockMode } from "./types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function OrderRulesSection() {
  const { t } = useI18n();
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [mode,      setMode]      = useState<OrderBlockMode>("off");
  const [savedMode, setSavedMode] = useState<OrderBlockMode>("off");
  const [error,     setError]     = useState<string | null>(null);
  const [okText,    setOkText]    = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null); setOkText(null);
    try {
      const r = await apiFetch<AdminSettingsResp>("/admin/settings", { method: "GET" });
      const next: OrderBlockMode = r?.settings?.orderBlockMode || "off";
      setMode(next); setSavedMode(next);
    } catch (e: unknown) { setError(errorMessage(e, t("admin.orders.load_failed"))); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true); setError(null); setOkText(null);
    try {
      const r = await apiFetch<AdminSettingsSaveResp>("/admin/settings/order-rules", {
        method: "PUT",
        body: { orderBlockMode: mode },
      });
      const next: OrderBlockMode = r?.orderBlockMode || mode;
      setMode(next); setSavedMode(next);
      setOkText(t("admin.orders.saved"));
    } catch (e: unknown) { setError(errorMessage(e, t("admin.orders.save_failed"))); }
    finally { setSaving(false); }
  }

  const changed = mode !== savedMode;

  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          icon={ADMIN_SECTION_ICON.orderRules}
          kicker={t("admin.tab.orders")}
          title={t("admin.section.orders.title")}
          subtitle={t("admin.section.orders.subtitle")}
          actions={
            <>
              <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || saving}>
                {t("common.refresh")}
              </button>
              <button className="btn btn--accent" type="button" onClick={() => void save()} disabled={saving || !changed}>
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </>
          }
        />

        {loading ? (
          <div className="list admin-gap-top-md">
            <div className="skeleton h1" />
            <div className="skeleton p" />
          </div>
        ) : (
          <>
            <div className="admin-choiceRow admin-gap-top-md">
              {([
                { value: "off",       label: t("admin.orders.opt.off") },
                { value: "same_type", label: t("admin.orders.opt.same_type") },
                { value: "any",       label: t("admin.orders.opt.any") },
              ] as { value: OrderBlockMode; label: string }[]).map(({ value, label }) => (
                <label key={value} className="admin-radio admin-radio--last">
                  <input type="radio" name="orderBlockMode" value={value}
                    checked={mode === value} onChange={() => setMode(value)} />
                  {" "}<strong>{value}</strong> — {label}
                </label>
              ))}
            </div>

            <p className="p admin-gap-top-sm">{t("admin.orders.backend_note")}</p>

            {error  && <div className="pre admin-gap-top-md">{error}</div>}
            {okText && <div className="pre admin-gap-top-md">{okText}</div>}
          </>
        )}
      </div>
    </div>
  );
}
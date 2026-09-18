// web/src/pages/admin/OrderRulesSection.tsx

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { AdminSectionHeader } from "./shared";
import type { AdminSettingsResp, AdminSettingsSaveResp, OrderBlockMode } from "./types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function OrderRulesSection() {
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
    } catch (e: unknown) { setError(errorMessage(e, "Не удалось загрузить настройки.")); }
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
      setOkText("Настройка сохранена.");
    } catch (e: unknown) { setError(errorMessage(e, "Не удалось сохранить настройку.")); }
    finally { setSaving(false); }
  }

  const changed = mode !== savedMode;

  return (
    <div className="card">
      <div className="card__body">
        <AdminSectionHeader
          kicker="Order rules"
          title="Правила оформления услуг"
          subtitle="Ограничение новых заказов при наличии неоплаченных услуг."
          actions={
            <>
              <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || saving}>
                Обновить
              </button>
              <button className="btn btn--accent" type="button" onClick={() => void save()} disabled={saving || !changed}>
                {saving ? "Сохраняю…" : "Сохранить"}
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
                { value: "off",       label: "не ограничивать новые заказы" },
                { value: "same_type", label: "блок только того же типа" },
                { value: "any",       label: "блок любых новых заказов" },
              ] as { value: OrderBlockMode; label: string }[]).map(({ value, label }) => (
                <label key={value} className="admin-radio admin-radio--last">
                  <input type="radio" name="orderBlockMode" value={value}
                    checked={mode === value} onChange={() => setMode(value)} />
                  {" "}<strong>{value}</strong> — {label}
                </label>
              ))}
            </div>

            <p className="p admin-gap-top-sm">Проверка идёт на backend в момент создания заказа.</p>

            {error  && <div className="pre admin-gap-top-md">{error}</div>}
            {okText && <div className="pre admin-gap-top-md">{okText}</div>}
          </>
        )}
      </div>
    </div>
  );
}
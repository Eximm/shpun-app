// web/src/pages/admin/OrderRulesSection.tsx

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import type { AdminSettingsResp, AdminSettingsSaveResp, OrderBlockMode } from "./types";

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
    } catch (e: any) { setError(e?.message || "Не удалось загрузить настройки."); }
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
    } catch (e: any) { setError(e?.message || "Не удалось сохранить настройку."); }
    finally { setSaving(false); }
  }

  const changed = mode !== savedMode;

  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Order rules</div>
        <h2 className="h2">Правила оформления услуг</h2>
        <p className="p">Управление ограничением новых заказов при наличии неоплаченных услуг.</p>

        {loading ? (
          <div className="list admin-gap-top-md">
            <div className="skeleton h1" />
            <div className="skeleton p" />
            <div className="skeleton p" />
          </div>
        ) : (
          <>
            <div className="list admin-gap-top-md">
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">Режим блокировки</div>
                  <div className="list__sub admin-gap-top-sm">
                    {([
                      { value: "off",       label: "не ограничивать новые заказы" },
                      { value: "same_type", label: "блок только того же типа" },
                      { value: "any",       label: "блок любых новых заказов" },
                    ] as { value: OrderBlockMode; label: string }[]).map(({ value, label }, idx, arr) => (
                      <label key={value} className={`admin-radio${idx === arr.length - 1 ? " admin-radio--last" : ""}`}>
                        <input type="radio" name="orderBlockMode" value={value}
                          checked={mode === value} onChange={() => setMode(value)} />
                        {" "}<strong>{value}</strong> — {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">{savedMode}</span>
                </div>
              </div>

              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">Как это работает</div>
                  <div className="list__sub">Проверка идёт на backend в момент создания заказа.</div>
                </div>
              </div>
            </div>

            {error  && <div className="pre admin-gap-top-md">{error}</div>}
            {okText && <div className="pre admin-gap-top-md">{okText}</div>}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading || saving}>
                Обновить
              </button>
              <button className="btn btn--accent" type="button" onClick={() => void save()} disabled={saving || !changed}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
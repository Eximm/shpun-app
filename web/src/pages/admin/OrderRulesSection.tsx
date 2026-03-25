import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import type { AdminSettingsResp, AdminSettingsSaveResp, OrderBlockMode } from "./types";

export function OrderRulesSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<OrderBlockMode>("off");
  const [savedMode, setSavedMode] = useState<OrderBlockMode>("off");
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<AdminSettingsResp>("/admin/settings", { method: "GET" });
      const nextMode: OrderBlockMode = r?.settings?.orderBlockMode || "off";
      setMode(nextMode);
      setSavedMode(nextMode);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить настройки.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<AdminSettingsSaveResp>("/admin/settings/order-rules", {
        method: "PUT",
        body: { orderBlockMode: mode },
      });

      const nextMode: OrderBlockMode = r?.orderBlockMode || mode;
      setMode(nextMode);
      setSavedMode(nextMode);
      setOkText("Настройка сохранена.");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить настройку.");
    } finally {
      setSaving(false);
    }
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
                    <label className="admin-radio">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="off"
                        checked={mode === "off"}
                        onChange={() => setMode("off")}
                      />{" "}
                      <strong>off</strong> — не ограничивать новые заказы
                    </label>

                    <label className="admin-radio">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="same_type"
                        checked={mode === "same_type"}
                        onChange={() => setMode("same_type")}
                      />{" "}
                      <strong>same_type</strong> — блок только того же типа
                    </label>

                    <label className="admin-radio admin-radio--last">
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="any"
                        checked={mode === "any"}
                        onChange={() => setMode("any")}
                      />{" "}
                      <strong>any</strong> — блок любых новых заказов
                    </label>
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

            {error ? <div className="pre admin-gap-top-md">{error}</div> : null}
            {okText ? <div className="pre admin-gap-top-md">{okText}</div> : null}

            <div className="actions actions--2 admin-gap-top-md">
              <button className="btn btn--soft" type="button" onClick={load} disabled={loading || saving}>
                Обновить
              </button>
              <button className="btn btn--accent" type="button" onClick={save} disabled={saving || !changed}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
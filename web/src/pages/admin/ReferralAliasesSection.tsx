import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

type AliasItem = {
  id: number;
  alias: string;
  partner_id: number;
  campaign_code: string | null;
  first_payment_bonus_percent: number;
  partner_reward_percent: number;
  enabled: boolean;
  visits_count: number;
  registrations_count: number;
};

type PartnerForm = {
  alias: string;
  partnerId: string;
  campaignCode: string;
  firstPaymentBonusPercent: string;
  partnerRewardPercent: string;
  enabled: boolean;
};

const createEmptyForm = (): PartnerForm => ({
  alias: "",
  partnerId: "",
  campaignCode: "",
  firstPaymentBonusPercent: "",
  partnerRewardPercent: "",
  enabled: true,
});

export function ReferralAliasesSection() {
  const [items, setItems] = useState<AliasItem[]>([]);
  const [form, setForm] = useState<PartnerForm>(createEmptyForm);
  const [editingAlias, setEditingAlias] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await apiFetch<{ ok: true; items: AliasItem[] }>(
      "/admin/referral-aliases",
      { method: "GET" }
    );
    setItems(response.items);
  }

  useEffect(() => { void load(); }, []);

  function clearForm() {
    setForm(createEmptyForm());
    setEditingAlias("");
    setMessage("");
  }

  function edit(item: AliasItem) {
    setEditingAlias(item.alias);
    setForm({
      alias: item.alias,
      partnerId: String(item.partner_id),
      campaignCode: item.campaign_code || "",
      firstPaymentBonusPercent: String(item.first_payment_bonus_percent),
      partnerRewardPercent: String(item.partner_reward_percent),
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
        },
      });
      clearForm();
      await load();
      setMessage("Партнёр сохранён.");
    } catch (error: any) {
      setMessage(error?.message || "Не удалось сохранить партнёра.");
    }
  }

  async function remove(id: number) {
    await apiFetch(`/admin/referral-aliases/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="card"><div className="card__body">
      <div className="kicker">Партнёрские кампании</div>
      <h2 className="h1">{editingAlias ? "Редактирование партнёра" : "Новый партнёр"}</h2>
      <p className="p">
        Создайте произвольную ссылку и задайте индивидуальные условия. Пустой процент означает 0%.
      </p>

      <div className="grid admin-gap-top-md">
        <label className="field">
          <span className="field__label">Имя ссылки</span>
          <input
            className="input"
            value={form.alias}
            placeholder="например: channel"
            disabled={Boolean(editingAlias)}
            onChange={(event) => setForm({
              ...form,
              alias: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
            })}
          />
        </label>

        <label className="field">
          <span className="field__label">ID партнёра в биллинге</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.partnerId}
            placeholder="ID пользователя SHM"
            onChange={(event) => setForm({ ...form, partnerId: event.target.value.replace(/\D/g, "") })}
          />
        </label>

        <label className="field">
          <span className="field__label">Название кампании</span>
          <input
            className="input"
            value={form.campaignCode}
            placeholder="необязательно"
            onChange={(event) => setForm({ ...form, campaignCode: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field__label">Бонус клиенту на первое пополнение, %</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.firstPaymentBonusPercent}
            placeholder="0–100"
            onChange={(event) => setForm({
              ...form,
              firstPaymentBonusPercent: event.target.value.replace(/\D/g, ""),
            })}
          />
        </label>

        <label className="field">
          <span className="field__label">Вознаграждение партнёра, %</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.partnerRewardPercent}
            placeholder="0–100"
            onChange={(event) => setForm({
              ...form,
              partnerRewardPercent: event.target.value.replace(/\D/g, ""),
            })}
          />
        </label>

        <label className="field">
          <span className="field__label">Состояние</span>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>Ссылка активна</span>
          </label>
        </label>
      </div>

      <div className="row admin-gap-top-md">
        <button className="btn btn--primary" type="button" onClick={() => void save()}>
          {editingAlias ? "Сохранить изменения" : "Добавить партнёра"}
        </button>
        {editingAlias && (
          <button className="btn btn--soft" type="button" onClick={clearForm}>Отмена</button>
        )}
      </div>
      {message && <p className="p">{message}</p>}

      <div className="admin-gap-top-md">
        {items.length === 0 && <p className="p">Партнёры пока не добавлены.</p>}
        {items.map((item) => (
          <div className="card" key={item.id}><div className="card__body">
            <b>app.shpun.net/?{item.alias}</b>
            <p className="p">
              Партнёр #{item.partner_id} · первый платёж +{item.first_payment_bonus_percent}%
              {" · "}партнёру {item.partner_reward_percent}% · {item.campaign_code || "без названия кампании"}
            </p>
            <p className="p">
              {item.enabled ? "Активна" : "Выключена"} · переходов: {item.visits_count || 0}
              {" · "}регистраций: {item.registrations_count || 0}
            </p>
            <div className="row">
              <button className="btn btn--soft" type="button" onClick={() => edit(item)}>Изменить</button>
              <button className="btn btn--soft" type="button" onClick={() => void remove(item.id)}>Удалить</button>
            </div>
          </div></div>
        ))}
      </div>
    </div></div>
  );
}

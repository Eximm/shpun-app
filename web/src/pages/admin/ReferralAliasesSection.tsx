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

const emptyForm = {
  alias: "",
  partnerId: "",
  campaignCode: "20firstpay",
  firstPaymentBonusPercent: "20",
  partnerRewardPercent: "50",
  enabled: true,
};

export function ReferralAliasesSection() {
  const [items, setItems] = useState<AliasItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");

  async function load() {
    const r = await apiFetch<{ ok: true; items: AliasItem[] }>("/admin/referral-aliases", { method: "GET" });
    setItems(r.items);
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setMessage("");
    try {
      await apiFetch("/admin/referral-aliases", {
        method: "PUT",
        body: {
          ...form,
          partnerId: Number(form.partnerId),
          firstPaymentBonusPercent: Number(form.firstPaymentBonusPercent),
          partnerRewardPercent: Number(form.partnerRewardPercent),
        },
      });
      setForm(emptyForm);
      await load();
      setMessage("Ссылка сохранена.");
    } catch (e: any) {
      setMessage(e?.message || "Не удалось сохранить ссылку.");
    }
  }

  async function remove(id: number) {
    await apiFetch(`/admin/referral-aliases/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="card"><div className="card__body">
      <div className="kicker">Партнёрские кампании</div>
      <h2 className="h1">Именные реферальные ссылки</h2>
      <p className="p">Алиас преобразуется в обычный ID партнёра до регистрации. Пример: app.shpun.net/?druni4</p>

      <div className="grid admin-gap-top-md">
        <label className="field"><span className="field__label">Алиас</span>
          <input className="input" value={form.alias} placeholder="druni4" onChange={(e) => setForm({ ...form, alias: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
        </label>
        <label className="field"><span className="field__label">ID партнёра в биллинге</span>
          <input className="input" inputMode="numeric" value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="field"><span className="field__label">Код кампании в биллинге</span>
          <input className="input" value={form.campaignCode} onChange={(e) => setForm({ ...form, campaignCode: e.target.value })} />
        </label>
        <label className="field"><span className="field__label">Бонус на первое пополнение, %</span>
          <input className="input" inputMode="numeric" value={form.firstPaymentBonusPercent} onChange={(e) => setForm({ ...form, firstPaymentBonusPercent: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="field"><span className="field__label">Вознаграждение партнёра, %</span>
          <input className="input" inputMode="numeric" value={form.partnerRewardPercent} onChange={(e) => setForm({ ...form, partnerRewardPercent: e.target.value.replace(/\D/g, "") })} />
        </label>
      </div>
      <button className="btn btn--primary admin-gap-top-md" type="button" onClick={() => void save()}>Сохранить</button>
      {message && <p className="p">{message}</p>}

      <div className="admin-gap-top-md">
        {items.map((item) => (
          <div className="card" key={item.id}><div className="card__body">
            <b>app.shpun.net/?{item.alias}</b>
            <p className="p">Партнёр #{item.partner_id} · первый платёж +{item.first_payment_bonus_percent}% · партнёру {item.partner_reward_percent}% · {item.campaign_code || "без кода кампании"}</p>
            <p className="p">Переходов: {item.visits_count || 0} · регистраций: {item.registrations_count || 0}</p>
            <button className="btn btn--soft" type="button" onClick={() => void remove(item.id)}>Удалить</button>
          </div></div>
        ))}
      </div>
    </div></div>
  );
}

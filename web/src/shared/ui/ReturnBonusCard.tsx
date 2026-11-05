import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../../app/auth/useMe";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n";
import { useAccountMoney } from "../money/useAccountMoney";
import { returnBonusService, renewalCoverage, type ReturnBonusService } from "../returnBonus";

export function ReturnBonusCard() {
  const { me } = useMe();
  const { t, locale } = useI18n();
  const money = useAccountMoney();
  const navigate = useNavigate();
  const bonus = me?.returnBonus;
  const [items, setItems] = useState<ReturnBonusService[]>([]);
  const [tariffs, setTariffs] = useState<Array<{ serviceId: number; title: string; price: number; noDiscount?: boolean; bonusLimitPercent?: number }>>([]);
  useEffect(() => {
    if (!bonus?.tariffActivated) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [services, catalog] = await Promise.all([
          apiFetch<{ items: ReturnBonusService[] }>("/services"),
          apiFetch<{ items: typeof tariffs }>("/services/order").catch(() => ({ items: [] })),
        ]);
        if (!cancelled) { setItems(services.items); setTariffs(catalog.items); }
      } catch { /* Never claim activation from stale or missing data. */ }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [bonus?.tariffActivated, bonus?.userServiceId, me?.balance.amount]);
  if (!bonus) return null;
  const service = returnBonusService(items, bonus);
  if (!bonus.pending && !service) return null;
  const active = service?.status === "active";
  const next = tariffs.find((item) => item.serviceId === service?.nextServiceId);
  const coverage = renewalCoverage(Number(me?.balance.amount), next?.price ?? null, next?.noDiscount ? 0 : me?.discount, me?.bonus ?? 0, next?.bonusLimitPercent ?? 0);
  const auto = active && service?.autoBill && service.nextServiceId && service.expireAt;
  const date = service?.expireAt && Number.isFinite(Date.parse(service.expireAt)) ? new Date(service.expireAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : null;
  return <section className="card return-bonus-card" aria-live="polite">
    <div className="card__body">
      <h2 className="h1">{t(bonus.pending ? "returnPlan.pending.title" : active ? "returnPlan.active.title" : "returnPlan.inactive.title", { title: service?.title ?? "" })}</h2>
      {bonus.pending ? <p className="p">{t("returnPlan.pending.text", { percent: bonus.percent, days: bonus.days })}</p> : <>
        {active && <p className="p">{t("returnPlan.active.text", { date: date ?? t("returnPlan.date_unknown") })}</p>}
        {auto && date && <p className="p">{t("returnPlan.transition", { date, title: next?.title ?? "Flex" })}</p>}
        {auto && coverage && <p className="p">{t(coverage.sufficient ? "returnPlan.covered" : "returnPlan.shortage", { balance: money(me?.balance.amount ?? 0), amount: money(coverage.sufficient ? coverage.amount : coverage.shortage) })}</p>}
        {active && (!auto || !date || !coverage) && <p className="p">{t("returnPlan.renewal_check")}</p>}
        {!active && <p className="p">{t("returnPlan.inactive.text")}</p>}
      </>}
      <button type="button" className="btn btn--primary" onClick={() => navigate(bonus.pending ? "/payments?return=%2Fhome" : active ? `/services?usi=${service!.userServiceId}&connect=1&assistant=1` : `/services?usi=${service!.userServiceId}`)}>
        {t(bonus.pending ? "returnPlan.topup" : active ? "returnPlan.setup" : "returnPlan.open")}
      </button>
    </div>
  </section>;
}

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";

type AliasItem = {
  id: number;
  alias: string;
  link_type: "partner" | "campaign";
  partner_id: number;
  campaign_code: string | null;
  billing_comment: string | null;
  first_payment_bonus_percent: number;
  partner_reward_percent: number;
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

const createEmptyForm = (): PartnerForm => ({
  linkType: "partner",
  alias: "",
  partnerId: "",
  campaignCode: "",
  billingComment: "",
  firstPaymentBonusPercent: "",
  partnerRewardPercent: "",
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function activeStatsTitle(stats?: PartnerStats): string {
  if (!stats) return "";
  if (stats.activeSource === "template") {
    return `Активные клиенты посчитаны шаблоном биллинга${stats.templateVersion ? `: ${stats.templateVersion}` : ""}`;
  }
  if (stats.activeSource === "services") {
    const parts = [
      stats.serviceStatsMethod || "services",
      typeof stats.scannedServices === "number" ? `услуг: ${stats.scannedServices}` : "",
      typeof stats.serviceRowsWithOwner === "number" ? `с владельцем: ${stats.serviceRowsWithOwner}` : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }
  return "";
}

export function ReferralAliasesSection() {
  const [items, setItems] = useState<AliasItem[]>([]);
  const [form, setForm] = useState<PartnerForm>(createEmptyForm);
  const [editingAlias, setEditingAlias] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<Record<number, PartnerStats>>({});
  const [statsLoading, setStatsLoading] = useState<Record<number, boolean>>({});
  const [copiedLink, setCopiedLink] = useState("");
  const botUsername = useMemo(() => getTelegramBotUsername(), []);

  async function copyLink(key: string, value: string) {
    const ok = await copyToClipboard(value);
    if (!ok) {
      setMessage("Не удалось скопировать. Выделите ссылку вручную.");
      return;
    }
    setCopiedLink(key);
    setMessage("Ссылка скопирована.");
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
      setMessage(form.linkType === "campaign" ? "Рекламная ссылка сохранена." : "Партнёр сохранён.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить ссылку.");
    }
  }

  async function remove(id: number) {
    await apiFetch(`/admin/referral-aliases/${id}`, { method: "DELETE" });
    await load();
  }

  const campaignItems = items.filter((item) => item.link_type === "campaign");
  const partnerItems = items.filter((item) => item.link_type !== "campaign");

  return (
    <div className="card"><div className="card__body">
      <div className="kicker">Блогерский модуль</div>
      <h2 className="h1">Ссылки и партнёры</h2>
      <p className="p">
        Партнёрские ссылки управляют выплатами, а рекламные ссылки только записывают метку в комментарий нового клиента в биллинге.
      </p>

      {!creating && !editingAlias && (
        <div className="row admin-gap-top-md">
          <button className="btn btn--primary" type="button" onClick={() => createLink("campaign")}>
            Новая рекламная ссылка
          </button>
          <button className="btn btn--soft" type="button" onClick={() => createLink("partner")}>
            Новый партнёр
          </button>
        </div>
      )}

      {(creating || editingAlias) && <>
      <h3 className="h2 admin-gap-top-md">
        {editingAlias
          ? `Редактирование: ${editingAlias}`
          : form.linkType === "campaign" ? "Новая рекламная ссылка" : "Создание партнёра"}
      </h3>
      <p className="p">
        {form.linkType === "campaign"
          ? "Метка будет записана только при новой регистрации и только если комментарий клиента ещё пуст."
          : "Заполните условия вручную. Пустой процент означает 0%."}
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

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">ID партнёра в биллинге</span>
          <input
            className="input"
            inputMode="numeric"
            value={form.partnerId}
            placeholder="ID пользователя SHM"
            onChange={(event) => setForm({ ...form, partnerId: event.target.value.replace(/\D/g, "") })}
          />
        </label>}

        {form.linkType === "partner" && <label className="field">
          <span className="field__label">Имя партнёра или кампании</span>
          <input
            className="input"
            value={form.campaignCode}
            placeholder="например: канал или имя блогера"
            onChange={(event) => setForm({ ...form, campaignCode: event.target.value })}
          />
        </label>}

        {form.linkType === "campaign" && <label className="field">
          <span className="field__label">Комментарий в биллинге</span>
          <input
            className="input"
            value={form.billingComment}
            maxLength={255}
            placeholder="например: Реклама Telegram — канал Новости"
            onChange={(event) => setForm({ ...form, billingComment: event.target.value })}
          />
        </label>}

        {form.linkType === "partner" && <label className="field">
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
        </label>}

        {form.linkType === "partner" && <label className="field">
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
        </label>}

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
          {editingAlias
            ? "Сохранить изменения"
            : form.linkType === "campaign" ? "Добавить ссылку" : "Добавить партнёра"}
        </button>
        <button className="btn btn--soft" type="button" onClick={clearForm}>Отмена</button>
      </div>
      </>}
      {message && <div className="refPartnerNotice">{message}</div>}

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">Рекламные ссылки без партнёрки</h3>
          {campaignItems.length > 0 && <span className="chip chip--soft">{campaignItems.length}</span>}
        </div>
        <p className="p">Для Telegram-каналов и других площадок, где нужно только посчитать регистрации по метке.</p>
        {campaignItems.length === 0 && <p className="p">Рекламные ссылки пока не добавлены.</p>}
        {campaignItems.map((item) => {
          const itemStats = stats[item.id];
          const appLink = buildAppLink(item.alias);
          const botLink = buildTelegramBotLink(botUsername, item);
          return (
          <article className="refPartnerCard" key={item.id}>
            <div className="refPartnerCard__head">
              <div className="refPartnerCard__identity">
                <span className="refPartnerCard__eyebrow">Рекламная ссылка без партнёрки</span>
                <strong className="refPartnerCard__title">{item.alias}</strong>
                <span className="refPartnerCard__campaign">Комментарий: {item.billing_comment}</span>
              </div>
              <span className={`chip ${item.enabled ? "chip--ok" : "chip--soft"}`}>
                {item.enabled ? "Активна" : "Выключена"}
              </span>
            </div>
            <div className="refPartnerLinks" aria-label="Ссылки для размещения">
              <div className="refPartnerLinks__title">Ссылки для размещения</div>
              <div className="refPartnerLinks__row">
                <div className="refPartnerLinks__body">
                  <span>Сайт и приложение</span>
                  <code>{appLink}</code>
                </div>
                <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`app-${item.id}`, appLink)}>
                  {copiedLink === `app-${item.id}` ? "Скопировано" : "Копировать"}
                </button>
              </div>
              {botLink && (
                <div className="refPartnerLinks__row">
                  <div className="refPartnerLinks__body">
                    <span>Telegram-бот</span>
                    <code>{botLink}</code>
                  </div>
                  <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`bot-${item.id}`, botLink)}>
                    {copiedLink === `bot-${item.id}` ? "Скопировано" : "Копировать"}
                  </button>
                </div>
              )}
            </div>
            <div className="refPartnerCard__metrics">
              <div className="refPartnerCard__metric">
                <span>Переходы</span>
                <strong>{item.visits_count || 0}</strong>
              </div>
              <div className="refPartnerCard__metric refPartnerCard__metric--active">
                <span>Комментариев записано</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats ? itemStats.totalUsers : item.registrations_count || 0}
                </strong>
              </div>
            </div>
            <div className="refPartnerCard__actions">
              <button className="btn btn--soft" type="button" onClick={() => edit(item)}>Изменить</button>
              <button
                className="btn btn--soft"
                type="button"
                disabled={Boolean(statsLoading[item.id])}
                onClick={() => void loadStats(item)}
              >
                Обновить
              </button>
              <button className="btn refPartnerCard__delete" type="button" onClick={() => void remove(item.id)}>Удалить</button>
            </div>
          </article>
          );
        })}
      </div>

      <div className="refPartnerList admin-gap-top-md">
        <div className="refPartnerList__head">
          <h3 className="h2">Созданные партнёры</h3>
          {partnerItems.length > 0 && <span className="chip chip--soft">{partnerItems.length}</span>}
        </div>
        {partnerItems.length === 0 && <p className="p">Партнёры пока не добавлены.</p>}
        {partnerItems.map((item) => {
          const itemStats = stats[item.id];
          const activeTitle = activeStatsTitle(itemStats);
          const appLink = buildAppLink(item.alias);
          const botLink = buildTelegramBotLink(botUsername, item);
          return (
          <article className="refPartnerCard" key={item.id}>
            <div className="refPartnerCard__head">
              <div className="refPartnerCard__identity">
                <span className="refPartnerCard__eyebrow">Партнёр #{item.partner_id}</span>
                <strong className="refPartnerCard__title">{item.alias}</strong>
                {item.campaign_code && (
                  <span className="refPartnerCard__campaign">{item.campaign_code}</span>
                )}
              </div>
              <span className={`chip ${item.enabled ? "chip--ok" : "chip--soft"}`}>
                {item.enabled ? "Активна" : "Выключена"}
              </span>
            </div>
            <div className="refPartnerLinks" aria-label="Ссылки для размещения">
              <div className="refPartnerLinks__title">Ссылки для размещения</div>
              <div className="refPartnerLinks__row">
                <div className="refPartnerLinks__body">
                  <span>Сайт и приложение</span>
                  <code>{appLink}</code>
                </div>
                <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`app-${item.id}`, appLink)}>
                  {copiedLink === `app-${item.id}` ? "Скопировано" : "Копировать"}
                </button>
              </div>
              {botLink && (
                <div className="refPartnerLinks__row">
                  <div className="refPartnerLinks__body">
                    <span>Telegram-бот</span>
                    <code>{botLink}</code>
                  </div>
                  <button className="btn btn--soft refPartnerLinks__copy" type="button" onClick={() => void copyLink(`bot-${item.id}`, botLink)}>
                    {copiedLink === `bot-${item.id}` ? "Скопировано" : "Копировать"}
                  </button>
                </div>
              )}
            </div>

            <div className="refPartnerCard__metrics">
              <div className="refPartnerCard__metric">
                <span>Первое пополнение</span>
                <strong>+{item.first_payment_bonus_percent}%</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>Партнёру</span>
                <strong>{item.partner_reward_percent}%</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>Переходы</span>
                <strong>{item.visits_count || 0}</strong>
              </div>
              <div className="refPartnerCard__metric">
                <span>Клиенты в биллинге</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats
                      ? itemStats.totalUsers
                      : "—"}
                </strong>
              </div>
              <div className="refPartnerCard__metric refPartnerCard__metric--active" title={activeTitle || undefined}>
                <span>Активные по услугам</span>
                <strong>
                  {statsLoading[item.id]
                    ? "…"
                    : itemStats
                      ? itemStats.activeUsers
                      : "—"}
                </strong>
              </div>
            </div>

            <div className="refPartnerCard__actions">
              <button
                className="btn btn--soft"
                type="button"
                disabled={Boolean(statsLoading[item.id])}
                onClick={() => void loadStats(item)}
              >
                Обновить
              </button>
              <button className="btn btn--soft" type="button" onClick={() => edit(item)}>Изменить</button>
              <button className="btn refPartnerCard__delete" type="button" onClick={() => void remove(item.id)}>Удалить</button>
            </div>
          </article>
        )})}
      </div>
    </div></div>
  );
}

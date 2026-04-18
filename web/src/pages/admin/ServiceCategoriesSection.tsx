// web/src/pages/admin/ServiceCategoriesSection.tsx

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { ModalShell } from "./shared";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type ServiceCategory = {
  id: number;
  category_key: string;
  title: string;
  descr: string;
  short_descr: string;
  connect_kind: string;
  sort_order: number;
  badge: string | null;
  badge_tone: string;
  recommended: boolean;
  hidden: boolean;
  emoji: string | null;
  accent_from: string | null;
  accent_to: string | null;
  card_bg: string | null;
  button_label: string | null;
  billing_category_keys: string[];
  service_ids: number[];
};

type BillingTariff = {
  serviceId: number;
  category: string;
  title: string;
  price: number;
  currency: string;
  periodHuman: string;
};

const CONNECT_KINDS = [
  { value: "marzban",        label: "Marzban" },
  { value: "marzban_router", label: "Router VPN" },
  { value: "amneziawg",      label: "AmneziaWG" },
];

const BADGE_TONES = [
  { value: "soft", label: "Серый" },
  { value: "ok",   label: "Зелёный" },
  { value: "warn", label: "Жёлтый" },
  { value: "accent", label: "Фиолетовый" },
];

const EMPTY_FORM = (): Partial<ServiceCategory> & {
  service_ids: number[];
  billing_category_keys: string[];
  billing_pattern_input: string;
} => ({
  category_key:          "",
  title:                 "",
  descr:                 "",
  short_descr:           "",
  connect_kind:          "marzban",
  sort_order:            100,
  badge:                 null,
  badge_tone:            "soft",
  recommended:           false,
  hidden:                false,
  emoji:                 null,
  accent_from:           null,
  accent_to:             null,
  card_bg:               null,
  button_label:          null,
  billing_category_keys: [],
  service_ids:           [],
  billing_pattern_input: "",
});

/* ─── Preview Card ───────────────────────────────────────────────────────── */

function CategoryPreview({ form }: { form: ReturnType<typeof EMPTY_FORM> }) {
  const accentFrom = form.accent_from || "#7c5cff";
  const accentTo   = form.accent_to   || "#4dd7ff";
  const cardBg     = form.card_bg     || "rgba(255,255,255,0.04)";
  const gradient   = `linear-gradient(135deg, ${accentFrom}, ${accentTo})`;
  const btnLabel   = form.button_label || "Выбрать";

  return (
    <div style={{
      border: `1.5px solid ${accentFrom}`,
      borderRadius: 16,
      background: cardBg,
      padding: 16,
      marginTop: 8,
    }}>
      {form.recommended && (
        <div style={{
          display: "inline-block",
          background: gradient,
          borderRadius: 20,
          padding: "2px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          marginBottom: 8,
        }}>
          {form.badge || "Рекомендуем"}
        </div>
      )}
      {!form.recommended && form.badge && (
        <div style={{
          display: "inline-block",
          background: gradient,
          borderRadius: 20,
          padding: "2px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          marginBottom: 8,
        }}>
          {form.badge}
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
        {form.emoji ? `${form.emoji} ` : ""}{form.title || "Название категории"}
      </div>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
        {form.short_descr || "Краткое описание"}
      </div>
      <div style={{
        background: gradient,
        borderRadius: 12,
        padding: "12px 0",
        textAlign: "center",
        fontWeight: 600,
        color: "#fff",
        fontSize: 15,
        boxShadow: `0 0 16px ${accentFrom}55`,
      }}>
        {btnLabel}
      </div>
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function ServiceCategoriesSection() {
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [items,     setItems]     = useState<ServiceCategory[]>([]);
  const [tariffs,   setTariffs]   = useState<BillingTariff[]>([]);
  const [opened,    setOpened]    = useState<ServiceCategory | null>(null);
  const [form,      setForm]      = useState(EMPTY_FORM());
  const [isNew,     setIsNew]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting,  setDeleting]  = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [catResp, tariffResp] = await Promise.all([
        apiFetch<{ ok: true; items: ServiceCategory[] }>("/admin/service-categories", { method: "GET" }),
        apiFetch<{ ok: true; items: BillingTariff[] }>("/services/order", { method: "GET" }),
      ]);
      setItems(Array.isArray(catResp.items) ? catResp.items : []);
      setTariffs(Array.isArray(tariffResp.items) ? tariffResp.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM());
    setIsNew(true);
    setOpened(null);
    setSaveError(null);
  }

  function openEdit(cat: ServiceCategory) {
    setForm({
      ...EMPTY_FORM(),
      category_key:          cat.category_key,
      title:                 cat.title,
      descr:                 cat.descr,
      short_descr:           cat.short_descr,
      connect_kind:          cat.connect_kind,
      sort_order:            cat.sort_order,
      badge:                 cat.badge,
      badge_tone:            cat.badge_tone,
      recommended:           cat.recommended,
      hidden:                cat.hidden,
      emoji:                 cat.emoji,
      accent_from:           cat.accent_from,
      accent_to:             cat.accent_to,
      card_bg:               cat.card_bg,
      button_label:          cat.button_label,
      billing_category_keys: cat.billing_category_keys.slice(),
      service_ids:           cat.service_ids.slice(),
      billing_pattern_input: "",
    });
    setIsNew(false);
    setOpened(cat);
    setSaveError(null);
  }

  function closeModal() { setOpened(null); setIsNew(false); setSaveError(null); }

  function toggleServiceId(sid: number) {
    setForm((prev) => {
      const ids = prev.service_ids ?? [];
      return { ...prev, service_ids: ids.includes(sid) ? ids.filter((x) => x !== sid) : [...ids, sid] };
    });
  }

  function addBillingPattern() {
    const pat = (form.billing_pattern_input ?? "").trim();
    if (!pat) return;
    setForm((prev) => ({
      ...prev,
      billing_category_keys: prev.billing_category_keys.includes(pat)
        ? prev.billing_category_keys
        : [...prev.billing_category_keys, pat],
      billing_pattern_input: "",
    }));
  }

  function removeBillingPattern(pat: string) {
    setForm((prev) => ({
      ...prev,
      billing_category_keys: prev.billing_category_keys.filter((x) => x !== pat),
    }));
  }

  async function save() {
    setSaving(true); setSaveError(null);
    const { billing_pattern_input, ...body } = form;
    try {
      if (isNew) {
        await apiFetch("/admin/service-categories", { method: "POST", body });
      } else if (opened) {
        await apiFetch(`/admin/service-categories/${encodeURIComponent(opened.category_key)}`, { method: "PUT", body });
      }
      closeModal();
      void load();
    } catch (e: any) {
      setSaveError(e?.message || "Не удалось сохранить.");
    } finally { setSaving(false); }
  }

  async function remove(key: string) {
    if (!window.confirm(`Удалить категорию «${key}»?`)) return;
    setDeleting(key);
    try {
      await apiFetch(`/admin/service-categories/${encodeURIComponent(key)}`, { method: "DELETE" });
      void load();
    } catch (e: any) {
      window.alert(e?.message || "Не удалось удалить.");
    } finally { setDeleting(null); }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Service categories</div>
              <h2 className="h2">Категории услуг</h2>
              <p className="p">Управление группами тарифов, оформлением и привязкой к биллингу.</p>
            </div>
            <div className="admin-rowActions">
              <button className="btn btn--accent" type="button" onClick={openNew}>+ Создать</button>
              <button className="btn btn--soft" type="button" onClick={() => void load()} disabled={loading}>
                {loading ? "Загружаю…" : "Обновить"}
              </button>
            </div>
          </div>

          {error && <div className="pre admin-gap-top-md">{error}</div>}

          <div className="list admin-gap-top-md">
            {loading && !items.length ? (
              <><div className="skeleton h1" /><div className="skeleton p" /></>
            ) : items.length === 0 ? (
              <div className="pre">Категорий пока нет. Создайте первую.</div>
            ) : items.map((cat) => {
              const accentFrom = cat.accent_from || "#7c5cff";
              return (
                <div key={cat.category_key} className="list__item admin-rowCard"
                  style={{ opacity: cat.hidden ? 0.5 : 1, borderLeft: `3px solid ${accentFrom}` }}>
                  <div className="list__main">
                    <div className="kicker">
                      {cat.category_key}
                      {cat.hidden      && <span className="chip chip--warn"   style={{ marginLeft: 8 }}>скрыто</span>}
                      {cat.recommended && <span className="chip chip--ok"     style={{ marginLeft: 8 }}>рекомендуем</span>}
                      {cat.badge       && <span className="chip chip--soft"   style={{ marginLeft: 8 }}>{cat.badge}</span>}
                    </div>
                    <div className="list__title admin-gap-top-xs">
                      {cat.emoji ? `${cat.emoji} ` : ""}{cat.title || "—"}
                    </div>
                    {cat.short_descr && <div className="list__sub">{cat.short_descr}</div>}
                    <div className="admin-inlineMeta admin-gap-top-sm">
                      <span><strong>billing:</strong> {cat.billing_category_keys.join(", ") || "—"}</span>
                      <span><strong>тарифов:</strong> {cat.service_ids.length}</span>
                      <span><strong>порядок:</strong> {cat.sort_order}</span>
                    </div>
                  </div>
                  <div className="admin-rowActions">
                    <button className="btn btn--soft" type="button" onClick={() => openEdit(cat)}>Изменить</button>
                    <button className="btn btn--danger" type="button"
                      disabled={deleting === cat.category_key}
                      onClick={() => void remove(cat.category_key)}>
                      {deleting === cat.category_key ? "Удаляю…" : "Удалить"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(isNew || opened) && (
        <ModalShell
          title={isNew ? "Новая категория" : `Редактировать: ${opened?.category_key}`}
          kicker={isNew ? "Создание" : "Редактирование"}
          onClose={closeModal}
        >
          {/* Превью */}
          <div className="list__item admin-tightItem">
            <div className="list__main">
              <div className="list__title">Превью карточки</div>
              <CategoryPreview form={form} />
            </div>
          </div>

          <div className="list">
            {/* Ключ — только для новых */}
            {isNew && (
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">Ключ категории *</div>
                  <div className="list__sub" style={{ marginBottom: 6 }}>Латиница, уникальный (например: marzban, router-vpn, amnezia)</div>
                  <input className="input" value={form.category_key ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, category_key: e.target.value }))}
                    placeholder="marzban" />
                </div>
              </div>
            )}

            {/* Основные поля */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Эмодзи / иконка</div>
                <input className="input" value={form.emoji ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, emoji: e.target.value || null }))}
                  placeholder="🔒" style={{ maxWidth: 80 }} />
              </div>
            </div>

            {[
              { key: "title",       label: "Название",          ph: "Marzban" },
              { key: "short_descr", label: "Краткое описание",   ph: "Стабильно и быстро. Для телефона, ПК и планшета." },
              { key: "descr",       label: "Полное описание",    ph: "Подробное описание категории" },
              { key: "button_label",label: "Текст кнопки",       ph: "Выбрать" },
            ].map(({ key, label, ph }) => (
              <div key={key} className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">{label}</div>
                  <input className="input" value={(form as any)[key] ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value || null }))}
                    placeholder={ph} />
                </div>
              </div>
            ))}

            {/* Цвета */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Цвет акцента (градиент рамки и кнопки)</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>От</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="color" value={form.accent_from || "#7c5cff"}
                        onChange={(e) => setForm((p) => ({ ...p, accent_from: e.target.value }))}
                        style={{ width: 40, height: 32, padding: 2, cursor: "pointer", borderRadius: 6 }} />
                      <input className="input" value={form.accent_from ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, accent_from: e.target.value || null }))}
                        placeholder="#7c5cff" style={{ width: 100 }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>До</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="color" value={form.accent_to || "#4dd7ff"}
                        onChange={(e) => setForm((p) => ({ ...p, accent_to: e.target.value }))}
                        style={{ width: 40, height: 32, padding: 2, cursor: "pointer", borderRadius: 6 }} />
                      <input className="input" value={form.accent_to ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, accent_to: e.target.value || null }))}
                        placeholder="#4dd7ff" style={{ width: 100 }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Фон карточки</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input type="color" value={form.card_bg?.startsWith("#") ? form.card_bg : "#1a1a2e"}
                    onChange={(e) => setForm((p) => ({ ...p, card_bg: e.target.value }))}
                    style={{ width: 40, height: 32, padding: 2, cursor: "pointer", borderRadius: 6 }} />
                  <input className="input" value={form.card_bg ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, card_bg: e.target.value || null }))}
                    placeholder="rgba(255,255,255,0.04) или #1a1a2e или linear-gradient(...)" />
                </div>
                <div className="list__sub" style={{ marginTop: 4 }}>Можно указать hex, rgba или linear-gradient</div>
              </div>
            </div>

            {/* Бейдж */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Значок (необязательно)</div>
                <input className="input" value={form.badge ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, badge: e.target.value || null }))}
                  placeholder="Рекомендуем / Акция / Новинка" />
                <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                  {BADGE_TONES.map(({ value, label }) => (
                    <label key={value} className="admin-radio">
                      <input type="radio" name="badge_tone" value={value}
                        checked={form.badge_tone === value}
                        onChange={() => setForm((p) => ({ ...p, badge_tone: value }))} />
                      {" "}{label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* connect_kind */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Тип подключения</div>
                <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                  {CONNECT_KINDS.map(({ value, label }) => (
                    <label key={value} className="admin-radio">
                      <input type="radio" name="connect_kind" value={value}
                        checked={form.connect_kind === value}
                        onChange={() => setForm((p) => ({ ...p, connect_kind: value }))} />
                      {" "}{label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* sort_order + флаги */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Порядок сортировки</div>
                <input className="input" type="number" min="0" max="9999"
                  value={form.sort_order ?? 100}
                  onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                  style={{ maxWidth: 100 }} />
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <label className="admin-radio">
                    <input type="checkbox" checked={!!form.recommended}
                      onChange={(e) => setForm((p) => ({ ...p, recommended: e.target.checked }))} />
                    {" "}Рекомендуем
                  </label>
                  <label className="admin-radio">
                    <input type="checkbox" checked={!!form.hidden}
                      onChange={(e) => setForm((p) => ({ ...p, hidden: e.target.checked }))} />
                    {" "}Скрыть категорию
                  </label>
                </div>
              </div>
            </div>

            {/* Billing category patterns */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Паттерны биллинговых категорий</div>
                <div className="list__sub" style={{ marginBottom: 8 }}>
                  Все тарифы с совпадающей категорией из биллинга автоматически попадут сюда.
                  Используй * для wildcard: <strong>vpn-*</strong> подхватит vpn-msk, vpn-de и т.д.
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input className="input" value={form.billing_pattern_input ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, billing_pattern_input: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addBillingPattern()}
                    placeholder="marzban или vpn-*" />
                  <button className="btn btn--soft" type="button" onClick={addBillingPattern}>+</button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(form.billing_category_keys ?? []).map((pat) => (
                    <span key={pat} className="chip chip--soft" style={{ cursor: "pointer" }}
                      onClick={() => removeBillingPattern(pat)}>
                      {pat} ✕
                    </span>
                  ))}
                </div>
                {/* Подсказка — какие тарифы биллинга подходят под текущие паттерны */}
                {tariffs.length > 0 && (form.billing_category_keys ?? []).length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                    Совпадают тарифы: {tariffs
                      .filter((t) => (form.billing_category_keys ?? []).some((pat) => {
                        if (pat.endsWith("*")) return t.category.startsWith(pat.slice(0, -1));
                        return t.category === pat;
                      }))
                      .map((t) => t.title)
                      .join(", ") || "—"}
                  </div>
                )}
              </div>
            </div>

            {/* Ручная привязка тарифов */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Ручная привязка тарифов</div>
                <div className="list__sub" style={{ marginBottom: 8 }}>
                  Дополнительно к паттернам — конкретные тарифы по ID
                </div>
                {tariffs.length === 0 ? (
                  <div className="pre">Тарифы не загружены</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                    {tariffs.map((t) => (
                      <label key={t.serviceId} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input type="checkbox"
                          checked={(form.service_ids ?? []).includes(t.serviceId)}
                          onChange={() => toggleServiceId(t.serviceId)} />
                        <span>
                          <strong>#{t.serviceId}</strong> {t.title}
                          <span style={{ opacity: 0.5, marginLeft: 6 }}>{t.price} ₽ / {t.periodHuman}</span>
                          <span style={{ opacity: 0.35, marginLeft: 6, fontSize: 11 }}>[{t.category}]</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {saveError && <div className="pre" style={{ marginTop: 8 }}>{saveError}</div>}

          <div className="actions actions--2 admin-gap-top-lg">
            <button className="btn btn--soft" type="button" onClick={closeModal} disabled={saving}>Отмена</button>
            <button className="btn btn--accent" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Сохраняю…" : isNew ? "Создать" : "Сохранить"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
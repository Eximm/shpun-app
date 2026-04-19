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
  hint_enabled: boolean;
  hint_title: string | null;
  hint_text: string | null;
  hint_button_label: string | null;
  hint_button_url: string | null;
};

type BillingTariff = {
  serviceId: number;
  category: string;
  title: string;
  price: number;
  currency: string;
  periodHuman: string;
};

/* ─── Presets ────────────────────────────────────────────────────────────── */

const PRESETS = [
  { label: "🟣 Фиолетовый", from: "#7c5cff", to: "#a855f7" },
  { label: "🔵 Голубой",    from: "#3b82f6", to: "#4dd7ff" },
  { label: "🟢 Зелёный",    from: "#22c55e", to: "#10b981" },
  { label: "🟠 Оранжевый",  from: "#f97316", to: "#ef4444" },
  { label: "🩷 Розовый",    from: "#ec4899", to: "#8b5cf6" },
];

const CONNECT_KINDS = [
  { value: "marzban",        label: "Marzban" },
  { value: "marzban_router", label: "Router VPN" },
  { value: "amneziawg",      label: "AmneziaWG" },
];

const BADGE_TONES: Record<string, string> = {
  soft:   "rgba(255,255,255,0.15)",
  ok:     "#22c55e",
  warn:   "#f59e0b",
  accent: "#7c5cff",
  danger: "#ef4444",
};

const BADGE_TONE_OPTIONS = [
  { value: "soft",   label: "Серый" },
  { value: "ok",     label: "Зелёный" },
  { value: "warn",   label: "Жёлтый" },
  { value: "accent", label: "Фиолетовый" },
  { value: "danger", label: "Красный" },
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
  accent_from:           PRESETS[0].from,
  accent_to:             PRESETS[0].to,
  card_bg:               null,
  button_label:          null,
  billing_category_keys: [],
  service_ids:           [],
  billing_pattern_input: "",
  hint_enabled:          false,
  hint_title:            null,
  hint_text:             null,
  hint_button_label:     null,
  hint_button_url:       null,
});

/* ─── Preview ────────────────────────────────────────────────────────────── */

function CategoryPreview({ form }: { form: ReturnType<typeof EMPTY_FORM> }) {
  const accentFrom = form.accent_from || PRESETS[0].from;
  const cardBg     = form.card_bg || "rgba(255,255,255,0.04)";
  const btnLabel   = form.button_label || "Выбрать";

  return (
    <div style={{ border: `1.5px solid ${accentFrom}`, borderRadius: 16, background: cardBg, padding: 16, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {form.emoji ? `${form.emoji} ` : ""}{form.title || "Название категории"}
        </div>
        {form.badge && (
          <span className={`chip chip--${form.badge_tone || 'soft'}`} style={{ marginLeft: 8, whiteSpace: "nowrap" }}>
            {form.badge}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
        {form.short_descr || "Краткое описание"}
      </div>
      <div className="actions actions--1">
        <span className="btn btn--primary" style={{ width: "100%" }}>{btnLabel}</span>
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
    setForm(EMPTY_FORM()); setIsNew(true); setOpened(null); setSaveError(null);
  }

  function openEdit(cat: ServiceCategory) {
    setForm({
      ...EMPTY_FORM(),
      ...cat,
      billing_pattern_input: "",
    });
    setIsNew(false); setOpened(cat); setSaveError(null);
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
      billing_category_keys: prev.billing_category_keys.includes(pat) ? prev.billing_category_keys : [...prev.billing_category_keys, pat],
      billing_pattern_input: "",
    }));
  }

  function removeBillingPattern(pat: string) {
    setForm((prev) => ({ ...prev, billing_category_keys: prev.billing_category_keys.filter((x) => x !== pat) }));
  }

  function applyPreset(preset: typeof PRESETS[0]) {
    setForm((prev) => ({ ...prev, accent_from: preset.from, accent_to: preset.to }));
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
      closeModal(); void load();
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

  const matchedTariffs = tariffs.filter((t) =>
    (form.billing_category_keys ?? []).some((pat) =>
      pat.endsWith("*") ? t.category.startsWith(pat.slice(0, -1)) : t.category === pat
    )
  );

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
              const accent = cat.accent_from || PRESETS[0].from;
              return (
                <div key={cat.category_key} className="list__item admin-rowCard"
                  style={{ opacity: cat.hidden ? 0.5 : 1, borderLeft: `3px solid ${accent}` }}>
                  <div className="list__main">
                    <div className="kicker">{cat.category_key}</div>
                    <div className="list__title admin-gap-top-xs" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {cat.emoji ? `${cat.emoji} ` : ""}{cat.title || "—"}
                      {cat.badge && (
                        <span className={`chip chip--${cat.badge_tone || 'soft'}`}>
                          {cat.badge}
                        </span>
                      )}
                      {cat.hidden && <span className="chip chip--warn">скрыто</span>}
                    </div>
                    {cat.short_descr && <div className="list__sub">{cat.short_descr}</div>}
                    <div className="admin-inlineMeta admin-gap-top-sm">
                      <span><strong>billing:</strong> {cat.billing_category_keys.join(", ") || "—"}</span>
                      <span><strong>тарифов:</strong> {cat.service_ids.length}</span>
                      <span><strong>порядок:</strong> {cat.sort_order}</span>
                      {cat.hint_enabled && <span><strong>📢 подсказка</strong></span>}
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

            {isNew && (
              <div className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">Ключ категории *</div>
                  <div className="list__sub" style={{ marginBottom: 6 }}>Латиница, уникальный (например: marzban, router-vpn)</div>
                  <input className="input" value={form.category_key ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, category_key: e.target.value }))}
                    placeholder="marzban" />
                </div>
              </div>
            )}

            {/* Эмодзи + название */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: "0 0 72px" }}>
                    <div className="list__title">Эмодзи</div>
                    <input className="input" value={form.emoji ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, emoji: e.target.value || null }))}
                      placeholder="🔒" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="list__title">Название *</div>
                    <input className="input" value={form.title ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="Marzban" />
                  </div>
                </div>
              </div>
            </div>

            {[
              { key: "short_descr",  label: "Краткое описание",  ph: "Стабильно и быстро. Для телефона, ПК и планшета." },
              { key: "descr",        label: "Полное описание",   ph: "Подробное описание, видно при раскрытии категории" },
              { key: "button_label", label: "Текст кнопки",      ph: "Выбрать" },
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

            {/* Пресеты цвета */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Цветовой пресет</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {PRESETS.map((p) => {
                    const active = form.accent_from === p.from && form.accent_to === p.to;
                    return (
                      <button key={p.from} type="button" onClick={() => applyPreset(p)}
                        style={{
                          background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
                          border: active ? "2px solid #fff" : "2px solid transparent",
                          borderRadius: 20, padding: "4px 14px", fontSize: 13, color: "#111",
                          fontWeight: 600, cursor: "pointer",
                        }}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Фон карточки */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Фон карточки</div>
                <input className="input" value={form.card_bg ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, card_bg: e.target.value || null }))}
                  placeholder="rgba(255,255,255,0.04) или #1a1a2e или linear-gradient(...)" />
                <div className="list__sub" style={{ marginTop: 4 }}>Оставь пустым для стандартного фона</div>
              </div>
            </div>

            {/* Бейдж */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Значок (необязательно)</div>
                <input className="input" value={form.badge ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, badge: e.target.value || null }))}
                  placeholder="Рекомендуем / Акция / Новинка"
                  style={{ marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {BADGE_TONE_OPTIONS.map(({ value, label }) => {
                    const active = form.badge_tone === value;
                    return (
                      <button key={value} type="button"
                        onClick={() => setForm((p) => ({ ...p, badge_tone: value }))}
                        style={{
                          background: active ? BADGE_TONES[value] : "transparent",
                          border: `1.5px solid ${BADGE_TONES[value]}`,
                          borderRadius: 20, padding: "3px 12px", fontSize: 12,
                          color: active ? "#fff" : "inherit", cursor: "pointer",
                        }}>
                        {label}
                      </button>
                    );
                  })}
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
                <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div className="list__title">Порядок</div>
                    <input className="input" type="number" min="0" max="9999"
                      value={form.sort_order ?? 100}
                      onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                      style={{ maxWidth: 80 }} />
                  </div>
                  <label className="admin-radio" style={{ marginTop: 20 }}>
                    <input type="checkbox" checked={!!form.recommended}
                      onChange={(e) => setForm((p) => ({ ...p, recommended: e.target.checked }))} />
                    {" "}Рекомендуем
                  </label>
                  <label className="admin-radio" style={{ marginTop: 20 }}>
                    <input type="checkbox" checked={!!form.hidden}
                      onChange={(e) => setForm((p) => ({ ...p, hidden: e.target.checked }))} />
                    {" "}Скрыть
                  </label>
                </div>
              </div>
            </div>

            {/* Подсказка при входе */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div className="list__title" style={{ margin: 0 }}>💬 Подсказка при входе в категорию</div>
                  <label className="admin-radio">
                    <input type="checkbox" checked={!!form.hint_enabled}
                      onChange={(e) => setForm((p) => ({ ...p, hint_enabled: e.target.checked }))} />
                    {" "}Включить
                  </label>
                </div>
                {form.hint_enabled && (
                  <>
                    <div className="list__sub" style={{ marginBottom: 8 }}>
                      Показывается один раз за сессию при входе в категорию
                    </div>
                    <input className="input" value={form.hint_title ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, hint_title: e.target.value || null }))}
                      placeholder="Заголовок подсказки"
                      style={{ marginBottom: 8 }} />
                    <textarea className="input" value={form.hint_text ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, hint_text: e.target.value || null }))}
                      placeholder="Текст подсказки — важная информация для пользователя"
                      style={{ minHeight: 80, resize: "vertical", marginBottom: 8 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="input" value={form.hint_button_label ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, hint_button_label: e.target.value || null }))}
                        placeholder="Текст кнопки-ссылки (необязательно)"
                        style={{ flex: 1 }} />
                      <input className="input" value={form.hint_button_url ?? ""}
                        onChange={(e) => setForm((p) => ({ ...p, hint_button_url: e.target.value || null }))}
                        placeholder="/help/router"
                        style={{ flex: 1 }} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Billing patterns */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Паттерны биллинговых категорий</div>
                <div className="list__sub" style={{ marginBottom: 8 }}>
                  Тарифы с совпадающей категорией попадут сюда автоматически. <strong>vpn-*</strong> — wildcard.
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input className="input" value={form.billing_pattern_input ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, billing_pattern_input: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addBillingPattern()}
                    placeholder="marzban или vpn-*" />
                  <button className="btn btn--soft" type="button" onClick={addBillingPattern}>+</button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  {(form.billing_category_keys ?? []).map((pat) => (
                    <span key={pat} className="chip chip--soft" style={{ cursor: "pointer" }}
                      onClick={() => removeBillingPattern(pat)}>
                      {pat} ✕
                    </span>
                  ))}
                </div>
                {matchedTariffs.length > 0 && (
                  <div style={{ fontSize: 12, opacity: 0.55 }}>
                    Совпадают: {matchedTariffs.map((t) => t.title).join(", ")}
                  </div>
                )}
              </div>
            </div>

            {/* Ручная привязка */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Ручная привязка тарифов</div>
                <div className="list__sub" style={{ marginBottom: 8 }}>Дополнительно к паттернам — конкретные тарифы по ID</div>
                {tariffs.length === 0 ? (
                  <div className="pre">Тарифы не загружены</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
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
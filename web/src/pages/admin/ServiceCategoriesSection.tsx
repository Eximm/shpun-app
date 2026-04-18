// web/src/pages/admin/ServiceCategoriesSection.tsx

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { ModalShell } from "./shared";

/* ─── Types ─────────────────────────────────────────────────────────────── */

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
];

const EMPTY_FORM = (): Partial<ServiceCategory> & { service_ids: number[] } => ({
  category_key: "",
  title: "",
  descr: "",
  short_descr: "",
  connect_kind: "marzban",
  sort_order: 100,
  badge: null,
  badge_tone: "soft",
  recommended: false,
  hidden: false,
  service_ids: [],
});

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
      category_key: cat.category_key,
      title:        cat.title,
      descr:        cat.descr,
      short_descr:  cat.short_descr,
      connect_kind: cat.connect_kind,
      sort_order:   cat.sort_order,
      badge:        cat.badge,
      badge_tone:   cat.badge_tone,
      recommended:  cat.recommended,
      hidden:       cat.hidden,
      service_ids:  cat.service_ids.slice(),
    });
    setIsNew(false);
    setOpened(cat);
    setSaveError(null);
  }

  function closeModal() {
    setOpened(null);
    setIsNew(false);
    setSaveError(null);
  }

  function toggleServiceId(sid: number) {
    setForm((prev) => {
      const ids = prev.service_ids ?? [];
      return {
        ...prev,
        service_ids: ids.includes(sid) ? ids.filter((x) => x !== sid) : [...ids, sid],
      };
    });
  }

  async function save() {
    setSaving(true); setSaveError(null);
    try {
      if (isNew) {
        await apiFetch("/admin/service-categories", { method: "POST", body: form });
      } else if (opened) {
        await apiFetch(`/admin/service-categories/${encodeURIComponent(opened.category_key)}`, { method: "PUT", body: form });
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
              <p className="p">Управление группами тарифов, оформлением и значками.</p>
            </div>
            <div className="admin-rowActions">
              <button className="btn btn--accent" type="button" onClick={openNew}>+ Создать</button>
              <button className="btn btn--soft"  type="button" onClick={() => void load()} disabled={loading}>
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
            ) : items.map((cat) => (
              <div key={cat.category_key} className="list__item admin-rowCard"
                style={{ opacity: cat.hidden ? 0.5 : 1 }}>
                <div className="list__main">
                  <div className="kicker">
                    {cat.category_key}
                    {cat.hidden && <span className="chip chip--warn" style={{ marginLeft: 8 }}>скрыто</span>}
                    {cat.recommended && <span className="chip chip--ok" style={{ marginLeft: 8 }}>рекомендуем</span>}
                    {cat.badge && <span className={`chip chip--${cat.badge_tone}`} style={{ marginLeft: 8 }}>{cat.badge}</span>}
                  </div>
                  <div className="list__title admin-gap-top-xs">{cat.title || "—"}</div>
                  {cat.short_descr && <div className="list__sub">{cat.short_descr}</div>}
                  <div className="admin-inlineMeta admin-gap-top-sm">
                    <span><strong>kind:</strong> {cat.connect_kind}</span>
                    <span><strong>тарифов:</strong> {cat.service_ids.length}</span>
                    <span><strong>порядок:</strong> {cat.sort_order}</span>
                  </div>
                </div>
                <div className="admin-rowActions">
                  <button className="btn btn--soft" type="button" onClick={() => openEdit(cat)}>
                    Изменить
                  </button>
                  <button className="btn btn--danger" type="button"
                    disabled={deleting === cat.category_key}
                    onClick={() => void remove(cat.category_key)}>
                    {deleting === cat.category_key ? "Удаляю…" : "Удалить"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Модалка создания / редактирования */}
      {(isNew || opened) && (
        <ModalShell
          title={isNew ? "Новая категория" : `Редактировать: ${opened?.category_key}`}
          kicker={isNew ? "Создание" : "Редактирование"}
          onClose={closeModal}
        >
          <div className="list">

            {/* category_key — только для новых */}
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

            {/* Основные поля */}
            {[
              { key: "title",       label: "Название",        ph: "Marzban" },
              { key: "short_descr", label: "Краткое описание", ph: "Стабильно и быстро. Для телефона, ПК и планшета." },
              { key: "descr",       label: "Полное описание",  ph: "Подробное описание категории" },
            ].map(({ key, label, ph }) => (
              <div key={key} className="list__item admin-tightItem">
                <div className="list__main">
                  <div className="list__title">{label}</div>
                  <input className="input" value={(form as any)[key] ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph} />
                </div>
              </div>
            ))}

            {/* connect_kind */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Тип подключения</div>
                <div className="list__sub admin-gap-top-sm">
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

            {/* Badge */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Значок (необязательно)</div>
                <input className="input" value={form.badge ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, badge: e.target.value || null }))}
                  placeholder="Рекомендуем / Акция / Новинка" />
                <div className="list__sub admin-gap-top-sm">
                  Цвет значка:
                  {BADGE_TONES.map(({ value, label }) => (
                    <label key={value} className="admin-radio" style={{ marginLeft: 12 }}>
                      <input type="radio" name="badge_tone" value={value}
                        checked={form.badge_tone === value}
                        onChange={() => setForm((p) => ({ ...p, badge_tone: value }))} />
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
                <input className="input admin-numberInput" type="number" min="0" max="9999"
                  value={form.sort_order ?? 100}
                  onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__sub admin-gap-top-sm">
                  <label className="admin-radio">
                    <input type="checkbox" checked={!!form.recommended}
                      onChange={(e) => setForm((p) => ({ ...p, recommended: e.target.checked }))} />
                    {" "}Рекомендуем
                  </label>
                  <label className="admin-radio" style={{ marginLeft: 16 }}>
                    <input type="checkbox" checked={!!form.hidden}
                      onChange={(e) => setForm((p) => ({ ...p, hidden: e.target.checked }))} />
                    {" "}Скрыть категорию
                  </label>
                </div>
              </div>
            </div>

            {/* Тарифы от биллинга */}
            <div className="list__item admin-tightItem">
              <div className="list__main">
                <div className="list__title">Тарифы из биллинга</div>
                <div className="list__sub" style={{ marginBottom: 8 }}>
                  Выберите тарифы которые войдут в эту категорию
                </div>
                {tariffs.length === 0 ? (
                  <div className="pre">Тарифы не загружены</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                    {tariffs.map((t) => (
                      <label key={t.serviceId} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input type="checkbox"
                          checked={form.service_ids.includes(t.serviceId)}
                          onChange={() => toggleServiceId(t.serviceId)} />
                        <span>
                          <strong>#{t.serviceId}</strong> {t.title}
                          <span style={{ opacity: 0.6, marginLeft: 6 }}>
                            {t.price} ₽ / {t.periodHuman}
                          </span>
                          <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 11 }}>
                            [{t.category}]
                          </span>
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
            <button className="btn btn--soft" type="button" onClick={closeModal} disabled={saving}>
              Отмена
            </button>
            <button className="btn btn--accent" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Сохраняю…" : isNew ? "Создать" : "Сохранить"}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
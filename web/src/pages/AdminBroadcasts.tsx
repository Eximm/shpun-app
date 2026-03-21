// FILE: web/src/pages/AdminBroadcasts.tsx
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../app/auth/useMe";
import { apiFetch } from "../shared/api/client";

type BroadcastItem = {
  origin_id: string;
  ts: number;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  copies: number;
};

type ListResp = { ok: true; items: BroadcastItem[] };
type DeleteResp = { ok: true; originId: string; deleted: number };

type OrderBlockMode = "off" | "same_type" | "any";
type TrialDeviceMode = "off" | "observe" | "enforce";

type AdminSettingsResp = {
  ok: 1 | true;
  settings?: {
    orderBlockMode?: OrderBlockMode;
  };
};

type AdminSettingsSaveResp = {
  ok: 1 | true;
  orderBlockMode?: OrderBlockMode;
};

type TrialProtectionStatusResp = {
  ok: true;
  mode: TrialDeviceMode;
  ttlHours: number;
  devicesWithTrial: number;
  reuse24h: number;
  blocks24h?: number;
};

type TrialProtectionEventItem = {
  id: number;
  created_at: number;
  event_type: string;
  decision: "allow" | "observe" | "block";
  reason?: string | null;
  device_token?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  user_id?: number | null;
  meta_json?: string | null;
};

type TrialProtectionEventsResp = {
  ok: true;
  items: TrialProtectionEventItem[];
};

type AdminTab = "overview" | "broadcasts" | "orderRules" | "trialProtection";

const PREVIEW_LIMIT = 180;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(tsSec: number) {
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

function truncateText(text: string | null | undefined, limit: number) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= limit) return source;
  return source.slice(0, limit).trimEnd() + "…";
}

function shortDeviceToken(token?: string | null) {
  const s = String(token || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function parseMetaJson(metaJson?: string | null): Record<string, any> | null {
  const raw = String(metaJson || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function SectionSwitcher({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button className={`btn ${active ? "btn--accent" : "btn--soft"}`} type="button" onClick={onClick}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <span>{title}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {subtitle}
        </span>
      </div>
    </button>
  );
}

function OverviewSection({ onOpenTab }: { onOpenTab: (tab: AdminTab) => void }) {
  return (
    <div className="card">
      <div className="card__body">
        <div className="kicker">Overview</div>
        <h2 className="h2">Разделы админки</h2>
        <p className="p">Здесь собираем административные инструменты в одном месте, без отдельного зоопарка страниц.</p>

        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="mini">
            <div className="mini__title">Broadcasts</div>
            <div className="mini__list">
              <div className="list__sub">
                Просмотр и удаление broadcast-новостей, которые были разосланы пользователям.
              </div>
              <div>
                <span className="chip chip--ok">Готово</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("broadcasts")}>
                  Открыть раздел
                </button>
              </div>
            </div>
          </div>

          <div className="mini">
            <div className="mini__title">Правила заказов</div>
            <div className="mini__list">
              <div className="list__sub">
                Управление ограничением новых заказов, если у пользователя уже есть неоплаченная услуга.
              </div>
              <div>
                <span className="chip chip--ok">Подключено</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("orderRules")}>
                  Открыть раздел
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="mini">
            <div className="mini__title">Trial Protection</div>
            <div className="mini__list">
              <div className="list__sub">
                Anti-abuse для тестовых услуг: режим работы, TTL устройств и журнал повторных попыток.
              </div>
              <div>
                <span className="chip chip--warn">Новый модуль</span>
              </div>
              <div className="actions actions--1">
                <button className="btn btn--soft" type="button" onClick={() => onOpenTab("trialProtection")}>
                  Открыть раздел
                </button>
              </div>
            </div>
          </div>

          <div className="mini">
            <div className="mini__title">Дальнейшее расширение</div>
            <div className="mini__list">
              <div className="list__sub">
                Сюда потом можно добавить feature flags, диагностику, системные тумблеры и прочие admin-функции.
              </div>
              <div>
                <span className="chip chip--soft">FUTURE</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BroadcastsSection() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [opened, setOpened] = useState<BroadcastItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<ListResp>("/admin/broadcasts?limit=200", { method: "GET" });
      setItems(Array.isArray(r.items) ? r.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить список broadcast-новостей.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!opened) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpened(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [opened]);

  async function removeOne(originId: string) {
    const ok = window.confirm(`Удалить broadcast у всех пользователей?\n\n${originId}`);
    if (!ok) return;

    setDeletingId(originId);
    try {
      const encoded = encodeURIComponent(originId);
      const r = await apiFetch<DeleteResp>(`/admin/broadcast/${encoded}`, { method: "DELETE" });

      setItems((prev) => prev.filter((x) => x.origin_id !== originId));
      if (opened?.origin_id === originId) setOpened(null);

      window.alert(`Удалено копий: ${r.deleted}`);
    } catch (e: any) {
      window.alert(e?.message || "Не удалось удалить broadcast.");
    } finally {
      setDeletingId(null);
    }
  }

  const sorted = useMemo(
    () => items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    [items],
  );

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="kicker">Broadcasts</div>
          <h2 className="h2">Управление broadcast-новостями</h2>
          <p className="p">Здесь можно просматривать и удалять broadcast-новости у всех пользователей.</p>

          <div className="actions actions--1" style={{ marginTop: 12 }}>
            <button className="btn btn--accent" type="button" onClick={load} disabled={loading}>
              {loading ? "Обновляю…" : "Обновить"}
            </button>
          </div>

          {error ? <div className="pre" style={{ marginTop: 12 }}>{error}</div> : null}

          <div className="list" style={{ marginTop: 12 }}>
            {loading && !sorted.length ? (
              <>
                <div className="skeleton h1" />
                <div className="skeleton p" />
                <div className="skeleton p" />
              </>
            ) : sorted.length === 0 ? (
              <div className="pre">Broadcast-новостей пока нет.</div>
            ) : (
              sorted.map((item) => {
                const preview = truncateText(item.message, PREVIEW_LIMIT);

                return (
                  <div key={item.origin_id} className="list__item">
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.ts)}</div>
                      <div className="list__title" style={{ marginTop: 6 }}>
                        {item.title || "Без заголовка"}
                      </div>
                      {preview ? <div className="list__sub">{preview}</div> : null}
                      <div className="list__sub" style={{ marginTop: 8 }}>
                        <strong>origin:</strong> {item.origin_id}
                      </div>
                      <div className="list__sub">
                        <strong>copies:</strong> {item.copies}
                      </div>

                      <div className="actions actions--2" style={{ marginTop: 12 }}>
                        <button className="btn btn--soft" type="button" onClick={() => setOpened(item)}>
                          Открыть
                        </button>
                        <button
                          className="btn btn--danger"
                          type="button"
                          disabled={deletingId === item.origin_id}
                          onClick={() => removeOne(item.origin_id)}
                        >
                          {deletingId === item.origin_id ? "Удаляю…" : "Удалить"}
                        </button>
                      </div>
                    </div>

                    <div className="list__side">
                      <span className="chip chip--soft">BROADCAST</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {opened ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-broadcast-title"
          onClick={() => setOpened(null)}
        >
          <div className="modal__card card" onClick={(ev) => ev.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div>
                  <div className="kicker">{formatDateTime(opened.ts)}</div>
                  <div id="admin-broadcast-title" className="modal__title">
                    {opened.title || "Без заголовка"}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn--soft modal__close"
                  onClick={() => setOpened(null)}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>

              <div className="modal__content">
                <div className="list__sub feed__fulltext">
                  <strong>origin:</strong> {opened.origin_id}
                </div>
                <div className="list__sub" style={{ marginTop: 8 }}>
                  <strong>copies:</strong> {opened.copies}
                </div>
                {opened.message ? (
                  <div className="list__sub feed__fulltext" style={{ marginTop: 14 }}>
                    {opened.message}
                  </div>
                ) : null}

                <div className="actions actions--1" style={{ marginTop: 16 }}>
                  <button
                    className="btn btn--danger"
                    type="button"
                    disabled={deletingId === opened.origin_id}
                    onClick={() => removeOne(opened.origin_id)}
                  >
                    {deletingId === opened.origin_id ? "Удаляю…" : "Удалить у всех"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function OrderRulesSection() {
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
        body: JSON.stringify({ orderBlockMode: mode }),
        headers: { "Content-Type": "application/json" },
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
        <p className="p">
          Эта настройка управляет блокировкой новых заказов, если у пользователя уже есть неоплаченная услуга.
        </p>

        {loading ? (
          <div className="list" style={{ marginTop: 12 }}>
            <div className="skeleton h1" />
            <div className="skeleton p" />
            <div className="skeleton p" />
          </div>
        ) : (
          <>
            <div className="list" style={{ marginTop: 12 }}>
              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">Режим блокировки</div>
                  <div className="list__sub" style={{ marginTop: 8 }}>
                    <label style={{ display: "block", marginBottom: 10 }}>
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="off"
                        checked={mode === "off"}
                        onChange={() => setMode("off")}
                      />{" "}
                      <strong>off</strong> — не ограничивать новые заказы
                    </label>

                    <label style={{ display: "block", marginBottom: 10 }}>
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="same_type"
                        checked={mode === "same_type"}
                        onChange={() => setMode("same_type")}
                      />{" "}
                      <strong>same_type</strong> — нельзя оформить новую услугу того же типа, если уже есть неоплаченная
                    </label>

                    <label style={{ display: "block" }}>
                      <input
                        type="radio"
                        name="orderBlockMode"
                        value="any"
                        checked={mode === "any"}
                        onChange={() => setMode("any")}
                      />{" "}
                      <strong>any</strong> — нельзя оформить никакую новую услугу, пока есть неоплаченная
                    </label>
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">{savedMode}</span>
                </div>
              </div>

              <div className="list__item">
                <div className="list__main">
                  <div className="list__title">Как это будет работать</div>
                  <div className="list__sub">
                    Проверка выполняется на backend при создании заказа. Интерфейс только управляет режимом.
                  </div>
                </div>
                <div className="list__side">
                  <span className="chip chip--soft">API</span>
                </div>
              </div>
            </div>

            {error ? <div className="pre" style={{ marginTop: 12 }}>{error}</div> : null}
            {okText ? <div className="pre" style={{ marginTop: 12 }}>{okText}</div> : null}

            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--soft" type="button" onClick={load} disabled={loading || saving}>
                Обновить
              </button>
              <button
                className="btn btn--accent"
                type="button"
                onClick={save}
                disabled={saving || !changed}
              >
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TrialProtectionSection() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [status, setStatus] = useState<TrialProtectionStatusResp | null>(null);
  const [events, setEvents] = useState<TrialProtectionEventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);
  const [modeDraft, setModeDraft] = useState<TrialDeviceMode>("observe");

  async function load(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const [statusResp, eventsResp] = await Promise.all([
        apiFetch<TrialProtectionStatusResp>("/admin/trial-protection/status", { method: "GET" }),
        apiFetch<TrialProtectionEventsResp>("/admin/trial-protection/events?limit=30", { method: "GET" }),
      ]);

      setStatus(statusResp);
      setModeDraft(statusResp.mode);
      setEvents(Array.isArray(eventsResp.items) ? eventsResp.items : []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные Trial Protection.");
      if (!silent) {
        setStatus(null);
        setEvents([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveMode() {
    setSavingMode(true);
    setError(null);
    setOkText(null);

    try {
      const r = await apiFetch<{ ok: true; mode: TrialDeviceMode }>("/admin/trial-protection/mode", {
        method: "PUT",
        body: { mode: modeDraft },
      });

      setOkText(`Режим сохранён: ${r.mode}`);
      await load({ silent: true });
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить режим.");
    } finally {
      setSavingMode(false);
    }
  }

  const sortedEvents = useMemo(
    () => events.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [events],
  );

  function renderDecisionChip(decision: TrialProtectionEventItem["decision"]) {
    if (decision === "block") return <span className="chip chip--bad">BLOCK</span>;
    if (decision === "observe") return <span className="chip chip--warn">OBSERVE</span>;
    return <span className="chip chip--ok">ALLOW</span>;
  }

  const modeChanged = modeDraft !== (status?.mode || "observe");

  return (
    <>
      <div className="card">
        <div className="card__body">
          <div className="kicker">Trial protection</div>
          <h2 className="h2">Защита тестовых доступов</h2>
          <p className="p">
            Контроль использования trial-услуг на уровне устройств: режим работы, TTL и повторные попытки.
          </p>

          {loading ? (
            <div className="list" style={{ marginTop: 12 }}>
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : (
            <>
              {error ? <div className="pre" style={{ marginTop: 12 }}>{error}</div> : null}
              {okText ? <div className="pre" style={{ marginTop: 12 }}>{okText}</div> : null}

              <div className="grid2" style={{ marginTop: 12 }}>
                <div className="mini">
                  <div className="mini__title">Текущее состояние</div>
                  <div className="mini__list">
                    <div className="list__sub">
                      Текущий режим anti-abuse для тестовых услуг.
                    </div>
                    <div>
                      <span
                        className={`chip ${
                          status?.mode === "enforce"
                            ? "chip--bad"
                            : status?.mode === "observe"
                              ? "chip--warn"
                              : "chip--soft"
                        }`}
                      >
                        {status?.mode || "unknown"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mini">
                  <div className="mini__title">TTL окна</div>
                  <div className="mini__list">
                    <div className="list__sub">
                      Через сколько часов trial-lock на устройстве автоматически сбрасывается.
                    </div>
                    <div>
                      <span className="chip chip--soft">{status?.ttlHours ?? "—"}h</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="list" style={{ marginTop: 12 }}>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Режим работы</div>
                    <div className="list__sub" style={{ marginTop: 8 }}>
                      <label style={{ display: "block", marginBottom: 10 }}>
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="off"
                          checked={modeDraft === "off"}
                          onChange={() => setModeDraft("off")}
                        />{" "}
                        <strong>off</strong> — защита отключена
                      </label>

                      <label style={{ display: "block", marginBottom: 10 }}>
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="observe"
                          checked={modeDraft === "observe"}
                          onChange={() => setModeDraft("observe")}
                        />{" "}
                        <strong>observe</strong> — только наблюдение и логирование
                      </label>

                      <label style={{ display: "block" }}>
                        <input
                          type="radio"
                          name="trialDeviceMode"
                          value="enforce"
                          checked={modeDraft === "enforce"}
                          onChange={() => setModeDraft("enforce")}
                        />{" "}
                        <strong>enforce</strong> — блокировать повторный trial на устройстве
                      </label>
                    </div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--soft">{status?.mode || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="grid2" style={{ marginTop: 12 }}>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Устройств с активным trial-lock</div>
                    <div className="list__sub">{status?.devicesWithTrial ?? 0}</div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--soft">DEVICES</span>
                  </div>
                </div>

                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Повторные попытки за 24 часа</div>
                    <div className="list__sub">{status?.reuse24h ?? 0}</div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--warn">24H</span>
                  </div>
                </div>
              </div>

              <div className="list" style={{ marginTop: 12 }}>
                <div className="list__item">
                  <div className="list__main">
                    <div className="list__title">Блокировок за 24 часа</div>
                    <div className="list__sub">{status?.blocks24h ?? 0}</div>
                  </div>
                  <div className="list__side">
                    <span className="chip chip--bad">BLOCKS</span>
                  </div>
                </div>
              </div>

              <div className="actions actions--2" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--soft"
                  type="button"
                  onClick={() => void load({ silent: true })}
                  disabled={refreshing || savingMode}
                >
                  {refreshing ? "Обновляю…" : "Обновить"}
                </button>
                <button
                  className="btn btn--accent"
                  type="button"
                  onClick={saveMode}
                  disabled={savingMode || !modeChanged}
                >
                  {savingMode ? "Сохраняю…" : "Сохранить режим"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <div className="kicker">Events</div>
          <h2 className="h2">Последние события</h2>
          <p className="p">
            Последние записи anti-abuse журнала. Здесь видно reuse устройства, решение системы и связанный service id.
          </p>

          {loading ? (
            <div className="list" style={{ marginTop: 12 }}>
              <div className="skeleton h1" />
              <div className="skeleton p" />
              <div className="skeleton p" />
            </div>
          ) : error ? (
            <div className="pre" style={{ marginTop: 12 }}>{error}</div>
          ) : sortedEvents.length === 0 ? (
            <div className="pre" style={{ marginTop: 12 }}>Событий пока нет.</div>
          ) : (
            <div className="list" style={{ marginTop: 12 }}>
              {sortedEvents.map((item) => {
                const meta = parseMetaJson(item.meta_json);
                const serviceId = meta?.serviceId ?? meta?.service_id ?? null;

                return (
                  <div key={item.id} className="list__item">
                    <div className="list__main">
                      <div className="kicker">{formatDateTime(item.created_at)}</div>

                      <div className="list__title" style={{ marginTop: 6 }}>
                        {item.event_type}
                      </div>

                      <div className="list__sub">
                        <strong>reason:</strong> {item.reason || "—"}
                      </div>

                      <div className="list__sub">
                        <strong>device:</strong> {shortDeviceToken(item.device_token)}
                      </div>

                      <div className="list__sub">
                        <strong>ip:</strong> {item.ip || "—"}
                      </div>

                      <div className="list__sub">
                        <strong>user:</strong> {item.user_id ?? "—"}
                      </div>

                      <div className="list__sub">
                        <strong>service:</strong> {serviceId ?? "—"}
                      </div>

                      {item.user_agent ? (
                        <div className="list__sub">
                          <strong>ua:</strong> {truncateText(item.user_agent, 140)}
                        </div>
                      ) : null}
                    </div>

                    <div className="list__side">
                      {renderDecisionChip(item.decision)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
export function AdminBroadcasts() {
  const { me, loading: meLoading } = useMe() as any;
  const isAdmin = Boolean(me?.profile?.isAdmin || me?.admin?.isAdmin);
  const [tab, setTab] = useState<AdminTab>("overview");

  if (meLoading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <h1 className="h1">Admin</h1>
            <p className="p">Загрузка…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div className="section">
      <div className="card">
        <div className="card__body">
          <div className="kicker">Admin panel</div>
          <h1 className="h1">Мини-админка</h1>
          <p className="p">Базовая административная страница для управления служебными функциями приложения.</p>

          <div className="grid2" style={{ marginTop: 12 }}>
            <SectionSwitcher
              active={tab === "overview"}
              onClick={() => setTab("overview")}
              title="Обзор"
              subtitle="Структура и точки роста"
            />
            <SectionSwitcher
              active={tab === "broadcasts"}
              onClick={() => setTab("broadcasts")}
              title="Broadcasts"
              subtitle="Просмотр и удаление"
            />
          </div>

          <div className="actions actions--2" style={{ marginTop: 10 }}>
            <SectionSwitcher
              active={tab === "orderRules"}
              onClick={() => setTab("orderRules")}
              title="Правила заказов"
              subtitle="Управление orderBlockMode"
            />
            <SectionSwitcher
              active={tab === "trialProtection"}
              onClick={() => setTab("trialProtection")}
              title="Trial Protection"
              subtitle="Anti-abuse и устройства"
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === "overview" ? <OverviewSection onOpenTab={setTab} /> : null}
        {tab === "broadcasts" ? <BroadcastsSection /> : null}
        {tab === "orderRules" ? <OrderRulesSection /> : null}
        {tab === "trialProtection" ? <TrialProtectionSection /> : null}
      </div>
    </div>
  );
}

export default AdminBroadcasts;
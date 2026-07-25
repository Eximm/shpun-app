import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

type MonitoredServer = {
  id: number;
  title: string;
  host: string;
  exporter_url: string;
  kind: "vpn" | "infra";
  active: number;
  sort_order: number;
  uplink_mbps: number | null;
};

const EMPTY = {
  title: "",
  host: "",
  exporterUrl: "",
  kind: "vpn" as "vpn" | "infra",
  sortOrder: 100,
  uplinkMbps: "",
  active: true,
};

export function ServerStatusSection() {
  const [items, setItems] = useState<MonitoredServer[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ ok: true; items: MonitoredServer[] }>("/admin/monitored-servers", { method: "GET" });
      setItems(r.items ?? []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить серверы мониторинга.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function edit(item: MonitoredServer) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      host: item.host || "",
      exporterUrl: item.exporter_url || "",
      kind: item.kind === "infra" ? "infra" : "vpn",
      sortOrder: Number(item.sort_order ?? 100),
      uplinkMbps: item.uplink_mbps != null ? String(item.uplink_mbps) : "",
      active: Number(item.active) === 1,
    });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      sortOrder: Number(form.sortOrder || 100),
      uplinkMbps: form.uplinkMbps ? Number(form.uplinkMbps) : null,
    };
    try {
      if (editingId) {
        await apiFetch(`/admin/monitored-servers/${editingId}`, { method: "PUT", body });
      } else {
        await apiFetch("/admin/monitored-servers", { method: "POST", body });
      }
      reset();
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить сервер.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить сервер из мониторинга?")) return;
    await apiFetch(`/admin/monitored-servers/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="admin-stack">
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Server status</div>
              <h2 className="h2">Мониторинг серверов</h2>
              <p className="p">Добавляем домен, exporter и тип сервера. Пользователю показываем только лампочку, аптайм, отклик и компактную нагрузку.</p>
            </div>
            <button className="btn" type="button" onClick={() => void load()} disabled={loading}>Обновить</button>
          </div>

          <div className="admin-serverStatus-form">
            <label className="field">
              <span className="field__label">Название</span>
              <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="NL · Amsterdam" />
            </label>
            <label className="field">
              <span className="field__label">Домен/IP</span>
              <input className="input" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} placeholder="nl-01.example.com" />
            </label>
            <label className="field">
              <span className="field__label">Node exporter URL</span>
              <input className="input" value={form.exporterUrl} onChange={(e) => setForm((p) => ({ ...p, exporterUrl: e.target.value }))} placeholder="http://nl-01.example.com:9100/metrics" />
            </label>
            <label className="field">
              <span className="field__label">Тип</span>
              <select className="input" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value === "infra" ? "infra" : "vpn" }))}>
                <option value="vpn">VPN-сервер</option>
                <option value="infra">Кабинет/подписки</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Порядок</span>
              <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: Number(e.target.value) }))} />
            </label>
            <label className="field">
              <span className="field__label">Uplink, Mbps</span>
              <input className="input" type="number" value={form.uplinkMbps} onChange={(e) => setForm((p) => ({ ...p, uplinkMbps: e.target.value }))} placeholder="1000" />
            </label>
            <label className="admin-serverStatus-check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
              Активен
            </label>
          </div>

          <div className="actions actions--2 admin-gap-top-sm">
            <button className="btn btn--primary" type="button" onClick={() => void save()} disabled={busy || !form.host.trim()}>
              {editingId ? "Сохранить" : "Добавить сервер"}
            </button>
            {editingId && <button className="btn" type="button" onClick={reset}>Отмена</button>}
          </div>

          {error && <div className="pre admin-gap-top-sm">{error}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <h2 className="h2">Серверы</h2>
              <p className="p">{loading ? "Загружаем…" : `Добавлено: ${items.length}`}</p>
            </div>
          </div>

          <div className="admin-serverStatus-list">
            {items.map((item) => (
              <div className="admin-serverStatus-item" key={item.id}>
                <div>
                  <div className="admin-serverStatus-title">
                    <span className={`serverStatus-dot serverStatus-dot--${item.active ? "online" : "offline"}`} />
                    {item.title || item.host}
                  </div>
                  <div className="list__sub">{item.kind === "infra" ? "Кабинет/подписки" : "VPN"} · {item.host}</div>
                  <div className="list__sub">{item.exporter_url}</div>
                </div>
                <div className="actions">
                  <button className="btn btn--soft" type="button" onClick={() => edit(item)}>Изменить</button>
                  <button className="btn btn--danger" type="button" onClick={() => void remove(item.id)}>Удалить</button>
                </div>
              </div>
            ))}
            {!loading && items.length === 0 && <div className="pre">Пока пусто. Добавьте первый сервер мониторинга.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

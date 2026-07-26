import { useEffect, useMemo, useState } from "react";
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

const DEFAULT_SERVER_MATRIX = `# Название | домен | тип | uplink Mbps | порядок
Warszawa PL2 | pl2.shpyn.online | vpn | 1000 | 10
Prague CZ | cz.shpyn.online | vpn | 1000 | 20
Moscow RU | msk.shpyn.online | vpn | 1000 | 30
Moscow2 RU | msk2.shpyn.online | vpn | 1000 | 40
Stockholm SWE | swe.shpyn.online | vpn | 1000 | 50
Fremont US | us.shpyn.online | vpn | 1000 | 60
Helsinki FI | fi.shpyn.online | vpn | 1000 | 70
Saint-Petersburg RU | spb.shpyn.online | vpn | 1000 | 80
Meppel NL | nl.shpyn.online | vpn | 1000 | 90
Tallinn TL | tl.shpyn.online | vpn | 1000 | 100
Frankfurt DE | de.shpyn.online | vpn | 1000 | 110
Frankfurt-2 DE | de2.shpyn.online | vpn | 1000 | 120
Warszawa PL | pl.shpyn.online | vpn | 1000 | 130
Core · кабинет | core.shpyn.online | infra | 1000 | 1000
CoreX · авторизация подписок | corex.shpyn.online | infra | 1000 | 1010`;

type MatrixRow = {
  line: number;
  title: string;
  host: string;
  kind: "vpn" | "infra";
  uplinkMbps: string;
  sortOrder: number;
  exporterUrl: string;
};

function splitMatrixLine(line: string) {
  if (line.includes("|")) return line.split("|").map((x) => x.trim());
  if (line.includes(";")) return line.split(";").map((x) => x.trim());
  if (line.includes("\t")) return line.split("\t").map((x) => x.trim());
  return line.split(",").map((x) => x.trim());
}

function parseServerMatrix(text: string) {
  const rows: MatrixRow[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [titleRaw, hostRaw, kindRaw, uplinkRaw, sortRaw, exporterRaw] = splitMatrixLine(line);
    const host = String(hostRaw ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
    if (!host) {
      errors.push(`Строка ${lineNo}: нет домена`);
      return;
    }
    const kind = String(kindRaw ?? "").trim().toLowerCase() === "infra" ? "infra" : "vpn";
    const sortOrder = Number.isFinite(Number(sortRaw)) ? Math.trunc(Number(sortRaw)) : 100 + rows.length * 10;
    rows.push({
      line: lineNo,
      title: String(titleRaw ?? "").trim() || host,
      host,
      kind,
      uplinkMbps: Number.isFinite(Number(uplinkRaw)) && Number(uplinkRaw) > 0 ? String(Number(uplinkRaw)) : "",
      sortOrder,
      exporterUrl: String(exporterRaw ?? "").trim(),
    });
  });
  return { rows, errors };
}

export function ServerStatusSection() {
  const [items, setItems] = useState<MonitoredServer[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [matrixText, setMatrixText] = useState(DEFAULT_SERVER_MATRIX);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const matrix = useMemo(() => parseServerMatrix(matrixText), [matrixText]);

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

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setEditorOpen(true);
  }

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
    setEditorOpen(true);
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setEditorOpen(false);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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

  async function importMatrix() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const existingHosts = new Set(items.map((x) => x.host.trim().toLowerCase()).filter(Boolean));
      const rows = matrix.rows.filter((row) => !existingHosts.has(row.host.toLowerCase()));
      if (matrix.errors.length) {
        setError(matrix.errors.join("\n"));
        return;
      }
      if (!rows.length) {
        setNotice("Новых серверов нет — все домены из матрицы уже добавлены.");
        return;
      }
      let added = 0;
      for (const row of rows) {
        await apiFetch("/admin/monitored-servers", {
          method: "POST",
          body: {
            title: row.title,
            host: row.host,
            exporterUrl: row.exporterUrl,
            kind: row.kind,
            sortOrder: row.sortOrder,
            uplinkMbps: row.uplinkMbps ? Number(row.uplinkMbps) : null,
            active: true,
          },
        });
        added += 1;
      }
      setNotice(`Добавлено серверов: ${added}. Пропущено дублей: ${matrix.rows.length - rows.length}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось импортировать матрицу серверов.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-stack">
      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Server status</div>
              <h2 className="h2">Мониторинг серверов</h2>
              <p className="p">Компактное управление нодами мониторинга. Домен и exporter остаются внутренней кухней.</p>
            </div>
            <div className="actions">
              <button className="btn" type="button" onClick={() => void load()} disabled={loading}>Обновить список</button>
              <button className="btn btn--primary" type="button" onClick={startCreate}>Новая нода</button>
            </div>
          </div>

          {error && <div className="pre admin-gap-top-sm">{error}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card__body">
          <div className="admin-sectionHead">
            <div>
              <div className="kicker">Matrix import</div>
              <h2 className="h2">Матрица серверов</h2>
              <p className="p">Быстрое добавление пачки серверов. Формат строки: название | домен | тип | uplink Mbps | порядок | exporter URL. Если exporter URL пустой — соберём автоматически как http://домен:9100/metrics.</p>
            </div>
          </div>

          <textarea
            className="input admin-serverStatus-matrix"
            value={matrixText}
            onChange={(e) => setMatrixText(e.target.value)}
            spellCheck={false}
          />

          <div className="admin-serverStatus-matrixPreview">
            <span>Строк к добавлению: <b>{matrix.rows.length}</b></span>
            <span>Ошибок: <b>{matrix.errors.length}</b></span>
            <span>Новые: <b>{matrix.rows.filter((row) => !items.some((item) => item.host.toLowerCase() === row.host.toLowerCase())).length}</b></span>
          </div>

          <div className="actions actions--2 admin-gap-top-sm">
            <button className="btn btn--primary" type="button" onClick={() => void importMatrix()} disabled={busy || matrix.rows.length === 0}>
              Добавить матрицу
            </button>
            <button className="btn" type="button" onClick={() => setMatrixText(DEFAULT_SERVER_MATRIX)} disabled={busy}>
              Вернуть шаблон
            </button>
          </div>

          {matrix.errors.length > 0 && <div className="pre admin-gap-top-sm">{matrix.errors.join("\n")}</div>}
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

      {editorOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={reset}>
          <div className="modalCard admin-serverStatus-editor" role="dialog" aria-modal="true" aria-label={editingId ? "Редактировать ноду" : "Добавить ноду"} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalCard__head">
              <div>
                <div className="kicker">Node exporter</div>
                <h3 className="modalCard__title">{editingId ? "Редактировать ноду" : "Новая нода"}</h3>
              </div>
              <button className="modalCard__close" type="button" onClick={reset}>×</button>
            </div>

            <div className="admin-serverStatus-form admin-serverStatus-form--modal">
              <label className="field">
                <span className="field__label">Название</span>
                <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Riga LV" />
              </label>
              <label className="field">
                <span className="field__label">Домен/IP</span>
                <input className="input" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} placeholder="lv.shpyn.online" />
              </label>
              <label className="field admin-serverStatus-fieldWide">
                <span className="field__label">Node exporter URL</span>
                <input className="input" value={form.exporterUrl} onChange={(e) => setForm((p) => ({ ...p, exporterUrl: e.target.value }))} placeholder="http://lv.shpyn.online:9100/metrics" />
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
              <label className="admin-serverStatus-check admin-serverStatus-check--modal">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                Активна
              </label>
            </div>

            <div className="actions actions--2 admin-gap-top-sm">
              <button className="btn btn--primary" type="button" onClick={() => void save()} disabled={busy || !form.host.trim()}>
                {editingId ? "Сохранить" : "Добавить"}
              </button>
              <button className="btn" type="button" onClick={reset} disabled={busy}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

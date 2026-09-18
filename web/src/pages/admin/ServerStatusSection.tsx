import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader } from "./shared";

type TFn = ReturnType<typeof useI18n>["t"];

type MonitoredServer = {
  id: number;
  title: string;
  host: string;
  exporter_url: string;
  kind: "vpn" | "infra";
  country_code: string | null;
  active: number;
  sort_order: number;
  uplink_mbps: number | null;
};

const EMPTY = {
  title: "",
  host: "",
  exporterUrl: "",
  kind: "vpn" as "vpn" | "infra",
  countryCode: "",
  sortOrder: 100,
  uplinkMbps: "",
  active: true,
};

const DEFAULT_SERVER_MATRIX = `# Название | домен | тип | uplink Mbps | порядок | exporter URL | страна
Warszawa PL2 | pl2.shpyn.online | vpn | 1000 | 10 | | PL
Prague CZ | cz.shpyn.online | vpn | 1000 | 20 | | CZ
Moscow RU | msk.shpyn.online | vpn | 1000 | 30 | | RU
Moscow2 RU | msk2.shpyn.online | vpn | 1000 | 40 | | RU
Stockholm SWE | swe.shpyn.online | vpn | 1000 | 50 | | SE
Fremont US | us.shpyn.online | vpn | 1000 | 60 | | US
Helsinki FI | fi.shpyn.online | vpn | 1000 | 70 | | FI
Saint-Petersburg RU | spb.shpyn.online | vpn | 1000 | 80 | | RU
Meppel NL | nl.shpyn.online | vpn | 1000 | 90 | | NL
Tallinn TL | tl.shpyn.online | vpn | 1000 | 100 | | EE
Frankfurt DE | de.shpyn.online | vpn | 1000 | 110 | | DE
Frankfurt-2 DE | de2.shpyn.online | vpn | 1000 | 120 | | DE
Warszawa PL | pl.shpyn.online | vpn | 1000 | 130 | | PL
Core · кабинет | core.shpyn.online | infra | 1000 | 1000 | |
CoreX · авторизация подписок | corex.shpyn.online | infra | 1000 | 1010 | |`;

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);

const REGION_NAMES_BY_LOCALE = new Map<string, Intl.DisplayNames>();
function regionNames(locale: string): Intl.DisplayNames {
  let names = REGION_NAMES_BY_LOCALE.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: "region" });
    REGION_NAMES_BY_LOCALE.set(locale, names);
  }
  return names;
}

function countryFlag(code: string) {
  return String.fromCodePoint(...code.split("").map((char) => 127397 + char.charCodeAt(0)));
}

function countryOptions(locale: string) {
  const names = regionNames(locale);
  return COUNTRY_CODES
    .map((code) => ({ code, label: names.of(code) || code }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

type MatrixRow = {
  line: number;
  title: string;
  host: string;
  kind: "vpn" | "infra";
  countryCode: string;
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

function parseServerMatrix(text: string, t: TFn) {
  const rows: MatrixRow[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [titleRaw, hostRaw, kindRaw, uplinkRaw, sortRaw, exporterRaw, countryRaw] = splitMatrixLine(line);
    const host = String(hostRaw ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
    if (!host) {
      errors.push(t("admin.servers.parse.no_host", { line: lineNo }));
      return;
    }
    const kind = String(kindRaw ?? "").trim().toLowerCase() === "infra" ? "infra" : "vpn";
    const countryCode = String(countryRaw ?? "").trim().toUpperCase();
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
      errors.push(t("admin.servers.parse.bad_country", { line: lineNo }));
      return;
    }
    const sortOrder = Number.isFinite(Number(sortRaw)) ? Math.trunc(Number(sortRaw)) : 100 + rows.length * 10;
    rows.push({
      line: lineNo,
      title: String(titleRaw ?? "").trim() || host,
      host,
      kind,
      countryCode,
      uplinkMbps: Number.isFinite(Number(uplinkRaw)) && Number(uplinkRaw) > 0 ? String(Number(uplinkRaw)) : "",
      sortOrder,
      exporterUrl: String(exporterRaw ?? "").trim(),
    });
  });
  return { rows, errors };
}

export function ServerStatusSection() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<MonitoredServer[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [matrixText, setMatrixText] = useState(DEFAULT_SERVER_MATRIX);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const matrix = useMemo(() => parseServerMatrix(matrixText, t), [matrixText, t]);
  const countryOptionsList = useMemo(() => countryOptions(locale), [locale]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ ok: true; items: MonitoredServer[] }>("/admin/monitored-servers", { method: "GET" });
      setItems(r.items ?? []);
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.load"));
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
      countryCode: item.country_code || "",
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
      setError(e?.message || t("admin.servers.err.save"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t("admin.servers.confirm.delete"))) return;
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
        setNotice(t("admin.servers.notice.no_new"));
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
            countryCode: row.countryCode,
            sortOrder: row.sortOrder,
            uplinkMbps: row.uplinkMbps ? Number(row.uplinkMbps) : null,
            active: true,
          },
        });
        added += 1;
      }
      setNotice(t("admin.servers.notice.imported", { added, skipped: matrix.rows.length - rows.length }));
      await load();
    } catch (e: any) {
      setError(e?.message || t("admin.servers.err.import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-stack">
      <div className="card">
        <div className="card__body">
          <AdminSectionHeader
            kicker={t("admin.tab.serverStatus")}
            title={t("admin.section.servers.title")}
            subtitle={loading ? t("common.loading") : t("admin.section.servers.nodes", { count: items.length })}
            actions={
              <>
                <button className="btn" type="button" onClick={() => void load()} disabled={loading}>{t("common.refresh")}</button>
                <button className="btn btn--primary" type="button" onClick={startCreate}>{t("admin.servers.new")}</button>
              </>
            }
          />

          {error && <div className="pre admin-gap-top-sm">{error}</div>}
          {notice && <div className="pre admin-gap-top-sm">{notice}</div>}

          <div className="admin-serverStatus-list admin-gap-top-md">
            {items.map((item) => (
              <div className="admin-serverStatus-item" key={item.id}>
                <div>
                  <div className="admin-serverStatus-title">
                    <span className={`serverStatus-dot serverStatus-dot--${item.active ? "online" : "offline"}`} />
                    {item.title || item.host}
                  </div>
                  <div className="list__sub">{item.kind === "infra" ? t("admin.servers.kind.infra") : "VPN"}{item.country_code ? ` · ${item.country_code}` : ""} · {item.host}</div>
                  <div className="list__sub">{item.exporter_url}</div>
                </div>
                <div className="actions">
                  <button className="btn btn--soft" type="button" onClick={() => edit(item)}>{t("common.edit")}</button>
                  <button className="btn btn--danger" type="button" onClick={() => void remove(item.id)}>{t("common.delete")}</button>
                </div>
              </div>
            ))}
            {!loading && items.length === 0 && <div className="pre">{t("admin.servers.empty")}</div>}
          </div>
        </div>
      </div>

      <details className="admin-details">
        <summary className="admin-details__summary">{t("admin.servers.matrix.title")}</summary>
        <div className="admin-serverStatus-matrixPanel">
          <p className="admin-sectionHeader__sub admin-gap-top-sm">{t("admin.servers.matrix.hint")}</p>

          <textarea
            className="input admin-serverStatus-matrix"
            value={matrixText}
            onChange={(e) => setMatrixText(e.target.value)}
            spellCheck={false}
          />

          <div className="admin-serverStatus-matrixPreview">
            <span>{t("admin.servers.matrix.rows")} <b>{matrix.rows.length}</b></span>
            <span>{t("admin.servers.matrix.errors")} <b>{matrix.errors.length}</b></span>
            <span>{t("admin.servers.matrix.new")} <b>{matrix.rows.filter((row) => !items.some((item) => item.host.toLowerCase() === row.host.toLowerCase())).length}</b></span>
          </div>

          <div className="actions actions--2 admin-gap-top-sm">
            <button className="btn btn--primary" type="button" onClick={() => void importMatrix()} disabled={busy || matrix.rows.length === 0}>
              {t("admin.servers.matrix.add")}
            </button>
            <button className="btn" type="button" onClick={() => setMatrixText(DEFAULT_SERVER_MATRIX)} disabled={busy}>
              {t("admin.servers.matrix.reset_template")}
            </button>
          </div>

          {matrix.errors.length > 0 && <div className="pre admin-gap-top-sm">{matrix.errors.join("\n")}</div>}
        </div>
      </details>

      {editorOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={reset}>
          <div className="modalCard admin-serverStatus-editor" role="dialog" aria-modal="true" aria-label={editingId ? t("admin.servers.editor.edit_title") : t("admin.servers.editor.add_title")} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalCard__head">
              <div>
                <div className="kicker">Node exporter</div>
                <h3 className="modalCard__title">{editingId ? t("admin.servers.editor.edit_title") : t("admin.servers.editor.add_title")}</h3>
              </div>
              <button className="modalCard__close" type="button" onClick={reset}>×</button>
            </div>

            <div className="admin-serverStatus-form admin-serverStatus-form--modal">
              <label className="field">
                <span className="field__label">{t("admin.servers.field.title")}</span>
                <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Riga LV" />
              </label>
              <label className="field">
                <span className="field__label">{t("admin.servers.field.host")}</span>
                <input className="input" value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} placeholder="lv.shpyn.online" />
              </label>
              <label className="field admin-serverStatus-fieldWide">
                <span className="field__label">Node exporter URL</span>
                <input className="input" value={form.exporterUrl} onChange={(e) => setForm((p) => ({ ...p, exporterUrl: e.target.value }))} placeholder="http://lv.shpyn.online:9100/metrics" />
              </label>
              <label className="field">
                <span className="field__label">{t("admin.servers.field.kind")}</span>
                <select className="input" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value === "infra" ? "infra" : "vpn" }))}>
                  <option value="vpn">{t("admin.servers.kind.vpn")}</option>
                  <option value="infra">{t("admin.servers.kind.infra")}</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">{form.kind === "vpn" ? t("admin.servers.field.country_required") : t("admin.servers.field.country")}</span>
                <select className="input" value={form.countryCode} onChange={(e) => setForm((p) => ({ ...p, countryCode: e.target.value }))}>
                  <option value="">{form.kind === "vpn" ? t("admin.servers.field.country_choose") : t("admin.servers.field.country_none")}</option>
                  {countryOptionsList.map(({ code, label }) => <option key={code} value={code}>{countryFlag(code)} {label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field__label">{t("admin.servers.field.sort")}</span>
                <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: Number(e.target.value) }))} />
              </label>
              <label className="field">
                <span className="field__label">Uplink, Mbps</span>
                <input className="input" type="number" value={form.uplinkMbps} onChange={(e) => setForm((p) => ({ ...p, uplinkMbps: e.target.value }))} placeholder="1000" />
              </label>
              <label className="admin-serverStatus-check admin-serverStatus-check--modal">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                {t("admin.servers.field.active")}
              </label>
            </div>

            <div className="actions actions--2 admin-gap-top-sm">
              <button className="btn btn--primary" type="button" onClick={() => void save()} disabled={busy || !form.host.trim() || (form.kind === "vpn" && !form.countryCode)}>
                {editingId ? t("common.save") : t("admin.servers.action.add")}
              </button>
              <button className="btn" type="button" onClick={reset} disabled={busy}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// web/src/pages/admin/gateway/ServersTab.tsx
//
// Backends grouped by family (reality / router / …). Each backend is a compact
// card with one row per server: live status, address, weight, sessions and a
// single "⋯" menu. Runtime actions (enable / drain / maint / weight) apply
// instantly; structural ones (add / edit address / backup / remove server,
// add / clone / remove backend) go through the diff preview + reload.

import { useMemo, useState } from "react";
import { useI18n } from "../../../shared/i18n";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { Field, FormDialog } from "./EditDialogs";
import {
  familyOf,
  isHealthy,
  skey,
  type CfgBackend,
  type CfgServer,
  type RuntimeServer,
  type ServerStatus,
} from "./gatewayApi";
import type { EditorCtx } from "./editorContext";
import { StatusDot } from "./StatusDot";

type Row = {
  backend: string;
  name: string;
  addr: string;
  isBackup: boolean;
  cfg: CfgServer | null;
  rt: RuntimeServer | null;
  status: ServerStatus;
};

type BackendView = { name: string; family: string; usedBy: number; rows: Row[]; cfg: CfgBackend | null; status: ServerStatus };

type Dialog =
  | { kind: "addServer"; backend: CfgBackend }
  | { kind: "editServer"; row: Row }
  | { kind: "weight"; row: Row }
  | { kind: "addBackend"; cloneFrom?: string }
  | null;

export function ServersTab({
  ctx,
  onState,
  onWeight,
}: {
  ctx: EditorCtx;
  onState: (row: { backend: string; name: string }, state: "ready" | "drain" | "maint") => void;
  onWeight: (row: { backend: string; name: string }, weight: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);

  const views = useMemo<BackendView[]>(() => {
    if (ctx.model) {
      return ctx.model.backends.map((b) => ({
        name: b.name,
        family: b.family,
        usedBy: b.usedBy.length,
        cfg: b,
        status: ctx.runtimeBackends.get(b.name)?.status ?? "unknown",
        rows: b.servers.map((s) => {
          const rt = ctx.runtimeServers.get(skey(b.name, s.name)) ?? null;
          return { backend: b.name, name: s.name, addr: s.addr, isBackup: s.isBackup, cfg: s, rt, status: rt?.status ?? "unknown" };
        }),
      }));
    }
    // Config unavailable: fall back to the runtime view (read-only structure).
    return [...ctx.runtimeBackends.values()].map((b) => ({
      name: b.name,
      family: familyOf(b.name),
      usedBy: 0,
      cfg: null,
      status: b.status,
      rows: b.servers.map((s) => ({ backend: b.name, name: s.name, addr: s.addr ?? "—", isBackup: s.isBackup, cfg: null, rt: s, status: s.status })),
    }));
  }, [ctx.model, ctx.runtimeBackends, ctx.runtimeServers]);

  const families = useMemo(() => {
    const m = new Map<string, BackendView[]>();
    for (const v of views) {
      if (!m.has(v.family)) m.set(v.family, []);
      m.get(v.family)!.push(v);
    }
    return [...m.entries()];
  }, [views]);

  return (
    <div className="gw-stack">
      {ctx.model && (
        <div className="gw-toolbar">
          <button type="button" className="btn btn--soft gw-btn-sm" onClick={() => setDialog({ kind: "addBackend" })}>
            {t("admin.gateways.backend.add")}
          </button>
        </div>
      )}

      {families.map(([family, list]) => (
        <div key={family} className="gw-family">
          <div className="gw-family__head">
            <span className="gw-mono">{family}</span>
            <span className="gw-muted">{list.length}</span>
          </div>
          <div className="gw-grid">
            {list.map((b) => (
              <BackendCard key={b.name} ctx={ctx} view={b} onState={onState}
                onDialog={setDialog} />
            ))}
          </div>
        </div>
      ))}

      {dialog?.kind === "addServer" && <AddServerDialog ctx={ctx} backend={dialog.backend} onClose={() => setDialog(null)} />}
      {dialog?.kind === "editServer" && <EditServerDialog ctx={ctx} row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === "weight" && (
        <WeightDialog row={dialog.row} onClose={() => setDialog(null)}
          onSubmit={async (w) => { setDialog(null); await onWeight(dialog.row, w); }} />
      )}
      {dialog?.kind === "addBackend" && <AddBackendDialog ctx={ctx} cloneFrom={dialog.cloneFrom} onClose={() => setDialog(null)} />}
    </div>
  );
}

function BackendCard({
  ctx, view, onState, onDialog,
}: {
  ctx: EditorCtx;
  view: BackendView;
  onState: (row: { backend: string; name: string }, state: "ready" | "drain" | "maint") => void;
  onDialog: (d: Dialog) => void;
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const up = view.rows.filter((r) => isHealthy(r.status)).length;
  const items: ActionMenuItem[] = [];
  if (view.cfg) {
    const cfg = view.cfg;
    items.push({ label: t("admin.gateways.server.add"), onClick: () => onDialog({ kind: "addServer", backend: cfg }) });
    items.push({ label: t("admin.gateways.backend.clone"), onClick: () => onDialog({ kind: "addBackend", cloneFrom: cfg.name }) });
    if (view.usedBy === 0) {
      items.push({ label: t("admin.gateways.backend.remove"), danger: true, onClick: () => { void ctx.editInline({ type: "backend.remove", name: cfg.name }); } });
    }
  }

  return (
    <section className="gw-card">
      <header className="gw-card__head">
        <div className="gw-card__title">
          <StatusDot status={view.status} />
          <span className="gw-mono">{view.name}</span>
          <span className={`gw-tag${up === 0 && view.rows.length > 0 ? " is-bad" : ""}`}>{up}/{view.rows.length}</span>
          {view.cfg && (
            <span className="gw-muted" title={view.cfg.usedBy.map((u) => `${u.frontend}${u.acl ? `:${u.acl}` : ""}`).join("\n")}>
              {view.usedBy > 0 ? t("admin.gateways.backend.usedBy", { count: view.usedBy }) : t("admin.gateways.backend.unused")}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <>
            <button type="button" className="gw-more" aria-label={t("admin.gateways.more")} onClick={(e) => setAnchor(e.currentTarget)}>⋯</button>
            <ActionMenu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} items={items} />
          </>
        )}
      </header>
      {view.rows.length === 0 ? (
        <p className="admin-section__hint gw-empty">{t("admin.gateways.backend.empty")}</p>
      ) : (
        <div className="gw-rows">
          {view.rows.map((r) => <ServerRow key={r.name} ctx={ctx} row={r} onState={onState} onDialog={onDialog} />)}
        </div>
      )}
    </section>
  );
}

function ServerRow({
  ctx, row, onState, onDialog,
}: {
  ctx: EditorCtx;
  row: Row;
  onState: (row: { backend: string; name: string }, state: "ready" | "drain" | "maint") => void;
  onDialog: (d: Dialog) => void;
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const busy = !!ctx.busy[skey(row.backend, row.name)];
  const out = row.status === "maint" || row.status === "drain";

  const items: ActionMenuItem[] = [];
  if (row.rt) {
    if (out) items.push({ label: t("admin.gateways.action.enable"), onClick: () => onState(row, "ready") });
    else {
      items.push({ label: t("admin.gateways.action.drain"), onClick: () => onState(row, "drain") });
      items.push({ label: t("admin.gateways.action.disable"), onClick: () => onState(row, "maint") });
    }
    items.push({ label: t("admin.gateways.action.weightEdit"), onClick: () => onDialog({ kind: "weight", row }) });
  }
  if (row.cfg) {
    items.push({ label: t("admin.gateways.server.edit"), onClick: () => onDialog({ kind: "editServer", row }) });
    items.push({ label: t("admin.gateways.server.remove"), danger: true, onClick: () => { void ctx.editInline({ type: "server.remove", backend: row.backend, server: row.name }); } });
  }

  return (
    <div className={`gw-row gw-row--server${busy ? " is-busy" : ""}`}>
      <StatusDot status={row.status} />
      <span className="gw-server__name">
        <span className="gw-mono">{row.name}</span>
        {row.isBackup && <span className="gw-tag">{t("admin.gateways.backup")}</span>}
        {row.status !== "up" && row.status !== "unknown" && (
          <span className={`gw-tag is-${row.status}`}>{t(`admin.gateways.status.${row.status}`)}</span>
        )}
      </span>
      <span className="gw-mono gw-muted gw-server__addr" title={row.addr}>
        {row.addr}
        {addrMismatch(row) && (
          <span className="gw-tag is-drain" title={t("admin.gateways.server.addrMismatch", { addr: row.rt?.addr ?? "" })}>
            {t("admin.gateways.server.addrMismatchShort", { addr: row.rt?.addr ?? "" })}
          </span>
        )}
      </span>
      <span className="gw-server__meta" title={t("admin.gateways.col.weight")}>
        <span className="gw-muted">{t("admin.gateways.weightShort")}</span> {row.rt?.weight ?? row.cfg?.weight ?? "—"}
        {row.rt?.sessionsCur != null && <><span className="gw-muted"> · </span>{row.rt.sessionsCur}<span className="gw-muted"> {t("admin.gateways.sessShort")}</span></>}
      </span>
      {items.length > 0 ? (
        <>
          <button type="button" className="gw-more" disabled={busy} aria-label={t("admin.gateways.more")} onClick={(e) => setAnchor(e.currentTarget)}>⋯</button>
          <ActionMenu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} items={items} />
        </>
      ) : <span />}
    </div>
  );
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const normAddr = (a: string) => a.replace(/^\[([^\]]+)\]/, "$1").toLowerCase();

/** Live address differs from the config (only checked for literal IPs, since a DNS name is shown resolved). */
function addrMismatch(row: Row): boolean {
  if (!row.cfg || !row.rt?.addr) return false;
  const literal = IPV4.test(row.cfg.host) || row.cfg.host.includes(":");
  return literal && normAddr(row.rt.addr) !== normAddr(row.cfg.addr);
}

function AddServerDialog({ ctx, backend, onClose }: { ctx: EditorCtx; backend: CfgBackend; onClose: () => void }) {
  const { t } = useI18n();
  const port = backend.servers[0]?.port;
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [backup, setBackup] = useState(false);
  return (
    <FormDialog
      title={t("admin.gateways.server.add")}
      kicker={backend.name}
      canSubmit={!!name.trim() && !!addr.trim()}
      onClose={onClose}
      onSubmit={async () => { await ctx.requestEdit({ type: "server.add", backend: backend.name, name: name.trim(), addr: addr.trim(), backup }); onClose(); }}
    >
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.name")} hint={t("admin.gateways.field.nameHint")}>
          <input className="input gw-mono" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t("admin.gateways.field.addr")} hint={t("admin.gateways.field.addrHint")}>
          <input className="input gw-mono" value={addr} placeholder={`203.0.113.10:${port ?? 443}`} onChange={(e) => setAddr(e.target.value)} />
        </Field>
      </div>
      <label className="gw-check">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        <span>{t("admin.gateways.field.backup")}</span>
      </label>
      {backend.servers[0] && (
        <p className="admin-section__hint">{t("admin.gateways.server.templateHint", { params: backend.servers[0].params || "—" })}</p>
      )}
    </FormDialog>
  );
}

function EditServerDialog({ ctx, row, onClose }: { ctx: EditorCtx; row: Row; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(row.name);
  const [addr, setAddr] = useState(row.addr);
  const [backup, setBackup] = useState(row.isBackup);
  const dirty = name.trim() !== row.name || addr.trim() !== row.addr || backup !== row.isBackup;
  return (
    <FormDialog
      title={t("admin.gateways.server.edit")}
      kicker={`${row.backend} / ${row.name}`}
      canSubmit={dirty && !!name.trim() && !!addr.trim()}
      onClose={onClose}
      onSubmit={async () => {
        await ctx.requestEdit({
          type: "server.update",
          backend: row.backend,
          server: row.name,
          ...(name.trim() !== row.name ? { name: name.trim() } : {}),
          ...(addr.trim() !== row.addr ? { addr: addr.trim() } : {}),
          ...(backup !== row.isBackup ? { backup } : {}),
        });
        onClose();
      }}
    >
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.name")}>
          <input className="input gw-mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("admin.gateways.field.addr")} hint={t("admin.gateways.field.addrHint")}>
          <input className="input gw-mono" value={addr} onChange={(e) => setAddr(e.target.value)} autoFocus />
        </Field>
      </div>
      <label className="gw-check">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        <span>{t("admin.gateways.field.backup")}</span>
      </label>
      {name.trim() !== row.name && <p className="admin-section__hint">{t("admin.gateways.server.renameHint")}</p>}
    </FormDialog>
  );
}

function WeightDialog({ row, onSubmit, onClose }: { row: Row; onSubmit: (w: number) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(String(row.rt?.weight ?? row.cfg?.weight ?? 1));
  const n = Number(weight);
  const valid = /^\d{1,3}$/.test(weight.trim()) && n >= 0 && n <= 256;
  return (
    <FormDialog
      title={t("admin.gateways.action.weightEdit")}
      kicker={`${row.backend} / ${row.name}`}
      submitLabel={t("admin.gateways.applyNow")}
      canSubmit={valid}
      onClose={onClose}
      onSubmit={() => onSubmit(n)}
    >
      <Field label={t("admin.gateways.col.weight")} hint={t("admin.gateways.field.weightHint")}>
        <input className="input" type="number" min={0} max={256} value={weight} onChange={(e) => setWeight(e.target.value)} autoFocus />
      </Field>
    </FormDialog>
  );
}

function AddBackendDialog({ ctx, cloneFrom, onClose }: { ctx: EditorCtx; cloneFrom?: string; onClose: () => void }) {
  const { t } = useI18n();
  const backends = ctx.model?.backends ?? [];
  const [source, setSource] = useState(cloneFrom ?? backends[0]?.name ?? "");
  const [name, setName] = useState(cloneFrom ? `${familyOf(cloneFrom)}_` : "");
  const [serverName, setServerName] = useState("");
  const srcPort = backends.find((b) => b.name === source)?.servers[0]?.port;
  const [addr, setAddr] = useState("");
  const withServer = !!serverName.trim() || !!addr.trim();
  return (
    <FormDialog
      title={cloneFrom ? t("admin.gateways.backend.clone") : t("admin.gateways.backend.add")}
      canSubmit={!!name.trim() && (!withServer || (!!serverName.trim() && !!addr.trim()))}
      onClose={onClose}
      onSubmit={async () => {
        await ctx.requestEdit({
          type: "backend.add",
          name: name.trim(),
          ...(source ? { cloneFrom: source } : {}),
          ...(withServer ? { server: { name: serverName.trim(), addr: addr.trim() } } : {}),
        });
        onClose();
      }}
    >
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.backendName")} hint={t("admin.gateways.field.backendNameHint")}>
          <input className="input gw-mono" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t("admin.gateways.field.cloneFrom")} hint={t("admin.gateways.field.cloneFromHint")}>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">—</option>
            {backends.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.firstServer")}>
          <input className="input gw-mono" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </Field>
        <Field label={t("admin.gateways.field.addr")} hint={srcPort ? t("admin.gateways.field.portHint", { port: srcPort }) : t("admin.gateways.field.addrHint")}>
          <input className="input gw-mono" value={addr} placeholder={`203.0.113.10:${srcPort ?? 443}`} onChange={(e) => setAddr(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}

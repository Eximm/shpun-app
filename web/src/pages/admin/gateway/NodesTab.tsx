// web/src/pages/admin/gateway/NodesTab.tsx
//
// "Nodes" = physical upstream servers, i.e. config server lines grouped by
// host. One row per host with every backend it serves; actions change the
// address everywhere at once, remove the node from every backend, or add a
// new node to several backends in one edit.

import { useMemo, useState } from "react";
import { useI18n } from "../../../shared/i18n";
import { ActionMenu } from "../ActionMenu";
import { Field, FormDialog } from "./EditDialogs";
import { isHealthy, skey, type CfgNode } from "./gatewayApi";
import type { EditorCtx } from "./editorContext";
import { StatusDot } from "./StatusDot";

type Dialog = { kind: "readdress"; node: CfgNode } | { kind: "add" } | null;

export function NodesTab({ ctx }: { ctx: EditorCtx }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const model = ctx.model;
  if (!model) return <p className="admin-section__hint">{t("admin.gateways.configUnavailable")}</p>;

  return (
    <div className="gw-stack">
      <div className="gw-toolbar">
        <span className="admin-section__hint gw-toolbar__hint">{t("admin.gateways.nodes.hint")}</span>
        <button type="button" className="btn btn--soft gw-btn-sm" onClick={() => setDialog({ kind: "add" })}>
          {t("admin.gateways.nodes.add")}
        </button>
      </div>
      <div className="gw-card">
        <div className="gw-rows">
          {model.nodes.map((n) => (
            <NodeRow key={n.host} ctx={ctx} node={n} onReaddress={() => setDialog({ kind: "readdress", node: n })} />
          ))}
        </div>
      </div>
      {dialog?.kind === "readdress" && <ReaddressDialog ctx={ctx} node={dialog.node} onClose={() => setDialog(null)} />}
      {dialog?.kind === "add" && <AddNodeDialog ctx={ctx} onClose={() => setDialog(null)} />}
    </div>
  );
}

function NodeRow({ ctx, node, onReaddress }: { ctx: EditorCtx; node: CfgNode; onReaddress: () => void }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const statuses = node.members.map((m) => ctx.runtimeServers.get(skey(m.backend, m.server))?.status ?? "unknown");
  const up = statuses.filter(isHealthy).length;
  const overall = up === statuses.length ? "up" : up === 0 ? (statuses.every((s) => s === "maint") ? "maint" : "down") : "drain";

  return (
    <div className="gw-row gw-row--node">
      <StatusDot status={statuses.every((s) => s === "unknown") ? "unknown" : overall} />
      <span className="gw-node__host gw-mono">{node.host}</span>
      <span className="gw-node__members">
        {node.members.map((m, i) => (
          <span key={`${m.backend}/${m.server}`} className={`gw-tag is-${statuses[i]}`} title={`${m.backend} / ${m.server}${m.port ? `:${m.port}` : ""}`}>
            {m.backend}{m.port ? <span className="gw-muted">:{m.port}</span> : null}{m.isBackup ? <span className="gw-muted"> · {t("admin.gateways.backup")}</span> : null}
          </span>
        ))}
      </span>
      <button type="button" className="gw-more" aria-label={t("admin.gateways.more")} onClick={(e) => setAnchor(e.currentTarget)}>⋯</button>
      <ActionMenu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        items={[
          { label: t("admin.gateways.nodes.readdress"), onClick: onReaddress },
          { label: t("admin.gateways.nodes.remove"), danger: true, onClick: () => { void ctx.editInline({ type: "node.remove", host: node.host }); } },
        ]}
      />
    </div>
  );
}

function ReaddressDialog({ ctx, node, onClose }: { ctx: EditorCtx; node: CfgNode; onClose: () => void }) {
  const { t } = useI18n();
  const [host, setHost] = useState(node.host);
  return (
    <FormDialog
      title={t("admin.gateways.nodes.readdress")}
      kicker={node.host}
      canSubmit={!!host.trim() && host.trim() !== node.host}
      onClose={onClose}
      onSubmit={async () => { await ctx.requestEdit({ type: "node.readdress", host: node.host, newHost: host.trim() }); onClose(); }}
    >
      <Field label={t("admin.gateways.field.host")} hint={t("admin.gateways.nodes.readdressHint", { count: node.members.length })}>
        <input className="input gw-mono" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
      </Field>
    </FormDialog>
  );
}

function AddNodeDialog({ ctx, onClose }: { ctx: EditorCtx; onClose: () => void }) {
  const { t } = useI18n();
  const backends = useMemo(() => ctx.model?.backends ?? [], [ctx.model]);
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, { on: boolean; port: string; backup: boolean }>>(() =>
    Object.fromEntries(backends.map((b) => [b.name, { on: false, port: String(b.servers[0]?.port ?? ""), backup: false }])),
  );
  const targets = backends.filter((b) => picked[b.name]?.on);

  const update = (b: string, patch: Partial<{ on: boolean; port: string; backup: boolean }>) =>
    setPicked((m) => ({ ...m, [b]: { ...m[b], ...patch } }));

  return (
    <FormDialog
      title={t("admin.gateways.nodes.add")}
      canSubmit={!!host.trim() && !!name.trim() && targets.length > 0}
      onClose={onClose}
      onSubmit={async () => {
        await ctx.requestEdit({
          type: "node.add",
          host: host.trim(),
          name: name.trim(),
          targets: targets.map((b) => ({
            backend: b.name,
            port: picked[b.name].port.trim() ? Number(picked[b.name].port) : null,
            backup: picked[b.name].backup,
          })),
        });
        onClose();
      }}
    >
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.host")}>
          <input className="input gw-mono" value={host} placeholder="203.0.113.10" onChange={(e) => setHost(e.target.value)} autoFocus />
        </Field>
        <Field label={t("admin.gateways.field.name")} hint={t("admin.gateways.nodes.nameHint")}>
          <input className="input gw-mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="gw-field__label">{t("admin.gateways.nodes.targets")}</div>
      <div className="gw-pick">
        {backends.map((b) => (
          <div key={b.name} className={`gw-pick__row${picked[b.name]?.on ? " is-on" : ""}`}>
            <label className="gw-check">
              <input type="checkbox" checked={!!picked[b.name]?.on} onChange={(e) => update(b.name, { on: e.target.checked })} />
              <span className="gw-mono">{b.name}</span>
            </label>
            <input
              className="input gw-mono gw-pick__port"
              inputMode="numeric"
              value={picked[b.name]?.port ?? ""}
              disabled={!picked[b.name]?.on}
              aria-label={t("admin.gateways.field.port")}
              onChange={(e) => update(b.name, { port: e.target.value.replace(/\D/g, "").slice(0, 5) })}
            />
            <label className="gw-check gw-pick__backup">
              <input type="checkbox" checked={!!picked[b.name]?.backup} disabled={!picked[b.name]?.on} onChange={(e) => update(b.name, { backup: e.target.checked })} />
              <span>{t("admin.gateways.backup")}</span>
            </label>
          </div>
        ))}
      </div>
    </FormDialog>
  );
}

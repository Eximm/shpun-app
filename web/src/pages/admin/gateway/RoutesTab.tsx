// web/src/pages/admin/gateway/RoutesTab.tsx
//
// SNI → backend routes, grouped by frontend. Each route is one compact row:
// domains → backend (same-family dropdown), with a menu for editing domains
// and removing the route. Default backend and "add route" live per frontend.

import { useState } from "react";
import { useI18n } from "../../../shared/i18n";
import { ActionMenu } from "../ActionMenu";
import { Field, FormDialog } from "./EditDialogs";
import { familyOf, type CfgFrontend, type CfgRule } from "./gatewayApi";
import type { EditorCtx } from "./editorContext";
import { StatusDot } from "./StatusDot";

type Dialog =
  | { kind: "domains"; frontend: string; rule: CfgRule }
  | { kind: "add"; frontend: CfgFrontend }
  | null;

export function RoutesTab({ ctx }: { ctx: EditorCtx }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const model = ctx.model;
  if (!model) return <p className="admin-section__hint">{t("admin.gateways.configUnavailable")}</p>;
  const backendNames = model.backends.map((b) => b.name);
  const frontends = model.frontends.filter((f) => f.rules.length > 0 || f.defaultBackend);

  if (frontends.length === 0) return <p className="admin-section__hint">{t("admin.gateways.routemap.empty")}</p>;

  return (
    <div className="gw-stack">
      {frontends.map((f) => (
        <section key={f.name} className="gw-card">
          <header className="gw-card__head">
            <div className="gw-card__title">
              <span className="gw-mono">{f.name}</span>
              {f.binds.length > 0 && <span className="gw-muted gw-mono">{f.binds.join(" ")}</span>}
            </div>
            <button type="button" className="btn btn--soft gw-btn-sm" onClick={() => setDialog({ kind: "add", frontend: f })}>
              {t("admin.gateways.route.add")}
            </button>
          </header>

          <div className="gw-rows">
            {f.rules.map((rule) => (
              <RouteRow key={`${rule.acl}:${rule.backend}`} ctx={ctx} frontend={f.name} rule={rule} backendNames={backendNames}
                onEditDomains={() => setDialog({ kind: "domains", frontend: f.name, rule })} />
            ))}
            <div className="gw-row gw-row--route gw-row--default">
              <span className="gw-route__domains">
                <span className="gw-muted">{t("admin.gateways.route.default")}</span>
              </span>
              <span className="gw-arrow" aria-hidden="true">→</span>
              <BackendSelect
                ctx={ctx}
                value={f.defaultBackend?.backend ?? ""}
                options={backendNames}
                busyKey={`default:${f.name}`}
                label={t("admin.gateways.route.default")}
                onChange={(backend) => ctx.editInline({ type: "frontend.default", frontend: f.name, backend })}
              />
              <span />
            </div>
          </div>
        </section>
      ))}

      {dialog?.kind === "domains" && (
        <DomainsDialog ctx={ctx} frontend={dialog.frontend} rule={dialog.rule} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "add" && (
        <AddRouteDialog ctx={ctx} frontend={dialog.frontend} backendNames={backendNames} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function RouteRow({
  ctx, frontend, rule, backendNames, onEditDomains,
}: {
  ctx: EditorCtx;
  frontend: string;
  rule: CfgRule;
  backendNames: string[];
  onEditDomains: () => void;
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const candidates = backendNames.filter((b) => familyOf(b) === rule.family);
  const extra = rule.domains.length - 1;
  const health = ctx.runtimeBackends.get(rule.backend)?.status ?? "unknown";

  return (
    <div className={`gw-row gw-row--route${rule.editable ? "" : " is-readonly"}`}>
      <span className="gw-route__domains" title={rule.domains.join("\n")}>
        {rule.domains.length > 0 ? (
          <>
            <span className="gw-route__domain">{rule.domains[0]}</span>
            {extra > 0 && <span className="gw-tag">+{extra}</span>}
            <span className="gw-muted gw-mono gw-route__acl">{rule.acl}</span>
          </>
        ) : (
          <span className="gw-mono gw-muted gw-route__domain" title={rule.acl}>{rule.acl}</span>
        )}
      </span>
      <span className="gw-arrow" aria-hidden="true">→</span>
      {rule.editable ? (
        <span className="gw-route__target">
          <StatusDot status={health} />
          <BackendSelect
            ctx={ctx}
            value={rule.backend}
            options={candidates}
            busyKey={`route:${frontend}:${rule.acl}`}
            label={rule.acl}
            onChange={(backend) => ctx.editInline({ type: "route.repoint", frontend, acl: rule.acl, backend })}
          />
        </span>
      ) : (
        <span className="gw-route__target gw-mono" title={t("admin.gateways.route.complex")}>
          <StatusDot status={health} /> {rule.backend}
        </span>
      )}
      {rule.editable ? (
        <>
          <button type="button" className="gw-more" aria-label={t("admin.gateways.more")} onClick={(e) => setAnchor(e.currentTarget)}>⋯</button>
          <ActionMenu
            anchorEl={anchor}
            open={!!anchor}
            onClose={() => setAnchor(null)}
            items={[
              { label: t("admin.gateways.route.editDomains"), onClick: onEditDomains },
              { label: t("admin.gateways.route.remove"), danger: true, onClick: () => { void ctx.editInline({ type: "route.remove", frontend, acl: rule.acl }); } },
            ]}
          />
        </>
      ) : (
        <span className="gw-tag" title={t("admin.gateways.route.complex")}>{t("admin.gateways.route.complexShort")}</span>
      )}
    </div>
  );
}

function BackendSelect({
  ctx, value, options, busyKey, label, onChange,
}: {
  ctx: EditorCtx;
  value: string;
  options: string[];
  busyKey: string;
  label: string;
  onChange: (backend: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      className="input gw-select"
      value={value}
      disabled={pending || !!ctx.busy[busyKey]}
      aria-label={label}
      onChange={(e) => {
        const next = e.target.value;
        if (next === value) return;
        setPending(true);
        void onChange(next).finally(() => setPending(false));
      }}
    >
      {!value && <option value="">—</option>}
      {opts.map((b) => <option key={b} value={b}>{b}</option>)}
    </select>
  );
}

function DomainsDialog({ ctx, frontend, rule, onClose }: { ctx: EditorCtx; frontend: string; rule: CfgRule; onClose: () => void }) {
  const { t } = useI18n();
  const [domains, setDomains] = useState(rule.domains.join("\n"));
  return (
    <FormDialog
      title={t("admin.gateways.route.editDomains")}
      kicker={`${frontend} · ${rule.acl}`}
      canSubmit={domains.trim().length > 0}
      onClose={onClose}
      onSubmit={async () => { await ctx.requestEdit({ type: "route.domains", frontend, acl: rule.acl, domains }); onClose(); }}
    >
      <Field label={t("admin.gateways.field.domains")} hint={t("admin.gateways.field.domainsHint")}>
        <textarea className="input gw-mono" rows={5} value={domains} onChange={(e) => setDomains(e.target.value)} autoFocus />
      </Field>
    </FormDialog>
  );
}

function AddRouteDialog({ ctx, frontend, backendNames, onClose }: { ctx: EditorCtx; frontend: CfgFrontend; backendNames: string[]; onClose: () => void }) {
  const { t } = useI18n();
  // Suggest the family the frontend already routes to, and a free ACL name.
  const family = frontend.rules[0]?.family ?? "";
  const sorted = [...backendNames].sort((a, b) => Number(familyOf(b) === family) - Number(familyOf(a) === family));
  const taken = new Set(frontend.acls.map((a) => a.name));
  let n = frontend.acls.length + 1;
  while (taken.has(`sni_${n}`)) n += 1;
  const [acl, setAcl] = useState(`sni_${n}`);
  const [domains, setDomains] = useState("");
  const [backend, setBackend] = useState(sorted[0] ?? "");

  return (
    <FormDialog
      title={t("admin.gateways.route.add")}
      kicker={frontend.name}
      canSubmit={!!acl.trim() && !!domains.trim() && !!backend}
      onClose={onClose}
      onSubmit={async () => { await ctx.requestEdit({ type: "route.add", frontend: frontend.name, acl: acl.trim(), domains, backend }); onClose(); }}
    >
      <Field label={t("admin.gateways.field.domains")} hint={t("admin.gateways.field.domainsHint")}>
        <textarea className="input gw-mono" rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} autoFocus />
      </Field>
      <div className="gw-form__grid">
        <Field label={t("admin.gateways.field.backend")}>
          <select className="input" value={backend} onChange={(e) => setBackend(e.target.value)}>
            {sorted.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label={t("admin.gateways.field.acl")} hint={t("admin.gateways.field.nameHint")}>
          <input className="input gw-mono" value={acl} onChange={(e) => setAcl(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}

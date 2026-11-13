// web/src/pages/admin/gateway/gatewayApi.ts
//
// Types + API calls for the gateway routing editor. Structural edits go
// through a two-step flow: dryRun (diff preview) → apply with the base hash
// the preview was computed against, so a concurrent change is detected (409)
// instead of being silently overwritten.

import { apiFetch, ApiError } from "../../../shared/api/client";

export type Gateway = { id: number; title: string; host: string; visibility: string };

export type ServerStatus = "up" | "down" | "maint" | "drain" | "nolb" | "no_check" | "unknown";

export type RuntimeServer = {
  backend: string;
  name: string;
  addr: string | null;
  status: ServerStatus;
  weight: number | null;
  checkStatus: string | null;
  sessionsCur: number | null;
  isBackup: boolean;
};
export type RuntimeBackend = { name: string; status: ServerStatus; servers: RuntimeServer[] };
export type RoutesResp = {
  ok: true;
  gateway: { id: number; title: string; host: string };
  topology: { backends: RuntimeBackend[] };
};

export type CfgServer = {
  backend: string;
  name: string;
  addr: string;
  host: string;
  port: number | null;
  params: string;
  isBackup: boolean;
  isDisabled: boolean;
  weight: number | null;
};
export type CfgBackend = {
  name: string;
  family: string;
  servers: CfgServer[];
  usedBy: { frontend: string; acl: string | null }[];
};
export type CfgRule = {
  frontend: string;
  acl: string;
  backend: string;
  family: string;
  domains: string[];
  editable: boolean;
};
export type CfgFrontend = {
  name: string;
  binds: string[];
  acls: { name: string; domains: string[]; sni: boolean }[];
  rules: CfgRule[];
  defaultBackend: { backend: string } | null;
};
export type CfgNode = {
  host: string;
  members: { backend: string; server: string; port: number | null; isBackup: boolean }[];
};
export type ConfigModel = { backends: CfgBackend[]; frontends: CfgFrontend[]; nodes: CfgNode[] };
export type ConfigResp = { ok: true; configHash: string; model: ConfigModel };

export type ChangeRow = {
  id: number;
  created_at: string;
  admin_user_id: number | null;
  backend: string;
  server: string;
  action: string;
  detail: Record<string, unknown> | null;
};

export type DiffLine = { kind: "ctx" | "add" | "del" | "gap"; text: string; oldNo?: number; newNo?: number };

export type EditOp =
  | { type: "route.repoint"; frontend: string; acl: string; backend: string }
  | { type: "route.domains"; frontend: string; acl: string; domains: string }
  | { type: "route.add"; frontend: string; acl: string; domains: string; backend: string }
  | { type: "route.remove"; frontend: string; acl: string }
  | { type: "frontend.default"; frontend: string; backend: string }
  | { type: "server.add"; backend: string; name: string; addr: string; backup?: boolean }
  | { type: "server.update"; backend: string; server: string; addr?: string; name?: string; backup?: boolean }
  | { type: "server.remove"; backend: string; server: string }
  | { type: "node.readdress"; host: string; newHost: string }
  | { type: "node.add"; host: string; name: string; targets: { backend: string; port?: number | null; backup?: boolean }[] }
  | { type: "node.remove"; host: string }
  | { type: "backend.add"; name: string; cloneFrom?: string; server?: { name: string; addr: string } }
  | { type: "backend.remove"; name: string };

export type EditPreview = {
  op: EditOp;
  summary: string;
  diff: DiffLine[];
  baseHash: string;
  unchanged?: boolean;
};

const base = (id: number) => `/admin/gateways/${id}`;

export function fetchGateways() {
  return apiFetch<{ ok: true; gateways: Gateway[] }>("/admin/gateways");
}
export function fetchRuntime(id: number) {
  return apiFetch<RoutesResp>(`${base(id)}/routes`);
}
export function fetchConfig(id: number) {
  return apiFetch<ConfigResp>(`${base(id)}/config`);
}
export function fetchChanges(id: number) {
  return apiFetch<{ ok: true; changes: ChangeRow[] }>(`${base(id)}/changes?limit=40`);
}

export function setServerState(id: number, backend: string, server: string, state: "ready" | "drain" | "maint", force = false) {
  return apiFetch(`${base(id)}/servers/state`, { method: "POST", body: { backend, server, state, force } });
}
export function setServerWeight(id: number, backend: string, server: string, weight: number, force = false) {
  return apiFetch(`${base(id)}/servers/weight`, { method: "POST", body: { backend, server, weight, force } });
}

export async function previewEdit(id: number, op: EditOp): Promise<EditPreview> {
  const r = await apiFetch<{ ok: true; summary?: string; diff: DiffLine[]; configHash: string; unchanged?: boolean }>(
    `${base(id)}/config/edit`,
    { method: "POST", body: { op, dryRun: true } },
  );
  return { op, summary: r.summary ?? "", diff: r.diff ?? [], baseHash: r.configHash, unchanged: r.unchanged };
}

export function applyEdit(id: number, preview: EditPreview) {
  return apiFetch<{ ok: true; summary: string; configHash: string }>(`${base(id)}/config/edit`, {
    method: "POST",
    body: { op: preview.op, baseHash: preview.baseHash },
  });
}

/** Known API error codes that have a dedicated message. */
const KNOWN_ERRORS = new Set([
  "gateway_unreachable", "config_changed", "apply_failed", "apply_rejected",
  "last_active_server", "backend_in_use", "backend_would_be_empty",
  "server_exists", "backend_exists", "acl_exists",
  "invalid_name", "invalid_addr", "invalid_domains", "invalid_weight", "invalid_params",
  "family_mismatch", "rule_not_found", "server_not_found", "backend_not_found", "node_not_found",
  "frontend_not_found", "template_not_found", "ambiguous_rule", "no_targets", "duplicate_target",
]);

/** Maps an API error to an i18n key + optional raw detail (e.g. haproxy -c output). */
export function describeError(e: unknown): { key: string; detail?: string } {
  if (e instanceof ApiError) {
    const code = e.code ?? "";
    const detail = code === "apply_rejected" && typeof e.data?.message === "string" ? e.data.message : undefined;
    if (KNOWN_ERRORS.has(code)) return { key: `admin.gateways.err.${code}`, detail };
  }
  return { key: "admin.gateways.actionError" };
}

/** UP, or no health check configured (HAProxy then assumes it is up). */
export const isHealthy = (s: ServerStatus) => s === "up" || s === "no_check";

export const familyOf = (b: string) => (b.indexOf("_") > 0 ? b.slice(0, b.indexOf("_")) : b);
export const skey = (backend: string, server: string) => `${backend}/${server}`;

// api/src/modules/serverStatus/remnawaveMetrics.ts
//
// Remnawave `/metrics` parser.
//
// Remnawave exposes a Prometheus exposition. Exact metric names can differ
// between versions, so the parser is intentionally tolerant and works off
// candidate names. We only extract:
//   - per-node online users (mapped by stable node UUID, never by name)
//   - global unique online users (when the metric is actually present)
//   - node/service up/status when present
//
// The raw exposition is never stored. `probeRemnawaveMetrics` powers the admin
// "test connection" screen and reports which of the expected metrics exist,
// without leaking the full payload.

export type RemnawaveNodeMetric = {
  nodeUuid: string;
  nodeName: string | null;
  onlineUsers: number | null;
  up: boolean | null;
};

export type RemnawaveMetricsSummary = {
  globalOnlineUsers: number | null;
  nodes: RemnawaveNodeMetric[];
  presentMetrics: string[];
};

const NODE_ONLINE_USER_NAMES = [
  "remnawave_node_online_users",
  "remnawave_node_users_online",
  "remnawave_nodes_online_users",
];

const GLOBAL_ONLINE_USER_NAMES = [
  "remnawave_online_users",
  "remnawave_users_online",
  "remnawave_online_users_total",
];

const NODE_UP_NAMES = [
  "remnawave_node_up",
  "remnawave_node_status",
  "remnawave_nodes_up",
];

type Line = { name: string; labels: Record<string, string>; value: number };

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return labels;
}

function parseAll(text: string): Line[] {
  const out: Line[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line || line[0] === "#") continue;
    const brace = line.indexOf("{");
    const space = line.indexOf(" ");
    let name: string;
    let labelRaw = "";
    let valueRaw: string;
    if (brace !== -1 && (space === -1 || brace < space)) {
      name = line.slice(0, brace);
      const close = line.indexOf("}", brace);
      if (close === -1) continue;
      labelRaw = line.slice(brace + 1, close);
      valueRaw = line.slice(close + 1).trim();
    } else if (space !== -1) {
      name = line.slice(0, space);
      valueRaw = line.slice(space + 1).trim();
    } else {
      continue;
    }
    const value = Number(valueRaw.split(/\s+/)[0]);
    if (!Number.isFinite(value)) continue;
    out.push({ name, labels: labelRaw ? parseLabels(labelRaw) : {}, value });
  }
  return out;
}

function pickUuid(labels: Record<string, string>): string | null {
  return (
    labels.node_uuid ||
    labels.uuid ||
    labels.node ||
    labels.node_id ||
    labels.nodeId ||
    null
  );
}

function pickName(labels: Record<string, string>): string | null {
  return labels.node_name || labels.name || labels.node || null;
}

export function parseRemnawaveMetrics(text: string): RemnawaveMetricsSummary {
  const lines = parseAll(text);
  const present = new Set<string>();
  const byUuid = new Map<string, RemnawaveNodeMetric>();
  let globalOnlineUsers: number | null = null;

  const onlineNames = new Set(NODE_ONLINE_USER_NAMES);
  const globalNames = new Set(GLOBAL_ONLINE_USER_NAMES);
  const upNames = new Set(NODE_UP_NAMES);

  for (const line of lines) {
    if (onlineNames.has(line.name)) {
      present.add(line.name);
      const uuid = pickUuid(line.labels);
      if (uuid) {
        const entry = byUuid.get(uuid) ?? { nodeUuid: uuid, nodeName: pickName(line.labels), onlineUsers: null, up: null };
        entry.onlineUsers = Math.max(0, Math.round(line.value));
        byUuid.set(uuid, entry);
      }
      continue;
    }

    if (globalNames.has(line.name)) {
      present.add(line.name);
      // Prefer an explicit aggregate if present.
      globalOnlineUsers = Math.max(0, Math.round(line.value));
      continue;
    }

    if (upNames.has(line.name)) {
      present.add(line.name);
      const uuid = pickUuid(line.labels);
      if (uuid) {
        const entry = byUuid.get(uuid) ?? { nodeUuid: uuid, nodeName: pickName(line.labels), onlineUsers: null, up: null };
        entry.up = line.value >= 1;
        if (!entry.nodeName) entry.nodeName = pickName(line.labels);
        byUuid.set(uuid, entry);
      }
    }
  }

  // Fallback: if no explicit global metric exists, sum per-node users. This is
  // a safe derived value and is clearly derived, not invented.
  if (globalOnlineUsers == null && byUuid.size > 0) {
    let sum = 0;
    let seen = false;
    for (const node of byUuid.values()) {
      if (node.onlineUsers != null) {
        sum += node.onlineUsers;
        seen = true;
      }
    }
    if (seen) globalOnlineUsers = sum;
  }

  return {
    globalOnlineUsers,
    nodes: [...byUuid.values()],
    presentMetrics: [...present].sort(),
  };
}

export type RemnawaveDiagnostics = {
  /** All `remnawave_*` metric families found in the payload (names only). */
  metricFamilies: string[];
  /** Label keys seen on `remnawave_*` metrics (names only, never values). */
  labelKeys: string[];
  /** Number of distinct node UUIDs discovered. */
  nodeUuidCount: number;
  nodeOnlineUsersPresent: boolean;
  globalOnlinePresent: boolean;
  nodeUpPresent: boolean;
};

/** Safe diagnostics for the admin "test connection" screen. No values/secret. */
export function inspectRemnawaveMetrics(text: string): RemnawaveDiagnostics {
  const lines = parseAll(text);
  const families = new Set<string>();
  const labelKeys = new Set<string>();
  const uuids = new Set<string>();

  for (const line of lines) {
    if (!line.name.startsWith("remnawave_")) continue;
    families.add(line.name);
    for (const key of Object.keys(line.labels)) labelKeys.add(key);
    const uuid = pickUuid(line.labels);
    if (uuid) uuids.add(uuid);
  }

  return {
    metricFamilies: [...families].sort(),
    labelKeys: [...labelKeys].sort(),
    nodeUuidCount: uuids.size,
    nodeOnlineUsersPresent: NODE_ONLINE_USER_NAMES.some((n) => families.has(n)),
    globalOnlinePresent: GLOBAL_ONLINE_USER_NAMES.some((n) => families.has(n)),
    nodeUpPresent: NODE_UP_NAMES.some((n) => families.has(n)),
  };
}

export type RemnawaveProbe = {
  reachable: boolean;
  authOk: boolean;
  metricsReceived: boolean;
  nodeMetricsFound: boolean;
  onlineUsersMetricPresent: boolean;
  nodeCount: number;
  presentMetrics: string[];
  errorCode: string | null;
  diagnostics?: RemnawaveDiagnostics;
};

/**
 * Probe a /metrics payload for the metrics the integration depends on.
 * Never returns the raw payload or credentials.
 */
export function probeRemnawaveMetrics(text: string): RemnawaveProbe {
  const summary = parseRemnawaveMetrics(text);
  const diagnostics = inspectRemnawaveMetrics(text);
  const onlineUsers = NODE_ONLINE_USER_NAMES.find((n) => summary.presentMetrics.includes(n)) ?? null;
  return {
    reachable: true,
    authOk: true,
    metricsReceived: text.length > 0,
    nodeMetricsFound: summary.nodes.length > 0,
    onlineUsersMetricPresent: onlineUsers != null,
    nodeCount: summary.nodes.length,
    presentMetrics: summary.presentMetrics,
    errorCode: null,
    diagnostics,
  };
}

export function emptyRemnawaveProbe(errorCode: string): RemnawaveProbe {
  return {
    reachable: false,
    authOk: false,
    metricsReceived: false,
    nodeMetricsFound: false,
    onlineUsersMetricPresent: false,
    nodeCount: 0,
    presentMetrics: [],
    errorCode,
  };
}
// api/src/shared/haproxy/statParser.ts
//
// Parses HAProxy Runtime API `show stat` CSV output into a structured,
// read-only topology model (backends + their servers with live status).
//
// Column access is BY NAME from the CSV header (first line starts with
// "# pxname,svname,..."), so the parser tolerates HAProxy version
// differences in column count/order. Only a small, stable subset is used.

export type GatewayServerStatus =
  | "up"
  | "down"
  | "maint"
  | "drain"
  | "nolb"
  | "no_check"
  | "unknown";

export type GatewayServer = {
  backend: string;
  name: string;
  addr: string | null;
  status: GatewayServerStatus;
  statusRaw: string;
  weight: number | null;
  checkStatus: string | null;
  sessionsCur: number | null;
  lastChangeSec: number | null;
  isBackup: boolean;
};

export type GatewayBackend = {
  name: string;
  status: GatewayServerStatus;
  statusRaw: string;
  servers: GatewayServer[];
};

export type GatewayTopology = {
  backends: GatewayBackend[];
};

function normalizeStatus(raw: string): GatewayServerStatus {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "unknown";
  // `show stat` server status can carry suffixes, e.g. "UP 2/3", "DOWN 1/2",
  // "MAINT (resolution)", "DRAIN (agent)". Match on the leading token.
  const head = s.split(/[\s(]/, 1)[0];
  switch (head) {
    case "UP":
      return "up";
    case "DOWN":
      return "down";
    case "MAINT":
      return "maint";
    case "DRAIN":
      return "drain";
    case "NOLB":
      return "nolb";
    case "NO":
      return "no_check"; // "no check"
    default:
      return "unknown";
  }
}

function toIntOrNull(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Parse `show stat` CSV. Rows with svname FRONTEND are ignored; a BACKEND row
 * provides the backend's aggregate status; all other rows are real servers.
 */
export function parseShowStat(csv: string): GatewayTopology {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { backends: [] };

  const headerLine = lines[0].startsWith("#") ? lines[0].replace(/^#\s*/, "") : lines[0];
  const headers = headerLine.split(",");
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(h.trim(), i));

  const col = (cells: string[], name: string): string | undefined => {
    const i = idx.get(name);
    if (i === undefined) return undefined;
    return cells[i];
  };

  const dataLines = lines[0].startsWith("#") ? lines.slice(1) : lines;

  const backendMap = new Map<string, GatewayBackend>();
  const ensureBackend = (name: string): GatewayBackend => {
    let b = backendMap.get(name);
    if (!b) {
      b = { name, status: "unknown", statusRaw: "", servers: [] };
      backendMap.set(name, b);
    }
    return b;
  };

  for (const line of dataLines) {
    const cells = line.split(",");
    const pxname = (col(cells, "pxname") ?? "").trim();
    const svname = (col(cells, "svname") ?? "").trim();
    if (!pxname || !svname) continue;
    if (svname === "FRONTEND") continue;

    if (svname === "BACKEND") {
      const b = ensureBackend(pxname);
      const raw = (col(cells, "status") ?? "").trim();
      b.status = normalizeStatus(raw);
      b.statusRaw = raw;
      continue;
    }

    const b = ensureBackend(pxname);
    const statusRaw = (col(cells, "status") ?? "").trim();
    const addr = (col(cells, "addr") ?? "").trim();
    const bck = toIntOrNull(col(cells, "bck"));
    b.servers.push({
      backend: pxname,
      name: svname,
      addr: addr || null,
      status: normalizeStatus(statusRaw),
      statusRaw,
      weight: toIntOrNull(col(cells, "weight")),
      checkStatus: (col(cells, "check_status") ?? "").trim() || null,
      sessionsCur: toIntOrNull(col(cells, "scur")),
      lastChangeSec: toIntOrNull(col(cells, "lastchg")),
      isBackup: bck === 1,
    });
  }

  return { backends: [...backendMap.values()] };
}

import { spawn } from "node:child_process";
import type { MonitoredServerRow } from "./repo.js";
import { probeNodeExporter } from "./monitor.js";

export type MonitoringAccessResult = {
  ok: boolean;
  error: string | null;
};

type AccessTransport = (serverId: number) => Promise<MonitoringAccessResult>;
let transportOverride: AccessTransport | null = null;

export function setMonitoringAccessTransport(transport: AccessTransport | null) {
  transportOverride = transport;
}

const errors = new Set([
  "access_not_configured", "server_not_found", "unsupported_endpoint",
  "node_not_registered", "host_key_unavailable", "ssh_failed", "access_timeout",
  "access_busy", "exporter_missing", "unsupported_config", "collector_conflict",
  "apply_failed", "probe_failed",
]);

function safeResult(value: unknown): MonitoringAccessResult {
  const result = value as Partial<MonitoringAccessResult> | null;
  if (result?.ok === true) return { ok: true, error: null };
  return { ok: false, error: errors.has(String(result?.error)) ? String(result?.error) : "apply_failed" };
}

function runBridge(serverId: number): Promise<MonitoringAccessResult> {
  const host = process.env.MONITORING_ACCESS_SSH_HOST?.trim();
  const key = process.env.MONITORING_ACCESS_SSH_KEY?.trim();
  const knownHosts = process.env.MONITORING_ACCESS_SSH_KNOWN_HOSTS?.trim();
  if (!host || !key || !knownHosts) {
    return Promise.resolve({ ok: false, error: "access_not_configured" });
  }
  return new Promise((resolve) => {
    const child = spawn("ssh", [
      "-T", "-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
      "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "ConnectTimeout=8",
      "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
      `root@${host}`, "request",
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let settled = false;
    const finish = (result: MonitoringAccessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, error: "access_timeout" });
    }, 45_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 16_384) {
        child.kill("SIGKILL");
        finish({ ok: false, error: "apply_failed" });
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => finish({ ok: false, error: "ssh_failed" }));
    child.on("close", (code) => {
      if (code !== 0) return finish({ ok: false, error: "ssh_failed" });
      try { finish(safeResult(JSON.parse(output))); }
      catch { finish({ ok: false, error: "apply_failed" }); }
    });
    child.stdin.end(JSON.stringify({ action: "prepare", serverId }));
  });
}

const preparing = new Map<number, Promise<MonitoringAccessResult>>();

/** A failed setup leaves the saved node available for editing and retry. */
export function prepareMonitoringAccess(row: MonitoredServerRow): Promise<MonitoringAccessResult> {
  const pending = preparing.get(row.id);
  if (pending) return pending;
  const run = (async (): Promise<MonitoringAccessResult> => {
    if (!row.active || !row.node_exporter_enabled) return { ok: true, error: null };
    try {
      const result = safeResult(await (transportOverride ?? runBridge)(row.id));
      if (!result.ok) return result;
      const probe = await probeNodeExporter(row);
      return { ok: probe.ok, error: probe.ok ? null : "probe_failed" };
    } catch {
      return { ok: false, error: "apply_failed" };
    }
  })();
  preparing.set(row.id, run);
  void run.finally(() => { if (preparing.get(row.id) === run) preparing.delete(row.id); });
  return run;
}

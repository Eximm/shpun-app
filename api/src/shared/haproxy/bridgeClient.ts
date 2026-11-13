// api/src/shared/haproxy/bridgeClient.ts
//
// Talks to the locked-down HAProxy bridge on a gateway over SSH, mirroring the
// Remnawave HWID bridge pattern (forced command, dedicated key, strict host
// key checking). Phase 1 is READ-ONLY: only `show-stat` / `show-servers-state`
// are ever requested, and the server-side forced command enforces that
// allowlist regardless of what we send.
//
// The gateway host is passed in (resolved from monitored_servers); the SSH
// user, key and known_hosts come from the environment and are shared across
// gateways.

import { spawn } from "node:child_process";

export type GatewayBridgeAction =
  | "show-stat"
  | "show-servers-state"
  | "set-state"
  | "set-weight"
  | "persist-state"
  | "get-config"
  | "apply-config";

export type GatewayBridgePayload = {
  action: GatewayBridgeAction;
  backend?: string;
  server?: string;
  state?: string;
  weight?: number;
  config?: string;
};

export type GatewayBridgeResponse = {
  ok?: boolean;
  error?: string;
  raw?: string;
};

export type GatewayBridgeTransport = (
  host: string,
  payload: GatewayBridgePayload,
) => Promise<GatewayBridgeResponse>;

let override: GatewayBridgeTransport | null = null;

/** Override the SSH transport (tests). Null restores the real SSH transport. */
export function setGatewayBridgeTransport(t: GatewayBridgeTransport | null): void {
  override = t;
}

function sshConfig() {
  const user = String(process.env.HAPROXY_BRIDGE_SSH_USER || "shpun-haproxy").trim();
  const keyPath = String(process.env.HAPROXY_BRIDGE_SSH_KEY || "").trim();
  const knownHostsPath = String(process.env.HAPROXY_BRIDGE_SSH_KNOWN_HOSTS || "").trim();
  if (!user || !keyPath || !knownHostsPath) {
    throw new Error("haproxy_bridge_ssh_not_configured");
  }
  return { user, keyPath, knownHostsPath };
}

function runSsh(host: string, payload: GatewayBridgePayload): Promise<GatewayBridgeResponse> {
  const cleanHost = String(host ?? "").trim();
  if (!cleanHost) return Promise.reject(new Error("haproxy_bridge_host_missing"));
  const { user, keyPath, knownHostsPath } = sshConfig();

  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-i", keyPath,
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", `UserKnownHostsFile=${knownHostsPath}`,
        "-o", "ConnectTimeout=10",
        `${user}@${cleanHost}`,
        "request",
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, result?: GatewayBridgeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result || {});
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("haproxy_bridge_ssh_timeout"));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        child.kill("SIGKILL");
        finish(new Error("haproxy_bridge_response_too_large"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(`haproxy_bridge_ssh_failed:${code}:${stderr.trim()}`));
        return;
      }
      try {
        finish(undefined, JSON.parse(stdout.trim()) as GatewayBridgeResponse);
      } catch {
        finish(new Error("haproxy_bridge_invalid_response"));
      }
    });

    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

async function call(host: string, payload: GatewayBridgePayload): Promise<string> {
  const transport = override ?? runSsh;
  const res = await transport(host, payload);
  if (!res || res.ok === false) {
    throw new Error(`haproxy_bridge_error:${res?.error ?? "unknown"}`);
  }
  return String(res.raw ?? "");
}

export function gatewayShowStat(host: string): Promise<string> {
  return call(host, { action: "show-stat" });
}

export function gatewayShowServersState(host: string): Promise<string> {
  return call(host, { action: "show-servers-state" });
}

/** Set a server's admin state (ready/drain/maint). Returns the raw reply. */
export function gatewaySetServerState(
  host: string,
  backend: string,
  server: string,
  state: string,
): Promise<string> {
  return call(host, { action: "set-state", backend, server, state });
}

/** Set a server's absolute weight (0..256). Returns the raw reply. */
export function gatewaySetServerWeight(
  host: string,
  backend: string,
  server: string,
  weight: number,
): Promise<string> {
  return call(host, { action: "set-weight", backend, server, weight });
}

/** Best-effort: dump runtime server state so it survives a reload. */
export function gatewayPersistState(host: string): Promise<string> {
  return call(host, { action: "persist-state" });
}

/** Read the live haproxy.cfg (via the privileged helper). */
export function gatewayGetConfig(host: string): Promise<string> {
  return call(host, { action: "get-config" });
}

/**
 * Validate + apply a new haproxy.cfg: the server-side helper backs up the
 * current config, runs `haproxy -c`, installs and gracefully reloads only on
 * success, and rolls back if the reload fails. Returns the helper's reply.
 */
export function gatewayApplyConfig(host: string, config: string): Promise<string> {
  return call(host, { action: "apply-config", config });
}

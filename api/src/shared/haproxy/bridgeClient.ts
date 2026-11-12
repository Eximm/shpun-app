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

export type GatewayBridgeAction = "show-stat" | "show-servers-state";

export type GatewayBridgeResponse = {
  ok?: boolean;
  error?: string;
  raw?: string;
};

export type GatewayBridgeTransport = (
  host: string,
  payload: { action: GatewayBridgeAction },
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

function runSsh(host: string, payload: { action: GatewayBridgeAction }): Promise<GatewayBridgeResponse> {
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

async function call(host: string, action: GatewayBridgeAction): Promise<string> {
  const transport = override ?? runSsh;
  const res = await transport(host, { action });
  if (!res || res.ok === false) {
    throw new Error(`haproxy_bridge_error:${res?.error ?? "unknown"}`);
  }
  return String(res.raw ?? "");
}

export function gatewayShowStat(host: string): Promise<string> {
  return call(host, "show-stat");
}

export function gatewayShowServersState(host: string): Promise<string> {
  return call(host, "show-servers-state");
}

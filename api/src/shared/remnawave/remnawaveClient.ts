import { spawn } from "node:child_process";

export type RemnawaveHwidDevice = {
  id: string;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  createdAt: string;
  updatedAt: string;
};

type BridgeResponse = {
  ok?: boolean;
  error?: string;
  removed?: boolean;
  limit?: number | null;
  devices?: RemnawaveHwidDevice[];
};

function sshConfig() {
  const host = String(process.env.REMNAWAVE_HWID_SSH_HOST || "").trim();
  const user = String(process.env.REMNAWAVE_HWID_SSH_USER || "shpun-hwid").trim();
  const keyPath = String(process.env.REMNAWAVE_HWID_SSH_KEY || "").trim();
  const knownHostsPath = String(process.env.REMNAWAVE_HWID_SSH_KNOWN_HOSTS || "").trim();

  if (!host || !user || !keyPath || !knownHostsPath) {
    throw new Error("remnawave_hwid_ssh_not_configured");
  }

  return { host, user, keyPath, knownHostsPath };
}

function runBridge(payload: Record<string, string>): Promise<BridgeResponse> {
  const { host, user, keyPath, knownHostsPath } = sshConfig();

  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [
      "-i", keyPath,
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHostsPath}`,
      "-o", "ConnectTimeout=10",
      `${user}@${host}`,
      "request",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, result?: BridgeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result || {});
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("remnawave_hwid_ssh_timeout"));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 256_000) {
        child.kill("SIGKILL");
        finish(new Error("remnawave_hwid_response_too_large"));
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
        finish(new Error(`remnawave_hwid_ssh_failed:${code}:${stderr.trim()}`));
        return;
      }

      try {
        finish(undefined, JSON.parse(stdout.trim()) as BridgeResponse);
      } catch {
        finish(new Error("remnawave_hwid_invalid_response"));
      }
    });

    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

export function remnawaveGetUserHwidDevices(username: string) {
  return runBridge({ action: "list", username });
}

export function remnawaveDeleteUserHwidDevice(username: string, hwid: string) {
  return runBridge({ action: "delete", username, hwid });
}

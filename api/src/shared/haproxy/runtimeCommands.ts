// api/src/shared/haproxy/runtimeCommands.ts
//
// Builds and validates HAProxy Runtime API mutation commands for phase 2
// (operational actions). Pure + strict: backend/server identifiers are
// validated against a safe charset so a crafted value can never inject a
// second socket command (the socket protocol is newline-delimited), and the
// weight is bounded. The gateway bridge re-validates with the same rules, so
// validation is enforced twice (app + bridge).

export type ServerState = "ready" | "drain" | "maint";

// HAProxy proxy/server names in this deployment use [A-Za-z0-9_.:-]. We forbid
// whitespace, '/', and anything else so no newline or separator can be smuggled
// into the runtime command line.
const NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export const SERVER_STATES: readonly ServerState[] = ["ready", "drain", "maint"];

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 256;

export function isValidHaproxyName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

export function isServerState(v: unknown): v is ServerState {
  return v === "ready" || v === "drain" || v === "maint";
}

function assertName(kind: "backend" | "server", name: unknown): string {
  if (!isValidHaproxyName(name)) {
    throw new Error(`invalid_${kind}_name`);
  }
  return name;
}

/** `set server <backend>/<server> state <ready|drain|maint>` */
export function buildSetStateCommand(backend: unknown, server: unknown, state: unknown): string {
  const b = assertName("backend", backend);
  const s = assertName("server", server);
  if (!isServerState(state)) throw new Error("invalid_state");
  return `set server ${b}/${s} state ${state}`;
}

/** `set server <backend>/<server> weight <N>` (absolute, 0..256) */
export function buildSetWeightCommand(backend: unknown, server: unknown, weight: unknown): string {
  const b = assertName("backend", backend);
  const s = assertName("server", server);
  const n = Number(weight);
  if (!Number.isInteger(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) {
    throw new Error("invalid_weight");
  }
  return `set server ${b}/${s} weight ${n}`;
}

/**
 * A runtime `set server ... state <X>` reply is empty on success; any
 * non-empty payload is an error message from HAProxy. Normalize that here so
 * callers can treat it uniformly.
 */
export function interpretRuntimeReply(raw: string): { ok: boolean; message: string } {
  const message = String(raw ?? "").trim();
  return { ok: message.length === 0, message };
}

// api/src/modules/serverStatus/crypto.ts
//
// Credential encryption for Monitoring 2.0.
//
// A single deployment-level root key (`SHPUN_CREDENTIALS_MASTER_KEY`) is used
// to encrypt every integration secret before it is written to SQLite. Secrets
// are NEVER stored in plaintext and NEVER returned by the API.
//
// Algorithm: AES-256-GCM (authenticated encryption).
// Stored payload format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
//
// The root key is accepted as:
//   - 64-char hex string (32 bytes), or
//   - base64 string decoding to exactly 32 bytes, or
//   - any other non-empty string (hashed with SHA-256 to 32 bytes).
//
// In production a missing key is a hard error; in development/tests we fall
// back to a deterministic dev key so the app still boots. Failure to decrypt
// (e.g. the master key changed) is handled as a safe "secret unavailable"
// state instead of crashing the whole process.

import crypto from "node:crypto";

const ENC_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CredentialsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsKeyError";
  }
}

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null;

function decodeKey(raw: string): Buffer | null {
  const hex = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // base64 that decodes to exactly 32 bytes
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32 && b.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) {
      return b;
    }
  } catch {
    /* not base64 */
  }
  return null;
}

export function isCredentialsKeyConfigured(): boolean {
  return Boolean(String(process.env.SHPUN_CREDENTIALS_MASTER_KEY || "").trim());
}

/** Returns the 32-byte master key or throws when unavailable in production. */
export function getMasterKey(): Buffer {
  const raw = String(process.env.SHPUN_CREDENTIALS_MASTER_KEY || "").trim();

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new CredentialsKeyError("credentials_master_key_missing");
    }
    const devSource = "shpun-dev-master-key";
    if (cachedKey && cachedKeySource === devSource) return cachedKey;
    cachedKey = crypto.createHash("sha256").update(devSource).digest();
    cachedKeySource = devSource;
    return cachedKey;
  }

  if (cachedKey && cachedKeySource === raw) return cachedKey;
  const decoded = decodeKey(raw);
  cachedKey = decoded ?? crypto.createHash("sha256").update(raw).digest();
  cachedKeySource = raw;
  return cachedKey;
}

/** Encrypt a secret (non-empty string) into a self-describing payload. */
export function encryptSecret(plain: string): string {
  const value = String(plain ?? "");
  if (!value) throw new Error("cannot_encrypt_empty_secret");

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENC_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored secret. Returns null when the payload is missing, empty,
 * malformed or cannot be authenticated (wrong master key). Callers must treat
 * null as "secret unavailable" and must never surface it to clients.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  const raw = String(payload ?? "").trim();
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Redact an authorization/credential header or token for structured logs. */
export function redact(value: unknown, keep = 2): string {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= keep) return "***";
  return `${"*".repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
}
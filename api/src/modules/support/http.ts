// api/src/modules/support/http.ts
// Small shared helpers for support HTTP routes (body parsing, error mapping).

import type { FastifyReply } from "fastify";
import { attachmentMaxFileBytes, attachmentMaxFiles } from "./attachmentStorage.js";
import type { UploadFile } from "./attachmentService.js";

export function readBody(req: any): Record<string, any> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === "object") return body as Record<string, any>;
  if (typeof body === "string") {
    const s = body.trim();
    if (!s) return {};
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** First defined value among the given keys (supports camelCase + snake_case). */
export function pick(body: Record<string, any>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key];
  }
  return undefined;
}

export function sendSupportError(reply: FastifyReply, error: unknown): FastifyReply {
  // Duck-typed so both SupportError and AttachmentError map cleanly without
  // importing the service layer here (avoids a circular dependency).
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  if (e && typeof e === "object" && typeof e.status === "number" && typeof e.code === "string") {
    const code = e.code;
    const message = typeof e.message === "string" && e.message !== code ? e.message : undefined;
    return reply.code(e.status).send({ ok: false, error: code, message });
  }
  throw error;
}

export function parsePositiveInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

/** Parse a multipart request into a text field + uploaded files. */
export async function readMultipart(req: any): Promise<{ text: string; files: UploadFile[]; fields: Record<string, string> }> {
  const textParts: string[] = [];
  const files: UploadFile[] = [];
  const fields: Record<string, string> = {};

  const parts = req.parts({
    limits: { fileSize: attachmentMaxFileBytes(), files: attachmentMaxFiles() },
  });

  for await (const part of parts) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      files.push({ filename: String(part.filename ?? "file"), mimetype: String(part.mimetype ?? ""), buffer });
    } else {
      const value = String(part.value ?? "");
      if (part.fieldname === "text" || part.fieldname === "message") textParts.push(value);
      else fields[part.fieldname] = value;
    }
  }

  return { text: textParts.join(""), files, fields };
}

export type RequestUser = {
  userId: number;
  login: string | null;
  displayName: string | null;
};

export function sessionUser(session: any): RequestUser | null {
  const raw = session?.shmUserId ?? session?.userId ?? 0;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  const login = String(session?.login ?? "").trim() || null;
  const displayName = String(session?.name ?? session?.displayName ?? "").trim() || login;
  return { userId: Math.trunc(id), login, displayName };
}

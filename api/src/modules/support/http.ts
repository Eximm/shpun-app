// api/src/modules/support/http.ts
// Small shared helpers for support HTTP routes (body parsing, error mapping).

import type { FastifyReply } from "fastify";
import { isSupportError } from "./service.js";
import type { SupportError } from "./service.js";

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
  if (isSupportError(error)) {
    const err = error as SupportError;
    return reply.code(err.status).send({
      ok: false,
      error: err.code,
      message: err.message && err.message !== err.code ? err.message : undefined,
    });
  }
  throw error;
}

export function parsePositiveInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
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

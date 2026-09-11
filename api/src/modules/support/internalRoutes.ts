// api/src/modules/support/internalRoutes.ts
//
// Internal API for the main Telegram bot.
//
// Read endpoints (GET):
//   GET  /api/internal/support/categories
//   GET  /api/internal/support/tickets
//   GET  /api/internal/support/tickets/:id
//
// Action endpoints — registered as BOTH POST and GET:
//   POST /api/internal/support/tickets
//   GET  /api/internal/support/tickets/create
//   POST /api/internal/support/tickets/:id/messages
//   GET  /api/internal/support/tickets/:id/reply
//
// Why GET actions: the SHM template DSL can reliably call `http.get(url, timeout=)`,
// while `http.post(url)` sends `Content-Type: application/json` with an EMPTY body,
// which Fastify rejects with FST_ERR_CTP_EMPTY_JSON_BODY before the handler runs.
// GET actions carry all parameters in the query string and are the project's
// existing pattern for server-to-server actions (see /internal/referrals/telegram-claim).
//
// Protection: a dedicated shared secret (SHM_SUPPORT_SECRET). Private IP / Host
// are NOT sufficient. The bot authenticates by SHM session_id; the user id is
// resolved on the backend and never trusted from the request.

import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getSupportShmPort } from "./snapshot.js";
import { isTicketStatus, type TicketStatus } from "./types.js";
import {
  addUserMessage,
  createTicket,
  getUserTicket,
  listCategories,
  listUserTickets,
} from "./service.js";
import { pick, readBody, sendSupportError } from "./http.js";

function supportSecret(): string {
  return String(process.env.SHM_SUPPORT_SECRET ?? "").trim();
}

function extractSecret(req: any, body: Record<string, any>): string {
  const header = req.headers?.["x-support-secret"] ?? req.headers?.["x-internal-secret"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const fromBody = body?.secret;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();

  const fromQuery = (req.query as any)?.secret;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();

  return "";
}

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Returns true when authorized, otherwise sends the error response. */
function ensureInternalAuthorized(
  req: any,
  reply: FastifyReply,
  body: Record<string, any>
): boolean {
  const expected = supportSecret();
  if (!expected) {
    reply.code(503).send({ ok: false, error: "support_secret_not_configured" });
    return false;
  }
  if (!secretsMatch(extractSecret(req, body), expected)) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function merged(req: any): Record<string, any> {
  return { ...((req.query ?? {}) as Record<string, any>), ...readBody(req) };
}

function parseStatusFilter(value: unknown): TicketStatus[] | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => isTicketStatus(x)) as TicketStatus[];
  return items.length > 0 ? items : undefined;
}

async function resolveUserId(sessionId: string): Promise<number | null> {
  if (!sessionId) return null;
  try {
    const identity = await getSupportShmPort().resolveIdentity(sessionId);
    return identity.userId;
  } catch {
    return null;
  }
}

/* ─── Shared action handlers (POST + GET) ────────────────────────────────── */

async function handleCreateTicket(req: any, reply: FastifyReply, successStatus: number) {
  try {
    const body = readBody(req);
    if (!ensureInternalAuthorized(req, reply, body)) return;

    const data = merged(req);
    const sessionId = String(pick(data, "session_id", "sessionId") ?? "").trim();
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: "session_id_required" });
    }

    const identity = await getSupportShmPort().resolveIdentity(sessionId);
    const telegramChatIdRaw = pick(data, "telegram_chat_id", "telegramChatId");
    const telegramChatId =
      telegramChatIdRaw === undefined || telegramChatIdRaw === null || telegramChatIdRaw === ""
        ? null
        : Math.trunc(Number(telegramChatIdRaw));

    const ticket = await createTicket({
      userId: identity.userId,
      source: "telegram",
      categoryKey: String(pick(data, "category_key", "categoryKey") ?? "").trim(),
      text: pick(data, "text", "message"),
      subject: (pick(data, "subject") as string | null | undefined) ?? null,
      userServiceId: (pick(data, "user_service_id", "userServiceId") as number | null) ?? null,
      telegramChatId: Number.isFinite(Number(telegramChatId)) ? telegramChatId : null,
      shmSessionId: sessionId,
      login: identity.login,
      displayName: identity.displayName,
      balance: identity.balance,
      bonus: identity.bonus,
    });

    return reply.code(successStatus).send({ ok: true, ticket });
  } catch (error) {
    return handleInternalError(reply, error);
  }
}

async function handleReply(req: any, reply: FastifyReply, successStatus: number) {
  try {
    const body = readBody(req);
    if (!ensureInternalAuthorized(req, reply, body)) return;

    const data = merged(req);
    const sessionId = String(pick(data, "session_id", "sessionId") ?? "").trim();
    const userId = await resolveUserId(sessionId);
    if (!userId) return reply.code(401).send({ ok: false, error: "session_not_resolved" });

    const ticket = addUserMessage(
      Number((req.params as any)?.id),
      userId,
      pick(data, "text", "message")
    );
    return reply.code(successStatus).send({ ok: true, ticket });
  } catch (error) {
    return handleInternalError(reply, error);
  }
}

function handleInternalError(reply: FastifyReply, error: unknown): FastifyReply {
  // A failed SHM identity resolution is a gateway error, not a client error.
  if (error instanceof Error && String(error.message).startsWith("support_shm_")) {
    return reply.code(502).send({ ok: false, error: "session_not_resolved" });
  }
  return sendSupportError(reply, error);
}

/* ─── Routes ─────────────────────────────────────────────────────────────── */

export async function supportInternalRoutes(app: FastifyInstance) {
  app.get("/internal/support/categories", async (req, reply) => {
    const body = readBody(req);
    if (!ensureInternalAuthorized(req, reply, body)) return;
    return reply.send({ ok: true, items: listCategories({ activeOnly: true }) });
  });

  // Create a ticket on behalf of the Telegram user identified by session_id.
  // POST kept for compatibility; GET action is what the SHM DSL uses.
  app.post("/internal/support/tickets", (req, reply) => handleCreateTicket(req, reply, 201));
  app.get("/internal/support/tickets/create", (req, reply) => handleCreateTicket(req, reply, 200));

  // List tickets of the user identified by session_id.
  app.get("/internal/support/tickets", async (req, reply) => {
    try {
      const body = readBody(req);
      if (!ensureInternalAuthorized(req, reply, body)) return;

      const data = merged(req);
      const sessionId = String(pick(data, "session_id", "sessionId") ?? "").trim();
      if (!sessionId) {
        return reply.code(400).send({ ok: false, error: "session_id_required" });
      }

      const userId = await resolveUserId(sessionId);
      if (!userId) return reply.code(401).send({ ok: false, error: "session_not_resolved" });

      const result = listUserTickets(userId, {
        status: parseStatusFilter(data.status),
        limit: data.limit,
        offset: data.offset,
      });
      return reply.send({ ok: true, items: result.items, total: result.total });
    } catch (error) {
      return handleInternalError(reply, error);
    }
  });

  // Read one own ticket (tenant-scoped).
  app.get("/internal/support/tickets/:id", async (req, reply) => {
    try {
      const body = readBody(req);
      if (!ensureInternalAuthorized(req, reply, body)) return;

      const data = merged(req);
      const sessionId = String(pick(data, "session_id", "sessionId") ?? "").trim();
      const userId = await resolveUserId(sessionId);
      if (!userId) return reply.code(401).send({ ok: false, error: "session_not_resolved" });

      const ticket = getUserTicket(Number((req.params as any)?.id), userId);
      if (!ticket) return reply.code(404).send({ ok: false, error: "ticket_not_found" });
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return handleInternalError(reply, error);
    }
  });

  // Reply to an own ticket.
  // POST kept for compatibility; GET action is what the SHM DSL uses.
  app.post("/internal/support/tickets/:id/messages", (req, reply) => handleReply(req, reply, 201));
  app.get("/internal/support/tickets/:id/reply", (req, reply) => handleReply(req, reply, 200));
}

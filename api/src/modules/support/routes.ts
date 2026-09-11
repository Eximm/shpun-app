// api/src/modules/support/routes.ts
//
// Authenticated user API for ShpunApp.
//   GET  /api/support/categories
//   GET  /api/support/tickets
//   POST /api/support/tickets
//   GET  /api/support/tickets/:id
//   POST /api/support/tickets/:id/messages
//
// Ownership is always derived from the session; the client never passes
// a user id as a source of truth.

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isTicketStatus, type TicketStatus } from "./types.js";
import {
  addUserMessage,
  createTicket,
  getUserTicket,
  listCategories,
  listUserTickets,
} from "./service.js";
import { pick, readBody, sendSupportError, sessionUser } from "./http.js";

function parseStatusFilter(value: unknown): TicketStatus[] | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => isTicketStatus(x)) as TicketStatus[];
  return items.length > 0 ? items : undefined;
}

export async function supportRoutes(app: FastifyInstance) {
  // Public (authenticated) category list for the UI.
  app.get("/support/categories", async (req, reply) => {
    const session = getSessionFromRequest(req) as any;
    if (!sessionUser(session)) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }
    return reply.send({ ok: true, items: listCategories({ activeOnly: true }) });
  });

  // List the current user's own tickets.
  app.get("/support/tickets", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const query = (req.query ?? {}) as any;
      const result = listUserTickets(user.userId, {
        status: parseStatusFilter(query.status),
        limit: query.limit,
        offset: query.offset,
      });
      return reply.send({ ok: true, items: result.items, total: result.total });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Create a ticket. Snapshot and service ownership are resolved server-side.
  app.post("/support/tickets", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const body = readBody(req);
      const ticket = await createTicket({
        userId: user.userId,
        source: "app",
        categoryKey: String(pick(body, "categoryKey", "category_key") ?? "").trim(),
        text: pick(body, "text", "message"),
        subject: (pick(body, "subject") as string | null | undefined) ?? null,
        userServiceId: (pick(body, "userServiceId", "user_service_id") as number | null) ?? null,
        shmSessionId: session?.shmSessionId ?? null,
        login: user.login,
        displayName: user.displayName,
      });

      return reply.code(201).send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Read one own ticket (tenant-scoped, prevents IDOR).
  app.get("/support/tickets/:id", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const ticket = getUserTicket(Number((req.params as any)?.id), user.userId);
      if (!ticket) return reply.code(404).send({ ok: false, error: "ticket_not_found" });
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Reply to an own ticket.
  app.post("/support/tickets/:id/messages", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const body = readBody(req);
      const ticket = addUserMessage(
        Number((req.params as any)?.id),
        user.userId,
        pick(body, "text", "message")
      );
      return reply.code(201).send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });
}

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
import { isTicketKind, isTicketStatus, type TicketStatus } from "./types.js";
import {
  addUserMessage,
  addUserMessageWithAttachments,
  closeUserTicket,
  createPartnership,
  createTicket,
  getUserTicket,
  listCategories,
  listUserTickets,
} from "./service.js";
import { pick, readBody, readMultipart, sendSupportError, sessionUser } from "./http.js";
import { listOwnerUnreadTicketIds, markSupportTicketRead } from "./notifyRepo.js";
import { isSupportAdmin } from "./adminGuard.js";
import { getAttachment } from "./attachmentRepo.js";
import { getAttachmentStorage } from "./attachmentStorage.js";
import { getTicketRepository } from "./repository.js";

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
      const kind = isTicketKind(query.kind) ? query.kind : undefined;
      const result = listUserTickets(user.userId, {
        kind,
        status: parseStatusFilter(query.status),
        limit: query.limit,
        offset: query.offset,
      });
      const unreadIds = new Set(listOwnerUnreadTicketIds(user.userId, kind));
      const items = result.items.map((t) => ({ ...t, unread: unreadIds.has(t.id) }));
      return reply.send({ ok: true, items, total: result.total });
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
      // Opening a ticket marks its staff replies as read for the owner.
      markSupportTicketRead(user.userId, ticket.id);
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Reply to an own ticket (JSON text-only or multipart text + files).
  app.post("/support/tickets/:id/messages", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const ticketId = Number((req.params as any)?.id);
      if ((req as any).isMultipart?.()) {
        const { text, files } = await readMultipart(req);
        const ticket = addUserMessageWithAttachments(ticketId, user.userId, text, files);
        return reply.code(201).send({ ok: true, ticket });
      }

      const body = readBody(req);
      const ticket = addUserMessage(ticketId, user.userId, pick(body, "text", "message"));
      return reply.code(201).send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Close an own ticket (user-scoped; only allowed statuses).
  app.post("/support/tickets/:id/close", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const ticket = closeUserTicket(Number((req.params as any)?.id), user.userId);
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Create a partnership / advertising proposal. Structured context is stored
  // server-side; no support-service validation applies here.
  app.post("/support/partnership", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const body = readBody(req);
      const ticket = await createPartnership({
        userId: user.userId,
        source: "app",
        proposalType: String(pick(body, "proposalType", "proposal_type") ?? "").trim(),
        platformUrl: String(pick(body, "platformUrl", "platform_url") ?? ""),
        audienceSize: (pick(body, "audienceSize", "audience_size") as string | null) ?? null,
        offer: pick(body, "offer", "text"),
        contact: (pick(body, "contact") as string | null) ?? null,
        comment: (pick(body, "comment") as string | null) ?? null,
        shmSessionId: session?.shmSessionId ?? null,
        login: user.login,
        displayName: user.displayName,
      });

      return reply.code(201).send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Authenticated attachment download. Ticket owner or admin only.
  app.get("/support/attachments/:id", async (req, reply) => {
    try {
      const session = getSessionFromRequest(req) as any;
      const user = sessionUser(session);
      if (!user) return reply.code(401).send({ ok: false, error: "unauthorized" });

      const attachment = getAttachment(Number((req.params as any)?.id));
      if (!attachment) return reply.code(404).send({ ok: false, error: "attachment_not_found" });

      const ticket = getTicketRepository().getTicket(attachment.ticketId);
      if (!ticket) return reply.code(404).send({ ok: false, error: "attachment_not_found" });

      const isOwner = ticket.userId === user.userId;
      const isAdmin = isOwner ? true : await isSupportAdmin(session?.shmSessionId);
      if (!isOwner && !isAdmin) return reply.code(403).send({ ok: false, error: "forbidden" });

      if (attachment.deletedAt) {
        return reply.code(410).send({
          ok: false,
          error: "attachment_expired",
          message: "Вложение удалено по истечении срока хранения.",
        });
      }

      const buffer = getAttachmentStorage().read(attachment.storageKey);
      if (!buffer) return reply.code(404).send({ ok: false, error: "attachment_file_missing" });

      const inline = attachment.mimeType.startsWith("image/") || attachment.mimeType === "application/pdf";
      const asciiName = attachment.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
      return reply
        .header("Content-Type", attachment.mimeType)
        .header("Content-Length", String(buffer.length))
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `${inline ? "inline" : "attachment"}; filename="${asciiName || "file"}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName || "file")}`
        )
        .send(buffer);
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });
}

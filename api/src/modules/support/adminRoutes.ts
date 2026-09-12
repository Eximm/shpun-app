// api/src/modules/support/adminRoutes.ts
//
// Admin API for the existing ShpunApp admin (UI added in a later stage).
//   GET   /api/admin/support/categories
//   GET   /api/admin/support/tickets
//   GET   /api/admin/support/tickets/:id
//   POST  /api/admin/support/tickets/:id/messages
//   PATCH /api/admin/support/tickets/:id
//
// Access is checked with the existing `ensureAdmin` (via adminGuard).

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isSupportAdmin } from "./adminGuard.js";
import {
  countSupportUnread,
  listSupportUnreadTicketIds,
  markSupportTicketRead,
  recordSupportNotifyRecipient,
} from "./notifyRepo.js";
import { isTicketKind, isTicketPriority, isTicketStatus, type TicketPriority, type TicketStatus } from "./types.js";
import {
  addStaffMessage,
  getAdminTicket,
  listAdminTickets,
  listCategories,
  updateTicketByAdmin,
} from "./service.js";
import { pick, readBody, readMultipart, sendSupportError, sessionUser } from "./http.js";
import type { UploadFile } from "./attachmentService.js";

function parseStatusFilter(value: unknown): TicketStatus[] | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => isTicketStatus(x)) as TicketStatus[];
  return items.length > 0 ? items : undefined;
}

function parsePriorityFilter(value: unknown): TicketPriority[] | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => isTicketPriority(x)) as TicketPriority[];
  return items.length > 0 ? items : undefined;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

/** Resolves the admin session or sends 401/403. */
async function requireAdmin(req: any, reply: any) {
  const session = getSessionFromRequest(req) as any;
  if (!session?.shmSessionId) {
    reply.code(401).send({ ok: false, error: "not_authenticated" });
    return null;
  }
  if (!(await isSupportAdmin(session.shmSessionId))) {
    reply.code(403).send({ ok: false, error: "not_admin" });
    return null;
  }
  // Existing ensureAdmin/billing check already confirmed admin access.
  // Record the user only as a delivery recipient (delivery-only registry,
  // never an authorization source).
  const admin = sessionUser(session);
  if (admin?.userId) recordSupportNotifyRecipient(admin.userId);
  return session;
}

export async function supportAdminRoutes(app: FastifyInstance) {
  app.get("/admin/support/unread", async (req, reply) => {
    const session = await requireAdmin(req, reply);
    if (!session) return;
    const admin = sessionUser(session);
    const kindRaw = (req.query as any)?.kind;
    const kind = isTicketKind(kindRaw) ? kindRaw : undefined;
    const count = admin?.userId ? countSupportUnread(admin.userId, kind) : 0;
    return reply.send({ ok: true, count });
  });

  app.get("/admin/support/categories", async (req, reply) => {
    const session = await requireAdmin(req, reply);
    if (!session) return;
    return reply.send({ ok: true, items: listCategories({ activeOnly: false }) });
  });

  app.get("/admin/support/tickets", async (req, reply) => {
    try {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const query = (req.query ?? {}) as any;
      const assignedRaw = pick(query, "assignedTo", "assigned_to");
      const assignedTo =
        assignedRaw === undefined
          ? undefined
          : String(assignedRaw) === "null" || assignedRaw === ""
            ? null
            : parseOptionalInt(assignedRaw);

      const result = listAdminTickets({
        kind: isTicketKind(query.kind) ? query.kind : undefined,
        status: parseStatusFilter(query.status),
        priority: parsePriorityFilter(query.priority),
        categoryKey: String(pick(query, "categoryKey", "category_key") ?? "").trim() || undefined,
        assignedTo,
        userId: parseOptionalInt(pick(query, "userId", "user_id")),
        query: String(pick(query, "q", "query") ?? "").trim() || undefined,
        limit: query.limit,
        offset: query.offset,
      });
      const admin = sessionUser(session);
      const kind = isTicketKind(query.kind) ? query.kind : undefined;
      const unreadIds = admin?.userId
        ? new Set(listSupportUnreadTicketIds(admin.userId, kind))
        : new Set<number>();
      const items = result.items.map((t) => ({ ...t, unread: unreadIds.has(t.id) }));
      return reply.send({ ok: true, items, total: result.total, unreadCount: unreadIds.size });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  app.get("/admin/support/tickets/:id", async (req, reply) => {
    try {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const id = Number((req.params as any)?.id);
      const ticket = getAdminTicket(id);
      if (!ticket) return reply.code(404).send({ ok: false, error: "ticket_not_found" });
      const admin = sessionUser(session);
      if (admin?.userId) markSupportTicketRead(admin.userId, id);
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  // Public staff reply or internal note.
  app.post("/admin/support/tickets/:id/messages", async (req, reply) => {
    try {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const admin = sessionUser(session);

      let text: unknown;
      let internal = false;
      let files: UploadFile[] = [];

      if ((req as any).isMultipart?.()) {
        const mp = await readMultipart(req);
        text = mp.text;
        const rawInternal = mp.fields.internal;
        internal = rawInternal === "1" || rawInternal === "true" || rawInternal === "on";
        files = mp.files;
      } else {
        const body = readBody(req);
        text = pick(body, "text", "message");
        const internalRaw = pick(body, "internal", "isInternalNote", "is_internal_note");
        internal = internalRaw === true || internalRaw === 1 || internalRaw === "1" || internalRaw === "true";
      }

      const ticket = addStaffMessage({
        ticketId: Number((req.params as any)?.id),
        operatorId: admin?.userId ?? null,
        operatorName: admin?.displayName ?? admin?.login ?? null,
        text,
        internal,
        files,
      });
      if (admin?.userId && !internal) markSupportTicketRead(admin.userId, ticket.id);
      return reply.code(201).send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });

  app.patch("/admin/support/tickets/:id", async (req, reply) => {
    try {
      const session = await requireAdmin(req, reply);
      if (!session) return;

      const body = readBody(req);
      const assignedRaw = pick(body, "assignedTo", "assigned_to");
      const ticket = updateTicketByAdmin(Number((req.params as any)?.id), {
        status: pick(body, "status"),
        priority: pick(body, "priority"),
        assignedTo: assignedRaw,
      });
      return reply.send({ ok: true, ticket });
    } catch (error) {
      return sendSupportError(reply, error);
    }
  });
}

// api/src/modules/support/service.ts
//
// Business logic for support tickets. No SQL, no SHM HTTP here:
// storage goes through TicketRepository, identity/snapshot goes through
// SupportShmPort. This keeps the domain portable to a future SHM/Billing
// ticket storage without touching callers.

import { getTicketRepository, type TicketRepository } from "./repository.js";
import { getSupportShmPort } from "./snapshot.js";
import {
  isTicketPriority,
  isTicketStatus,
  type ServiceSnapshot,
  type SupportCategory,
  type SupportIdentity,
  type SupportShmPort,
  type TicketListResult,
  type TicketPatch,
  type TicketSource,
  type TicketStatus,
  type TicketWithMessages,
} from "./types.js";

export class SupportError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.name = "SupportError";
    this.code = code;
    this.status = status;
  }
}

export type SupportServiceDeps = {
  repo?: TicketRepository;
  shm?: SupportShmPort;
};

function normalizeText(value: unknown, max = 4000): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function requireUserId(userId: unknown): number {
  const n = Number(userId);
  if (!Number.isFinite(n) || n <= 0) throw new SupportError("invalid_user", 400);
  return Math.trunc(n);
}

/* ─── Categories ─────────────────────────────────────────────────────────── */

export function listCategories(
  options: { activeOnly?: boolean } = {},
  deps: SupportServiceDeps = {}
): SupportCategory[] {
  const repo = deps.repo ?? getTicketRepository();
  return repo.listCategories({ activeOnly: options.activeOnly ?? true });
}

/* ─── Create ─────────────────────────────────────────────────────────────── */

export type CreateTicketServiceInput = {
  userId: number;
  source: TicketSource;
  categoryKey: string;
  text: unknown;
  subject?: string | null;
  userServiceId?: number | null;
  telegramChatId?: number | null;
  /** SHM session id used for a best-effort snapshot and mandatory ownership check. */
  shmSessionId?: string | null;
  /** Local identity fallback (ShpunApp session). */
  login?: string | null;
  displayName?: string | null;
  balance?: number | null;
  bonus?: number | null;
};

export async function createTicket(
  input: CreateTicketServiceInput,
  deps: SupportServiceDeps = {}
): Promise<TicketWithMessages> {
  const repo = deps.repo ?? getTicketRepository();
  const shm = deps.shm ?? getSupportShmPort();

  const userId = requireUserId(input.userId);

  const categoryKey = String(input.categoryKey ?? "").trim();
  const category = categoryKey ? repo.getCategory(categoryKey) : null;
  if (!category || !category.active) {
    throw new SupportError("invalid_category", 400, "Категория обращения недоступна.");
  }

  const text = normalizeText(input.text, 4000);
  if (text.length < 2) {
    throw new SupportError("invalid_text", 400, "Опишите проблему чуть подробнее.");
  }

  const subject = input.subject == null ? null : normalizeText(input.subject, 200) || null;

  let identity: SupportIdentity = {
    userId,
    login: input.login ?? null,
    displayName: input.displayName ?? null,
    balance: input.balance ?? null,
    bonus: input.bonus ?? null,
  };

  // Best-effort: fill missing identity fields from SHM. Never let a snapshot
  // failure block ticket creation when we already have a trusted user id.
  if (input.shmSessionId) {
    try {
      const fresh = await shm.resolveIdentity(input.shmSessionId);
      identity = {
        userId,
        login: identity.login ?? fresh.login,
        displayName: identity.displayName ?? fresh.displayName,
        balance: fresh.balance ?? identity.balance,
        bonus: fresh.bonus ?? identity.bonus,
      };
    } catch {
      // ignore: snapshot is optional metadata
    }
  }

  // A provided user_service_id must be owned by the requester. Without a
  // session we cannot verify that, so reject instead of trusting the client.
  let serviceSnapshot: ServiceSnapshot | null = null;
  if (input.userServiceId !== undefined && input.userServiceId !== null) {
    const usi = Math.trunc(Number(input.userServiceId));
    if (!Number.isFinite(usi) || usi <= 0) {
      throw new SupportError("invalid_service", 400);
    }
    if (!input.shmSessionId) {
      throw new SupportError("service_ownership_unavailable", 400);
    }

    let owned: ServiceSnapshot | null = null;
    try {
      owned = await shm.resolveOwnedService(input.shmSessionId, usi);
    } catch {
      throw new SupportError("service_lookup_failed", 502);
    }
    if (!owned) {
      throw new SupportError("service_not_owned", 404, "Услуга не найдена в вашем аккаунте.");
    }
    serviceSnapshot = owned;
  }

  const contextSnapshot = {
    captured_at: new Date().toISOString(),
    source: input.source,
    user: {
      user_id: identity.userId,
      login: identity.login,
      display_name: identity.displayName,
      balance: identity.balance,
      bonus: identity.bonus,
    },
  };

  const ticket = repo.createTicket({
    userId: identity.userId,
    source: input.source,
    categoryKey,
    subject,
    status: "open",
    priority: "normal",
    assignedTo: null,
    serviceId: serviceSnapshot?.service_id ?? null,
    userServiceId: serviceSnapshot?.user_service_id ?? null,
    serviceCategory: serviceSnapshot?.category ?? null,
    userLoginSnapshot: identity.login,
    displayNameSnapshot: identity.displayName,
    balanceSnapshot: identity.balance,
    serviceSnapshot,
    contextSnapshot,
    telegramChatId: input.telegramChatId ?? null,
  });

  repo.addMessage({
    ticketId: ticket.id,
    authorType: "user",
    authorUserId: identity.userId,
    authorName: identity.displayName,
    text,
    isInternalNote: false,
  });

  return mustGetUserTicket(ticket.id, identity.userId, deps);
}

/* ─── Read: user scope ───────────────────────────────────────────────────── */

export function listUserTickets(
  userId: number,
  options: { status?: TicketStatus[]; limit?: number; offset?: number } = {},
  deps: SupportServiceDeps = {}
): TicketListResult {
  const repo = deps.repo ?? getTicketRepository();
  return repo.listUserTickets({
    userId: requireUserId(userId),
    status: options.status,
    limit: options.limit,
    offset: options.offset,
  });
}

export function getUserTicket(
  ticketId: number,
  userId: number,
  deps: SupportServiceDeps = {}
): TicketWithMessages | null {
  const repo = deps.repo ?? getTicketRepository();
  const ticket = repo.getTicket(ticketId);
  if (!ticket || ticket.userId !== requireUserId(userId)) return null;

  const messages = repo.listMessages(ticket.id, { includeInternalNotes: false });
  return { ...ticket, messages };
}

function mustGetUserTicket(
  ticketId: number,
  userId: number,
  deps: SupportServiceDeps
): TicketWithMessages {
  const ticket = getUserTicket(ticketId, userId, deps);
  if (!ticket) throw new SupportError("ticket_not_found", 404);
  return ticket;
}

/* ─── Write: user scope ──────────────────────────────────────────────────── */

export function addUserMessage(
  ticketId: number,
  userId: number,
  text: unknown,
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();
  const uid = requireUserId(userId);

  const ticket = repo.getTicket(ticketId);
  if (!ticket || ticket.userId !== uid) {
    throw new SupportError("ticket_not_found", 404);
  }

  const normalized = normalizeText(text, 4000);
  if (normalized.length < 2) {
    throw new SupportError("invalid_text", 400, "Опишите проблему чуть подробнее.");
  }

  // Behaviour for terminal states (covered by tests):
  //  - closed  -> user cannot reply, must create a new ticket;
  //  - resolved -> user can reply, the ticket reopens into waiting_staff.
  if (ticket.status === "closed") {
    throw new SupportError("ticket_closed", 409, "Обращение закрыто. Создайте новое.");
  }

  repo.addMessage({
    ticketId: ticket.id,
    authorType: "user",
    authorUserId: uid,
    authorName: ticket.displayNameSnapshot,
    text: normalized,
    isInternalNote: false,
  });
  repo.updateTicket(ticket.id, { status: "waiting_staff" });

  return mustGetUserTicket(ticket.id, uid, deps);
}

/* ─── Read/write: admin scope ────────────────────────────────────────────── */

export function listAdminTickets(
  filter: Parameters<TicketRepository["listAdminTickets"]>[0] = {},
  deps: SupportServiceDeps = {}
): TicketListResult {
  const repo = deps.repo ?? getTicketRepository();
  return repo.listAdminTickets(filter);
}

export function getAdminTicket(
  ticketId: number,
  deps: SupportServiceDeps = {}
): TicketWithMessages | null {
  const repo = deps.repo ?? getTicketRepository();
  const ticket = repo.getTicket(ticketId);
  if (!ticket) return null;
  const messages = repo.listMessages(ticket.id, { includeInternalNotes: true });
  return { ...ticket, messages };
}

export function addStaffMessage(
  input: {
    ticketId: number;
    operatorId: number | null;
    operatorName?: string | null;
    text: unknown;
    internal?: boolean;
  },
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();

  const ticket = repo.getTicket(input.ticketId);
  if (!ticket) throw new SupportError("ticket_not_found", 404);

  const normalized = normalizeText(input.text, 4000);
  if (normalized.length < 2) {
    throw new SupportError("invalid_text", 400, "Сообщение получилось слишком коротким.");
  }

  const operatorId = input.operatorId == null ? null : requireUserId(input.operatorId);

  // Internal notes never reach the user API and never change the status.
  if (input.internal) {
    repo.addInternalNote({
      ticketId: ticket.id,
      authorType: "staff",
      authorUserId: operatorId,
      authorName: input.operatorName ?? null,
      text: normalized,
      isInternalNote: true,
    });
    return getAdminTicket(ticket.id, deps) as TicketWithMessages;
  }

  repo.addMessage({
    ticketId: ticket.id,
    authorType: "staff",
    authorUserId: operatorId,
    authorName: input.operatorName ?? null,
    text: normalized,
    isInternalNote: false,
  });
  repo.updateTicket(ticket.id, { status: "waiting_user" });

  return getAdminTicket(ticket.id, deps) as TicketWithMessages;
}

export function updateTicketByAdmin(
  ticketId: number,
  patch: { status?: unknown; priority?: unknown; assignedTo?: unknown },
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();

  const ticket = repo.getTicket(ticketId);
  if (!ticket) throw new SupportError("ticket_not_found", 404);

  const next: TicketPatch = {};

  if (patch.status !== undefined) {
    if (!isTicketStatus(patch.status)) throw new SupportError("invalid_status", 400);
    next.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (!isTicketPriority(patch.priority)) throw new SupportError("invalid_priority", 400);
    next.priority = patch.priority;
  }
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo === null || patch.assignedTo === "") {
      next.assignedTo = null;
    } else {
      const n = Number(patch.assignedTo);
      if (!Number.isFinite(n) || n <= 0) throw new SupportError("invalid_assignee", 400);
      next.assignedTo = Math.trunc(n);
    }
  }

  repo.updateTicket(ticket.id, next);
  return getAdminTicket(ticket.id, deps) as TicketWithMessages;
}

export function assignOperator(
  ticketId: number,
  operatorId: number | null,
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  return updateTicketByAdmin(ticketId, { assignedTo: operatorId }, deps);
}

/** Narrow helper used by routes to distinguish domain errors. */
export function isSupportError(error: unknown): error is SupportError {
  return error instanceof SupportError;
}

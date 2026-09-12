// api/src/modules/support/service.ts
//
// Business logic for support tickets. No SQL, no SHM HTTP here:
// storage goes through TicketRepository, identity/snapshot goes through
// SupportShmPort. This keeps the domain portable to a future SHM/Billing
// ticket storage without touching callers.

import { getTicketRepository, type TicketRepository } from "./repository.js";
import { getSupportShmPort } from "./snapshot.js";
import {
  enrichMessagesWithAttachments,
  saveMessageAttachments,
  type UploadFile,
} from "./attachmentService.js";
import {
  notifyTicketCreated,
  notifyTicketStaffReply,
  notifyTicketUserMessage,
} from "./notifications.js";
import {
  isPartnershipType,
  isTicketPriority,
  isTicketStatus,
  partnershipTypeLabel,
  type PartnershipContext,
  type ServiceSnapshot,
  type SupportCategory,
  type SupportIdentity,
  type SupportShmPort,
  type TicketKind,
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
  kind?: TicketKind;
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
    kind: input.kind ?? "support",
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

  const created = mustGetUserTicket(ticket.id, identity.userId, deps);
  void notifyTicketCreated(created);
  return created;
}

/* ─── Read: user scope ───────────────────────────────────────────────────── */

export function listUserTickets(
  userId: number,
  options: { kind?: TicketKind; status?: TicketStatus[]; limit?: number; offset?: number } = {},
  deps: SupportServiceDeps = {}
): TicketListResult {
  const repo = deps.repo ?? getTicketRepository();
  return repo.listUserTickets({
    userId: requireUserId(userId),
    kind: options.kind,
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

  const messages = enrichMessagesWithAttachments(repo.listMessages(ticket.id, { includeInternalNotes: false }));
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
  return addUserMessageWithAttachments(ticketId, userId, text, [], deps);
}

export function addUserMessageWithAttachments(
  ticketId: number,
  userId: number,
  text: unknown,
  files: UploadFile[],
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();
  const uid = requireUserId(userId);

  const ticket = repo.getTicket(ticketId);
  if (!ticket || ticket.userId !== uid) {
    throw new SupportError("ticket_not_found", 404);
  }

  const hasFiles = Array.isArray(files) && files.length > 0;
  const normalized = normalizeText(text, 4000);
  if (!hasFiles && normalized.length < 2) {
    throw new SupportError("invalid_text", 400, "Опишите проблему чуть подробнее.");
  }

  // Behaviour for terminal states (covered by tests):
  //  - closed  -> user cannot reply, must create a new ticket;
  //  - resolved -> user can reply, the ticket reopens into waiting_staff.
  if (ticket.status === "closed") {
    throw new SupportError("ticket_closed", 409, "Обращение закрыто. Создайте новое.");
  }

  const message = repo.addMessage({
    ticketId: ticket.id,
    authorType: "user",
    authorUserId: uid,
    authorName: ticket.displayNameSnapshot,
    text: normalized,
    isInternalNote: false,
  });

  let attachments: Awaited<ReturnType<typeof saveMessageAttachments>> = [];
  try {
    if (hasFiles) {
      attachments = saveMessageAttachments({ ticketId: ticket.id, messageId: message.id, files });
    }
  } catch (error) {
    repo.deleteMessage(message.id);
    throw error;
  }

  repo.updateTicket(ticket.id, { status: "waiting_staff" });

  const result = mustGetUserTicket(ticket.id, uid, deps);
  void notifyTicketUserMessage(result, { ...message, attachments });
  return result;
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
  const messages = enrichMessagesWithAttachments(repo.listMessages(ticket.id, { includeInternalNotes: true }));
  return { ...ticket, messages };
}

export function addStaffMessage(
  input: {
    ticketId: number;
    operatorId: number | null;
    operatorName?: string | null;
    text: unknown;
    internal?: boolean;
    files?: UploadFile[];
  },
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();

  const ticket = repo.getTicket(input.ticketId);
  if (!ticket) throw new SupportError("ticket_not_found", 404);

  const hasFiles = Array.isArray(input.files) && input.files.length > 0;
  const normalized = normalizeText(input.text, 4000);
  if (!hasFiles && normalized.length < 2) {
    throw new SupportError("invalid_text", 400, "Сообщение получилось слишком коротким.");
  }

  const operatorId = input.operatorId == null ? null : requireUserId(input.operatorId);

  // Internal notes never reach the user API and never change the status.
  if (input.internal) {
    const note = repo.addInternalNote({
      ticketId: ticket.id,
      authorType: "staff",
      authorUserId: operatorId,
      authorName: input.operatorName ?? null,
      text: normalized,
      isInternalNote: true,
    });
    try {
      if (hasFiles) {
        saveMessageAttachments({ ticketId: ticket.id, messageId: note.id, files: input.files as UploadFile[] });
      }
    } catch (error) {
      repo.deleteMessage(note.id);
      throw error;
    }
    return getAdminTicket(ticket.id, deps) as TicketWithMessages;
  }

  const message = repo.addMessage({
    ticketId: ticket.id,
    authorType: "staff",
    authorUserId: operatorId,
    authorName: input.operatorName ?? null,
    text: normalized,
    isInternalNote: false,
  });

  let attachments: Awaited<ReturnType<typeof saveMessageAttachments>> = [];
  try {
    if (hasFiles) {
      attachments = saveMessageAttachments({ ticketId: ticket.id, messageId: message.id, files: input.files as UploadFile[] });
    }
  } catch (error) {
    repo.deleteMessage(message.id);
    throw error;
  }

  repo.updateTicket(ticket.id, { status: "waiting_user" });

  const result = getAdminTicket(ticket.id, deps) as TicketWithMessages;
  void notifyTicketStaffReply(result, { ...message, attachments });
  return result;
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

/* ─── Close: user scope ──────────────────────────────────────────────────── */

/** Statuses in which the ticket owner is allowed to close the ticket. */
export const USER_CLOSEABLE_STATUSES: TicketStatus[] = [
  "open",
  "waiting_staff",
  "waiting_user",
  "resolved",
];

export function closeUserTicket(
  ticketId: number,
  userId: number,
  deps: SupportServiceDeps = {}
): TicketWithMessages {
  const repo = deps.repo ?? getTicketRepository();
  const uid = requireUserId(userId);

  const ticket = repo.getTicket(ticketId);
  if (!ticket || ticket.userId !== uid) {
    throw new SupportError("ticket_not_found", 404);
  }

  // Idempotent: an already closed ticket is returned as is.
  if (ticket.status === "closed") {
    return getUserTicket(ticket.id, uid, deps) as TicketWithMessages;
  }

  if (!USER_CLOSEABLE_STATUSES.includes(ticket.status)) {
    throw new SupportError("ticket_not_closable", 409, "Обращение нельзя закрыть в текущем статусе.");
  }

  repo.updateTicket(ticket.id, { status: "closed" });
  repo.addMessage({
    ticketId: ticket.id,
    authorType: "system",
    authorUserId: null,
    authorName: null,
    text: "Обращение закрыто пользователем.",
    isInternalNote: false,
  });

  return getUserTicket(ticket.id, uid, deps) as TicketWithMessages;
}

/* ─── Partnership proposals ──────────────────────────────────────────────── */

export type CreatePartnershipServiceInput = {
  userId: number;
  source: TicketSource;
  proposalType: string;
  platformUrl: string;
  audienceSize?: string | null;
  offer: unknown;
  contact?: string | null;
  comment?: string | null;
  telegramChatId?: number | null;
  shmSessionId?: string | null;
  login?: string | null;
  displayName?: string | null;
  balance?: number | null;
};

function buildPartnershipMessage(p: PartnershipContext): string {
  return [
    "🤝 Предложение о сотрудничестве",
    "",
    `Тип: ${partnershipTypeLabel(p.proposal_type)}`,
    `Площадка: ${p.platform_url}`,
    `Аудитория: ${p.audience_size || "—"}`,
    "",
    "Предложение:",
    p.offer,
    p.contact ? `\nКонтакт: ${p.contact}` : "",
    p.comment ? `Комментарий: ${p.comment}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function createPartnership(
  input: CreatePartnershipServiceInput,
  deps: SupportServiceDeps = {}
): Promise<TicketWithMessages> {
  const repo = deps.repo ?? getTicketRepository();
  const shm = deps.shm ?? getSupportShmPort();
  const userId = requireUserId(input.userId);

  if (!isPartnershipType(input.proposalType)) {
    throw new SupportError("invalid_proposal_type", 400);
  }

  const platformUrl = normalizeText(input.platformUrl, 300);
  if (platformUrl.length < 2) {
    throw new SupportError("invalid_platform", 400, "Укажите площадку (ссылку или username).");
  }

  const offer = normalizeText(input.offer, 2000);
  if (offer.length < 10) {
    throw new SupportError("invalid_offer", 400, "Опишите предложение подробнее.");
  }

  const audienceSize = input.audienceSize == null ? null : normalizeText(input.audienceSize, 100) || null;
  const contact = input.contact == null ? null : normalizeText(input.contact, 200) || null;
  const comment = input.comment == null ? null : normalizeText(input.comment, 500) || null;

  let identity: SupportIdentity = {
    userId,
    login: input.login ?? null,
    displayName: input.displayName ?? null,
    balance: input.balance ?? null,
    bonus: null,
  };

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
      // best-effort snapshot
    }
  }

  const partnership: PartnershipContext = {
    proposal_type: input.proposalType,
    platform_url: platformUrl,
    audience_size: audienceSize,
    offer,
    contact,
    comment,
  };

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
    partnership,
  };

  const ticket = repo.createTicket({
    userId: identity.userId,
    kind: "partnership",
    source: input.source,
    categoryKey: "partnership",
    subject: partnershipTypeLabel(input.proposalType),
    status: "open",
    priority: "normal",
    assignedTo: null,
    userLoginSnapshot: identity.login,
    displayNameSnapshot: identity.displayName,
    balanceSnapshot: identity.balance,
    contextSnapshot,
    telegramChatId: input.telegramChatId ?? null,
  });

  repo.addMessage({
    ticketId: ticket.id,
    authorType: "user",
    authorUserId: identity.userId,
    authorName: identity.displayName,
    text: buildPartnershipMessage(partnership),
    isInternalNote: false,
  });

  const created = mustGetUserTicket(ticket.id, identity.userId, deps);
  void notifyTicketCreated(created);
  return created;
}

/** Narrow helper used by routes to distinguish domain errors. */
export function isSupportError(error: unknown): error is SupportError {
  return error instanceof SupportError;
}

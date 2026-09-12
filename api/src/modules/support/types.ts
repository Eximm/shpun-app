// api/src/modules/support/types.ts
// Storage-agnostic domain types for the support/tickets module.
// Nothing here may leak SQLite details: a future SHM/Billing repository
// must be able to produce exactly the same shapes.

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_user",
  "waiting_staff",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_SOURCES = ["app", "telegram"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const STORAGE_PROVIDERS = ["local", "shm"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const AUTHOR_TYPES = ["user", "staff", "system"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/** Ticket kind: technical support vs. advertising/partnership proposal. */
export const TICKET_KINDS = ["support", "partnership"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export function isTicketKind(value: unknown): value is TicketKind {
  return typeof value === "string" && (TICKET_KINDS as readonly string[]).includes(value);
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === "string" && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketSource(value: unknown): value is TicketSource {
  return typeof value === "string" && (TICKET_SOURCES as readonly string[]).includes(value);
}

/** Snapshot of a single SHM user service at the moment the ticket was created. */
export type ServiceSnapshot = {
  user_service_id: number;
  service_id?: number | null;
  name?: string | null;
  category?: string | null;
  status?: string | null;
  expire?: string | null;
  period?: string | number | null;
  cost?: number | null;
};

/** Context snapshot: who and with what balance opened the ticket. */
export type UserContextSnapshot = {
  user_id: number;
  login?: string | null;
  display_name?: string | null;
  balance?: number | null;
  bonus?: number | null;
};

/** Identity resolved from an SHM session (used by the internal Telegram API). */
export type SupportIdentity = {
  userId: number;
  login: string | null;
  displayName: string | null;
  balance: number | null;
  bonus: number | null;
};

/**
 * SHM gateway contract. Implemented by snapshot.ts against the real billing API
 * and overridable in tests. Keeps SHM-specific code out of service/routes.
 */
export type SupportShmPort = {
  resolveIdentity(sessionId: string): Promise<SupportIdentity>;
  /** Returns null when the service does not belong to the session's user. */
  resolveOwnedService(sessionId: string, userServiceId: number): Promise<ServiceSnapshot | null>;
};

export type SupportCategory = {
  key: string;
  title: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Ticket = {
  id: number;
  /** Stable human-readable number, independent from the storage primary key. */
  publicNo: string;
  kind: TicketKind;

  // Integration metadata. Local storage -> "local" / null.
  // Future SHM/Billing storage -> "shm" / external ticket id.
  storageProvider: StorageProvider;
  externalId: string | null;
  migrationStatus: string | null;
  migratedAt: string | null;
  syncedAt: string | null;

  userId: number;
  source: TicketSource;
  categoryKey: string;
  subject: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTo: number | null;

  // Shpun-specific snapshot fields (kept separately from canonical columns).
  serviceId: number | null;
  userServiceId: number | null;
  serviceCategory: string | null;
  userLoginSnapshot: string | null;
  displayNameSnapshot: string | null;
  balanceSnapshot: number | null;
  serviceSnapshot: ServiceSnapshot | null;
  contextSnapshot: Record<string, unknown> | null;

  telegramChatId: number | null;

  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
};

export type TicketMessage = {
  id: number;
  ticketId: number;
  authorType: AuthorType;
  authorUserId: number | null;
  authorName: string | null;
  text: string;
  isInternalNote: boolean;
  createdAt: string;
  attachments?: SupportAttachment[];
};

export type SupportAttachment = {
  id: number;
  messageId: number;
  ticketId: number;
  storageProvider: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  telegramFileId: string | null;
  createdAt: string;
  deletedAt: string | null;
  deleteReason: string | null;
};

export type TicketWithMessages = Ticket & { messages: TicketMessage[] };

export type CreateTicketInput = {
  userId: number;
  kind?: TicketKind;
  source: TicketSource;
  categoryKey: string;
  subject?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: number | null;

  serviceId?: number | null;
  userServiceId?: number | null;
  serviceCategory?: string | null;
  userLoginSnapshot?: string | null;
  displayNameSnapshot?: string | null;
  balanceSnapshot?: number | null;
  serviceSnapshot?: ServiceSnapshot | null;
  contextSnapshot?: Record<string, unknown> | null;

  telegramChatId?: number | null;

  /** Optional override; normally generated by the repository. */
  publicNo?: string;
  storageProvider?: StorageProvider;
  externalId?: string | null;
  migrationStatus?: string | null;
};

export type AddMessageInput = {
  ticketId: number;
  authorType: AuthorType;
  authorUserId?: number | null;
  authorName?: string | null;
  text: string;
  isInternalNote?: boolean;
};

export type TicketPatch = {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: number | null;
  subject?: string | null;
};

export type TicketListResult = {
  items: Ticket[];
  total: number;
};

export type UserTicketFilter = {
  userId: number;
  kind?: TicketKind;
  status?: TicketStatus[];
  limit?: number;
  offset?: number;
};

export type AdminTicketFilter = {
  kind?: TicketKind;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  categoryKey?: string;
  assignedTo?: number | null;
  userId?: number;
  query?: string;
  limit?: number;
  offset?: number;
};

export type LoadMessagesOptions = {
  includeInternalNotes?: boolean;
  limit?: number;
  offset?: number;
};

/** Structured context for a partnership/advertising proposal. */
export type PartnershipContext = {
  proposal_type: string;
  platform_url: string;
  audience_size?: string | null;
  offer: string;
  contact?: string | null;
  comment?: string | null;
};

/** Allowed partnership proposal types (kept in one place for UI + backend). */
export const PARTNERSHIP_TYPES = [
  { key: "blogger", label: "Блогер / автор" },
  { key: "channel", label: "Telegram-канал / сообщество" },
  { key: "youtube", label: "YouTube / Twitch" },
  { key: "site", label: "Сайт / проект" },
  { key: "other", label: "Другое" },
] as const;
export type PartnershipTypeKey = (typeof PARTNERSHIP_TYPES)[number]["key"];

export function isPartnershipType(value: unknown): value is PartnershipTypeKey {
  return typeof value === "string" && PARTNERSHIP_TYPES.some((t) => t.key === value);
}

export function partnershipTypeLabel(value: unknown): string {
  const found = PARTNERSHIP_TYPES.find((t) => t.key === value);
  return found?.label ?? String(value ?? "Другое");
}

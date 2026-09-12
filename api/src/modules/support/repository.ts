// api/src/modules/support/repository.ts
//
// Storage abstraction for support tickets.
//
// The service layer and HTTP routes only ever talk to `TicketRepository`.
// The current implementation is SQLite (linkdb.sqlite). A future
// `ShmTicketRepository` / `BillingTicketRepository` can be plugged in via
// `setTicketRepository()` without touching routes, the Telegram bot or the UI.
//
// Integration metadata (`storageProvider` / `externalId`) lets a hybrid setup
// keep local records linked to billing-side tickets after a migration.

import type {
  AddMessageInput,
  AdminTicketFilter,
  CreateTicketInput,
  LoadMessagesOptions,
  SupportCategory,
  Ticket,
  TicketListResult,
  TicketMessage,
  TicketPatch,
  UserTicketFilter,
} from "./types.js";
import { sqliteTicketRepository } from "./sqliteRepository.js";

export interface TicketRepository {
  createTicket(input: CreateTicketInput): Ticket;
  getTicket(id: number): Ticket | null;
  getTicketByPublicNo(publicNo: string): Ticket | null;

  listUserTickets(filter: UserTicketFilter): TicketListResult;
  listAdminTickets(filter: AdminTicketFilter): TicketListResult;

  addMessage(input: AddMessageInput): TicketMessage;
  addInternalNote(input: AddMessageInput): TicketMessage;
  listMessages(ticketId: number, options?: LoadMessagesOptions): TicketMessage[];
  deleteMessage(id: number): boolean;

  updateTicket(id: number, patch: TicketPatch): Ticket | null;
  assignOperator(id: number, operatorId: number | null): Ticket | null;

  listCategories(options?: { activeOnly?: boolean }): SupportCategory[];
  getCategory(key: string): SupportCategory | null;
}

let activeRepository: TicketRepository = sqliteTicketRepository;

export function getTicketRepository(): TicketRepository {
  return activeRepository;
}

/**
 * Swap the active storage backend. Intended for tests and for the future
 * SHM/Billing repository rollout. Passing null restores the SQLite default.
 */
export function setTicketRepository(repository: TicketRepository | null): void {
  activeRepository = repository ?? sqliteTicketRepository;
}

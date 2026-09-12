// api/src/modules/support/sqliteRepository.ts
//
// SQLite (linkdb.sqlite) implementation of TicketRepository.
// Schema is created on import following the project convention
// (CREATE TABLE IF NOT EXISTS + best-effort ALTER TABLE migrations).

import { linkDb } from "../../shared/linkdb/db.js";
import type { TicketRepository } from "./repository.js";
import type {
  AddMessageInput,
  AdminTicketFilter,
  CreateTicketInput,
  LoadMessagesOptions,
  ServiceSnapshot,
  StorageProvider,
  SupportCategory,
  Ticket,
  TicketKind,
  TicketListResult,
  TicketMessage,
  TicketPatch,
  UserTicketFilter,
} from "./types.js";

/* ─── Schema ─────────────────────────────────────────────────────────────── */

linkDb.exec(`
CREATE TABLE IF NOT EXISTS support_tickets (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  public_no              TEXT NOT NULL UNIQUE,
  kind                   TEXT NOT NULL DEFAULT 'support',
  storage_provider       TEXT NOT NULL DEFAULT 'local',
  external_id            TEXT,
  migration_status       TEXT,
  migrated_at            TEXT,
  synced_at              TEXT,

  user_id                INTEGER NOT NULL,
  source                 TEXT NOT NULL DEFAULT 'app',
  category_key           TEXT NOT NULL,
  subject                TEXT,
  status                 TEXT NOT NULL DEFAULT 'open',
  priority               TEXT NOT NULL DEFAULT 'normal',
  assigned_to            INTEGER,

  service_id             INTEGER,
  user_service_id        INTEGER,
  service_category       TEXT,

  user_login_snapshot    TEXT,
  display_name_snapshot  TEXT,
  balance_snapshot       REAL,
  service_snapshot_json  TEXT,
  context_snapshot_json  TEXT,

  telegram_chat_id       INTEGER,

  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at        TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON support_tickets(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON support_tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned
  ON support_tickets(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category
  ON support_tickets(category_key);
CREATE INDEX IF NOT EXISTS idx_support_tickets_external
  ON support_tickets(storage_provider, external_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_kind
  ON support_tickets(kind, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id         INTEGER NOT NULL,
  author_type       TEXT NOT NULL,
  author_user_id    INTEGER,
  author_name       TEXT,
  text              TEXT NOT NULL,
  is_internal_note  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON support_ticket_messages(ticket_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS support_categories (
  key          TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_ticket_counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL DEFAULT 0
);
`);

// Best-effort schema upgrade for existing databases.
try {
  linkDb.exec(`ALTER TABLE support_tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'support'`);
} catch {
  // column already exists
}

try {
  linkDb.exec(`CREATE INDEX IF NOT EXISTS idx_support_tickets_kind ON support_tickets(kind, last_message_at DESC)`);
} catch {
  // ignore
}

/* ─── Seed categories (bootstrap only; editing happens via admin later) ──── */

const SEED_CATEGORIES: Array<{ key: string; title: string; description: string; sortOrder: number }> = [
  { key: "connection", title: "Не подключается", description: "VPN не подключается или обрывается", sortOrder: 10 },
  { key: "speed", title: "Скорость", description: "Низкая скорость, просадки, лаги", sortOrder: 20 },
  { key: "sites", title: "Сайты и сервисы", description: "Не открываются нужные сайты или приложения", sortOrder: 30 },
  { key: "app", title: "Приложение", description: "Проблемы с ShpunApp или клиентом", sortOrder: 40 },
  { key: "router", title: "Роутер", description: "Настройка и работа Shpun Router", sortOrder: 50 },
  { key: "billing", title: "Оплата и баланс", description: "Платежи, баланс, списания", sortOrder: 60 },
  { key: "other", title: "Другое", description: "Всё остальное", sortOrder: 100 },
];

try {
  const seedStmt = linkDb.prepare(
    `INSERT OR IGNORE INTO support_categories(key, title, description, sort_order, active)
     VALUES (@key, @title, @description, @sort_order, 1)`
  );
  const seedTx = linkDb.transaction(() => {
    for (const item of SEED_CATEGORIES) {
      seedStmt.run({
        key: item.key,
        title: item.title,
        description: item.description,
        sort_order: item.sortOrder,
      });
    }
  });
  seedTx();
} catch {
  // Seeding is best-effort; the module must still load.
}

/* ─── Row mapping ────────────────────────────────────────────────────────── */

type TicketRow = {
  id: number;
  public_no: string;
  kind: string;
  storage_provider: string;
  external_id: string | null;
  migration_status: string | null;
  migrated_at: string | null;
  synced_at: string | null;
  user_id: number;
  source: string;
  category_key: string;
  subject: string | null;
  status: string;
  priority: string;
  assigned_to: number | null;
  service_id: number | null;
  user_service_id: number | null;
  service_category: string | null;
  user_login_snapshot: string | null;
  display_name_snapshot: string | null;
  balance_snapshot: number | null;
  service_snapshot_json: string | null;
  context_snapshot_json: string | null;
  telegram_chat_id: number | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  closed_at: string | null;
};

type MessageRow = {
  id: number;
  ticket_id: number;
  author_type: string;
  author_user_id: number | null;
  author_name: string | null;
  text: string;
  is_internal_note: number;
  created_at: string;
};

type CategoryRow = {
  key: string;
  title: string;
  description: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapTicket(row: TicketRow): Ticket {
  return {
    id: Number(row.id),
    publicNo: String(row.public_no),
    kind: (row.kind as TicketKind) || "support",
    storageProvider: row.storage_provider as StorageProvider,
    externalId: row.external_id ?? null,
    migrationStatus: row.migration_status ?? null,
    migratedAt: row.migrated_at ?? null,
    syncedAt: row.synced_at ?? null,
    userId: Number(row.user_id),
    source: row.source as Ticket["source"],
    categoryKey: String(row.category_key),
    subject: row.subject ?? null,
    status: row.status as Ticket["status"],
    priority: row.priority as Ticket["priority"],
    assignedTo: toNullableNumber(row.assigned_to),
    serviceId: toNullableNumber(row.service_id),
    userServiceId: toNullableNumber(row.user_service_id),
    serviceCategory: row.service_category ?? null,
    userLoginSnapshot: row.user_login_snapshot ?? null,
    displayNameSnapshot: row.display_name_snapshot ?? null,
    balanceSnapshot: toNullableNumber(row.balance_snapshot),
    serviceSnapshot: parseJson<ServiceSnapshot>(row.service_snapshot_json),
    contextSnapshot: parseJson<Record<string, unknown>>(row.context_snapshot_json),
    telegramChatId: toNullableNumber(row.telegram_chat_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastMessageAt: String(row.last_message_at),
    closedAt: row.closed_at ?? null,
  };
}

function mapMessage(row: MessageRow): TicketMessage {
  return {
    id: Number(row.id),
    ticketId: Number(row.ticket_id),
    authorType: row.author_type as TicketMessage["authorType"],
    authorUserId: toNullableNumber(row.author_user_id),
    authorName: row.author_name ?? null,
    text: String(row.text),
    isInternalNote: Number(row.is_internal_note) === 1,
    createdAt: String(row.created_at),
  };
}

function mapCategory(row: CategoryRow): SupportCategory {
  return {
    key: String(row.key),
    title: String(row.title),
    description: row.description ?? null,
    sortOrder: Number(row.sort_order),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* ─── Prepared statements ────────────────────────────────────────────────── */

const SELECT_TICKET = `SELECT * FROM support_tickets`;

const insertTicketStmt = linkDb.prepare(`
  INSERT INTO support_tickets (
    public_no, kind, storage_provider, external_id, migration_status, migrated_at, synced_at,
    user_id, source, category_key, subject, status, priority, assigned_to,
    service_id, user_service_id, service_category,
    user_login_snapshot, display_name_snapshot, balance_snapshot,
    service_snapshot_json, context_snapshot_json, telegram_chat_id
  ) VALUES (
    @public_no, @kind, @storage_provider, @external_id, @migration_status, @migrated_at, @synced_at,
    @user_id, @source, @category_key, @subject, @status, @priority, @assigned_to,
    @service_id, @user_service_id, @service_category,
    @user_login_snapshot, @display_name_snapshot, @balance_snapshot,
    @service_snapshot_json, @context_snapshot_json, @telegram_chat_id
  )
`);

const insertMessageStmt = linkDb.prepare(`
  INSERT INTO support_ticket_messages (
    ticket_id, author_type, author_user_id, author_name, text, is_internal_note
  ) VALUES (
    @ticket_id, @author_type, @author_user_id, @author_name, @text, @is_internal_note
  )
`);

function safeLimit(value: unknown, fallback = 20, max = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

function safeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

export class SqliteTicketRepository implements TicketRepository {
  private nextPublicNo(kind: TicketKind): string {
    const counterName = kind === "partnership" ? "partnership" : "ticket";
    linkDb
      .prepare(`INSERT OR IGNORE INTO support_ticket_counters(name, value) VALUES(?, 1000)`)
      .run(counterName);
    linkDb
      .prepare(`UPDATE support_ticket_counters SET value = value + 1 WHERE name = ?`)
      .run(counterName);
    const row = linkDb
      .prepare(`SELECT value FROM support_ticket_counters WHERE name = ?`)
      .get(counterName) as { value?: number } | undefined;
    const n = Number(row?.value ?? 1000);
    return kind === "partnership" ? `P${n}` : String(n);
  }

  createTicket(input: CreateTicketInput): Ticket {
    const tx = linkDb.transaction((payload: CreateTicketInput) => {
      const kind: TicketKind = payload.kind ?? "support";
      const publicNo = String(payload.publicNo ?? "").trim() || this.nextPublicNo(kind);
      const info = insertTicketStmt.run({
        public_no: publicNo,
        kind,
        storage_provider: payload.storageProvider ?? "local",
        external_id: payload.externalId ?? null,
        migration_status: payload.migrationStatus ?? null,
        migrated_at: null,
        synced_at: null,
        user_id: payload.userId,
        source: payload.source,
        category_key: payload.categoryKey,
        subject: payload.subject ?? null,
        status: payload.status ?? "open",
        priority: payload.priority ?? "normal",
        assigned_to: payload.assignedTo ?? null,
        service_id: payload.serviceId ?? null,
        user_service_id: payload.userServiceId ?? null,
        service_category: payload.serviceCategory ?? null,
        user_login_snapshot: payload.userLoginSnapshot ?? null,
        display_name_snapshot: payload.displayNameSnapshot ?? null,
        balance_snapshot: payload.balanceSnapshot ?? null,
        service_snapshot_json: payload.serviceSnapshot ? JSON.stringify(payload.serviceSnapshot) : null,
        context_snapshot_json: payload.contextSnapshot ? JSON.stringify(payload.contextSnapshot) : null,
        telegram_chat_id: payload.telegramChatId ?? null,
      });
      const lastId = Number(info.lastInsertRowid);
      const row = linkDb.prepare(`${SELECT_TICKET} WHERE id = ?`).get(lastId) as TicketRow;
      return mapTicket(row);
    });
    return tx(input);
  }

  getTicket(id: number): Ticket | null {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) return null;
    const row = linkDb.prepare(`${SELECT_TICKET} WHERE id = ?`).get(Math.trunc(n)) as
      | TicketRow
      | undefined;
    return row ? mapTicket(row) : null;
  }

  getTicketByPublicNo(publicNo: string): Ticket | null {
    const value = String(publicNo ?? "").trim();
    if (!value) return null;
    const row = linkDb.prepare(`${SELECT_TICKET} WHERE public_no = ?`).get(value) as
      | TicketRow
      | undefined;
    return row ? mapTicket(row) : null;
  }

  listUserTickets(filter: UserTicketFilter): TicketListResult {
    const where: string[] = ["user_id = ?"];
    const params: unknown[] = [filter.userId];
    if (filter.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.status && filter.status.length > 0) {
      where.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
      params.push(...filter.status);
    }
    const whereSql = where.join(" AND ");

    const totalRow = linkDb
      .prepare(`SELECT COUNT(*) AS cnt FROM support_tickets WHERE ${whereSql}`)
      .get(...params) as { cnt?: number } | undefined;

    const limit = safeLimit(filter.limit, 20, 100);
    const offset = safeOffset(filter.offset);
    const rows = linkDb
      .prepare(
        `${SELECT_TICKET} WHERE ${whereSql}
         ORDER BY datetime(last_message_at) DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as TicketRow[];

    return { items: rows.map(mapTicket), total: Number(totalRow?.cnt ?? 0) };
  }

  listAdminTickets(filter: AdminTicketFilter): TicketListResult {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.status && filter.status.length > 0) {
      where.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
      params.push(...filter.status);
    }
    if (filter.priority && filter.priority.length > 0) {
      where.push(`priority IN (${filter.priority.map(() => "?").join(", ")})`);
      params.push(...filter.priority);
    }
    if (filter.categoryKey) {
      where.push("category_key = ?");
      params.push(filter.categoryKey);
    }
    if (filter.assignedTo !== undefined) {
      if (filter.assignedTo === null) {
        where.push("assigned_to IS NULL");
      } else {
        where.push("assigned_to = ?");
        params.push(filter.assignedTo);
      }
    }
    if (filter.userId !== undefined && Number.isFinite(Number(filter.userId))) {
      where.push("user_id = ?");
      params.push(Math.trunc(Number(filter.userId)));
    }
    if (filter.query) {
      const like = `%${String(filter.query).trim()}%`;
      where.push(
        `(public_no LIKE ? OR subject LIKE ? OR user_login_snapshot LIKE ? OR display_name_snapshot LIKE ?)`
      );
      params.push(like, like, like, like);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = linkDb
      .prepare(`SELECT COUNT(*) AS cnt FROM support_tickets ${whereSql}`)
      .get(...params) as { cnt?: number } | undefined;

    const limit = safeLimit(filter.limit, 30, 100);
    const offset = safeOffset(filter.offset);
    const rows = linkDb
      .prepare(
        `${SELECT_TICKET} ${whereSql}
         ORDER BY datetime(last_message_at) DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as TicketRow[];

    return { items: rows.map(mapTicket), total: Number(totalRow?.cnt ?? 0) };
  }

  addMessage(input: AddMessageInput): TicketMessage {
    const tx = linkDb.transaction((payload: AddMessageInput) => {
      const info = insertMessageStmt.run({
        ticket_id: payload.ticketId,
        author_type: payload.authorType,
        author_user_id: payload.authorUserId ?? null,
        author_name: payload.authorName ?? null,
        text: payload.text,
        is_internal_note: payload.isInternalNote ? 1 : 0,
      });
      const lastId = Number(info.lastInsertRowid);
      linkDb
        .prepare(
          `UPDATE support_tickets
           SET last_message_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(payload.ticketId);
      const row = linkDb
        .prepare(`SELECT * FROM support_ticket_messages WHERE id = ?`)
        .get(lastId) as MessageRow;
      return mapMessage(row);
    });
    return tx(input);
  }

  addInternalNote(input: AddMessageInput): TicketMessage {
    return this.addMessage({ ...input, authorType: "staff", isInternalNote: true });
  }

  deleteMessage(id: number): boolean {
    const n = Math.trunc(Number(id));
    if (!Number.isFinite(n) || n <= 0) return false;
    const info = linkDb.prepare(`DELETE FROM support_ticket_messages WHERE id = ?`).run(n);
    return Number(info.changes) > 0;
  }

  listMessages(ticketId: number, options?: LoadMessagesOptions): TicketMessage[] {
    const where: string[] = ["ticket_id = ?"];
    const params: unknown[] = [ticketId];
    if (!options?.includeInternalNotes) {
      where.push("is_internal_note = 0");
    }
    let sql = `SELECT * FROM support_ticket_messages WHERE ${where.join(" AND ")}
               ORDER BY datetime(created_at) ASC, id ASC`;
    if (options?.limit !== undefined) {
      sql += " LIMIT ? OFFSET ?";
      params.push(safeLimit(options.limit, 100, 500), safeOffset(options.offset));
    }
    const rows = linkDb.prepare(sql).all(...params) as MessageRow[];
    return rows.map(mapMessage);
  }

  updateTicket(id: number, patch: TicketPatch): Ticket | null {
    const existing = this.getTicket(id);
    if (!existing) return null;

    const sets: string[] = ["updated_at = datetime('now')"];
    const params: Record<string, unknown> = { id: Math.trunc(Number(id)) };

    if (patch.status !== undefined) {
      sets.push("status = @status");
      params.status = patch.status;
      if (patch.status === "closed") {
        sets.push("closed_at = COALESCE(closed_at, datetime('now'))");
      } else {
        sets.push("closed_at = NULL");
      }
    }
    if (patch.priority !== undefined) {
      sets.push("priority = @priority");
      params.priority = patch.priority;
    }
    if (patch.assignedTo !== undefined) {
      sets.push("assigned_to = @assigned_to");
      params.assigned_to = patch.assignedTo;
    }
    if (patch.subject !== undefined) {
      sets.push("subject = @subject");
      params.subject = patch.subject;
    }

    linkDb
      .prepare(`UPDATE support_tickets SET ${sets.join(", ")} WHERE id = @id`)
      .run(params);
    return this.getTicket(id);
  }

  assignOperator(id: number, operatorId: number | null): Ticket | null {
    return this.updateTicket(id, { assignedTo: operatorId });
  }

  listCategories(options?: { activeOnly?: boolean }): SupportCategory[] {
    const where = options?.activeOnly ? "WHERE active = 1" : "";
    const rows = linkDb
      .prepare(`SELECT * FROM support_categories ${where} ORDER BY sort_order ASC, key ASC`)
      .all() as CategoryRow[];
    return rows.map(mapCategory);
  }

  getCategory(key: string): SupportCategory | null {
    const value = String(key ?? "").trim();
    if (!value) return null;
    const row = linkDb.prepare(`SELECT * FROM support_categories WHERE key = ?`).get(value) as
      | CategoryRow
      | undefined;
    return row ? mapCategory(row) : null;
  }
}

export const sqliteTicketRepository = new SqliteTicketRepository();

import { linkDb } from "../../shared/linkdb/db.js";

// Additive migration; persisted in the same volume as the support conversation.
linkDb.exec(`CREATE TABLE IF NOT EXISTS support_assistant_state (
  ticket_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'active',
  reason TEXT,
  last_user_message_id INTEGER NOT NULL DEFAULT 0,
  sent_scenarios TEXT NOT NULL DEFAULT '[]',
  replies INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export type AssistantState = {
  mode: "active" | "staff" | "resolved";
  reason: string | null;
  lastUserMessageId: number;
  sentScenarios: string[];
  replies: number;
};

export function readAssistantState(ticketId: number): AssistantState | null {
  const row = linkDb.prepare("SELECT * FROM support_assistant_state WHERE ticket_id = ?").get(ticketId) as any;
  if (!row) return null;
  return { mode: row.mode, reason: row.reason, lastUserMessageId: row.last_user_message_id,
    sentScenarios: JSON.parse(row.sent_scenarios), replies: row.replies };
}

export function writeAssistantState(ticketId: number, state: AssistantState) {
  linkDb.prepare(`INSERT INTO support_assistant_state
    (ticket_id, mode, reason, last_user_message_id, sent_scenarios, replies)
    VALUES (@id, @mode, @reason, @last, @sent, @replies)
    ON CONFLICT(ticket_id) DO UPDATE SET mode=excluded.mode, reason=excluded.reason,
    last_user_message_id=excluded.last_user_message_id, sent_scenarios=excluded.sent_scenarios,
    replies=excluded.replies, updated_at=datetime('now')`).run({ id: ticketId, ...state,
      last: state.lastUserMessageId, sent: JSON.stringify(state.sentScenarios) });
}

export function assistantTransaction<T>(fn: () => T): T {
  return linkDb.transaction(fn).immediate();
}

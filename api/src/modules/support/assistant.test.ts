import assert from "node:assert/strict";
import test from "node:test";
import knowledge from "./knowledge.json" with { type: "json" };
import { suggestSupportReply } from "./assistant.js";
import type { TicketWithMessages } from "./types.js";

function ticket(text: string): TicketWithMessages {
  return { kind: "support", status: "open", serviceSnapshot: null,
    messages: [{ authorType: "user", text, deletedAt: null, isInternalNote: false }],
  } as TicketWithMessages;
}
test("knowledge has unique scenarios, resolvable checks and complete dialogue steps", () => {
  assert.equal(new Set(knowledge.scenarios.map(s => s.id)).size, 20);
  for (const s of knowledge.scenarios) {
    assert.ok(s.reply && s.next_steps.length && s.escalate_if.length && s.triggers.length);
    for (const key of s.internal_checks) assert.ok(key in knowledge.checks);
  }
});
test("Windows and import are separate stages; checks never imply success", () => {
  const result = suggestSupportReply(ticket("Windows Happ подключается, но нет интернета"));
  assert.equal(result.suggestions[0]?.id, "windows_happ_tun");
  assert.ok(result.suggestions.every(s => s.internal_checks.every(c => c.status === "unverified")));
  assert.equal(result.autoSend, false);
  assert.equal(suggestSupportReply(ticket("подписка не импортируется")).suggestions[0]?.id, "subscription_import");
});
test("failed steps and operator requests take precedence", () => {
  for (const text of ["Windows Happ нет интернета, не помогло", "Windows Happ нет интернета, нужен оператор"]) {
    const result = suggestSupportReply(ticket(text));
    assert.equal(result.needsOperator, true);
    assert.ok(["operator", "repeat_failure"].includes(result.suggestions[0]!.id));
  }
});
test("old requests, internal notes, deleted messages and staff replies cannot trigger a reply", () => {
  const t = ticket("Happ Windows нет интернета");
  t.messages.push({ ...t.messages[0]!, text: "Спасибо, заработало" });
  assert.equal(suggestSupportReply(t).suggestions[0]?.id, "resolved");
  t.messages.push({ ...t.messages[0]!, text: "нужен оператор", isInternalNote: true });
  t.messages.push({ ...t.messages[0]!, text: "нужен оператор", deletedAt: "2026-10-16" });
  assert.equal(suggestSupportReply(t).suggestions[0]?.id, "resolved");
  t.messages.push({ ...t.messages[0]!, authorType: "staff" });
  assert.deepEqual(suggestSupportReply(t).suggestions, []);
});
test("unknown request escalates; closed and partnership tickets are excluded", () => {
  assert.equal(suggestSupportReply(ticket("непонятный вопрос")).needsOperator, true);
  for (const change of [{ kind: "partnership" }, { status: "closed" }]) {
    assert.deepEqual(suggestSupportReply({ ...ticket("Happ Windows нет интернета"), ...change } as TicketWithMessages).suggestions, []);
  }
});

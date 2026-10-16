import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-assistant-"));
process.env.SUPPORT_ASSISTANT_ENABLED = "true";
process.env.SUPPORT_ADMIN_CHAT_IDS = "";
const service = await import("./service.js");
const { getTicketRepository } = await import("./repository.js");
const { runSupportAssistant } = await import("./assistantRuntime.js");
const { readAssistantState } = await import("./assistantState.js");
const repo = getTicketRepository();
const { markSupportTicketRead, listSupportUnreadTicketIds } = await import("./notifyRepo.js");
let userId = 8000;
const create = (text = "Windows Happ нет интернета", source: "app" | "telegram" = "app") =>
  service.createTicket({ userId: ++userId, categoryKey: "connection", source, text });
const bots = (id: number) => repo.listMessages(id).filter(m => m.authorName === "Помощник Shpun");
function next(id: number, text: string) {
  repo.addMessage({ ticketId: id, authorType: "user", text });
  return runSupportAssistant(repo, id);
}

test("new ticket receives named reply; retry is idempotent and queue remains visible", async () => {
  const t = await create();
  assert.equal(t.messages.length, 2);
  assert.equal(t.messages[1]!.authorName, "Помощник Shpun");
  assert.match(t.messages[1]!.text, /Привет! Я Шпунь/);
  assert.equal(t.assistant?.mode, "active");
  assert.equal(t.status, "waiting_staff");
  assert.equal(runSupportAssistant(repo, t.id), null);
  assert.equal(bots(t.id).length, 1);
});
test("short confirmation continues the active step without repeating the greeting", async () => {
  const t = await create();
  const message = next(t.id, "Перезагрузил");
  assert.match(message!.text, /Получилось/);
  assert.doesNotMatch(message!.text, /Привет/);
  assert.equal(readAssistantState(t.id)?.mode, "active");
});
test("unusual question gets a friendly introduction and a clear human handoff", async () => {
  const t = await create("Скорость около 3 мегабит");
  const text = t.messages.at(-1)!.text;
  assert.match(text, /Привет! Я Шпунь/);
  assert.match(text, /Хм…/);
  assert.match(text, /Передаю ему нашу переписку/);
  assert.doesNotMatch(text, /Обращение передано/);
  assert.equal(t.assistant?.mode, "staff");
});
test("device clarification uses only the active question and never exceeds two steps", async () => {
  const t = await create("Happ не работает");
  assert.match(t.messages.at(-1)!.text, /на каком устройстве/);
  assert.match(next(t.id, "Компьютер Windows")!.text, /перезагрузите/);
  assert.equal(readAssistantState(t.id)?.replies, 2);
  next(t.id, "подписка не импортируется");
  assert.equal(readAssistantState(t.id)?.mode, "staff");
});
test("failed transaction leaves no phantom handoff and can be safely retried", async () => {
  const t = await create();
  const count = repo.listMessages(t.id).length;
  const faultyRepo = Object.create(repo) as typeof repo;
  faultyRepo.addMessage = (input) => {
    if (input.authorType === "system") throw new Error("simulated_write_failure");
    return repo.addMessage(input);
  };
  assert.throws(() => runSupportAssistant(faultyRepo, t.id, true), /simulated_write_failure/);
  assert.equal(repo.listMessages(t.id).length, count);
  assert.equal(readAssistantState(t.id)?.mode, "active");
  service.requestSupportStaff(t.id, t.userId);
  assert.equal(readAssistantState(t.id)?.mode, "staff");
});
test("same scenario never repeats; staff request is persistent and idempotent", async () => {
  const t = await create();
  const answer = next(t.id, "Windows Happ нет интернета");
  assert.match(answer!.text, /передано сотрудникам/);
  assert.equal(readAssistantState(t.id)?.mode, "staff");
  assert.equal(next(t.id, "подписка не импортируется"), null);
  assert.equal(service.requestSupportStaff(t.id, t.userId).messages.length, 5);
  assert.throws(() => service.requestSupportStaff(t.id, t.userId + 1), /ticket_not_found/);
});
test("staff request works without any prerequisite and even with assistant disabled", async () => {
  const t = await create();
  markSupportTicketRead(101, t.id);
  assert.ok(!listSupportUnreadTicketIds(101).includes(t.id));
  process.env.SUPPORT_ASSISTANT_ENABLED = "false";
  try {
    service.requestSupportStaff(t.id, t.userId);
    const count = bots(t.id).length;
    service.requestSupportStaff(t.id, t.userId);
    assert.equal(bots(t.id).length, count);
    assert.equal(readAssistantState(t.id)?.mode, "staff");
    assert.ok(listSupportUnreadTicketIds(101).includes(t.id));
    assert.equal((await create()).messages.length, 1);
  } finally { process.env.SUPPORT_ASSISTANT_ENABLED = "true"; }
});
test("failed steps, uncertain context and unknown questions immediately go to a person", async () => {
  for (const text of ["не помогло", "нужен сотрудник", "Amnezia не работает", "лимит устройств", "RU-сервер не работает", "не заработало", "вопрос про оплату"]) {
    const t = await create(text);
    assert.equal(t.assistant?.mode, "staff", text);
    assert.equal(t.messages.length, 2);
  }
});
test("attachments go to staff; no attempt to pretend to read an image", async () => {
  const t = await create();
  const result = service.addUserMessageWithAttachments(t.id, t.userId, "Вот снимок", [{
    filename: "screen.jpg", mimetype: "image/jpeg",
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]),
  }]);
  assert.equal(result.assistant?.mode, "staff");
  assert.match(result.messages.at(-1)!.text, /передано сотрудникам/);
});
test("resolution never closes a ticket and asks for feedback once; recurrence goes to staff", async () => {
  const t = await create();
  assert.match(next(t.id, "Спасибо, всё работает!")!.text, /по желанию|Если захотите/);
  assert.notEqual(repo.getTicket(t.id)!.status, "closed");
  assert.equal(next(t.id, "всё работает"), null);
  assert.equal(readAssistantState(t.id)?.mode, "resolved");
  next(t.id, "Снова не подключается");
  assert.equal(readAssistantState(t.id)?.mode, "staff");
});
test("human reply and assignment stop automation; internal notes do not", async () => {
  const t = await create();
  service.addStaffMessage({ ticketId: t.id, operatorId: 1, text: "Заметка", internal: true });
  assert.equal(readAssistantState(t.id)?.mode, "active");
  service.addStaffMessage({ ticketId: t.id, operatorId: 1, text: "Здравствуйте, помогу" });
  assert.equal(next(t.id, "подписка не импортируется"), null);
  assert.equal(readAssistantState(t.id)?.mode, "staff");
  const assigned = await create();
  service.updateTicketByAdmin(assigned.id, { assignedTo: 1 });
  service.updateTicketByAdmin(assigned.id, { assignedTo: null });
  assert.equal(next(assigned.id, "подписка не импортируется"), null);
});
test("confirmed incident overrides local reinstalls and then hands over", async () => {
  process.env.SUPPORT_ASSISTANT_INCIDENT_TEXT = "Есть проблема с добавлением подписок. Мы уже разбираемся.";
  try {
    const t = await create();
    assert.match(t.messages.at(-1)!.text, /Мы уже разбираемся/);
    assert.doesNotMatch(t.messages.at(-1)!.text, /перезагрузите|переустанов/);
    assert.equal(t.assistant?.mode, "staff");
  } finally { delete process.env.SUPPORT_ASSISTANT_INCIDENT_TEXT; }
});
test("restart retains handoff and prevents any new automatic answer", async () => {
  const t = await create("оператор");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const {readAssistantState}=await import('./src/modules/support/assistantState.ts');
    const {runSupportAssistant}=await import('./src/modules/support/assistantRuntime.ts');
    const {getTicketRepository}=await import('./src/modules/support/repository.ts');
    const state=readAssistantState(${t.id});
    if(state?.mode!=='staff'||runSupportAssistant(getTicketRepository(),${t.id})!==null) process.exit(2);
  `], { encoding: "utf8", env: process.env });
  assert.equal(child.status, 0, child.stderr);
});
test("Telegram has a clear identity and direct route to a person; closed tickets do not respond", async () => {
  const t = await create(undefined, "telegram");
  assert.match(t.messages.at(-1)!.text, /^Помощник Shpun/);
  assert.match(t.messages.at(-1)!.text, /напишите «оператор»/);
  service.closeUserTicket(t.id, t.userId);
  assert.equal(runSupportAssistant(repo, t.id, true), null);
});

import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-att-"));
process.env.SUPPORT_ADMIN_CHAT_IDS = "";

const service = await import("./service.js");
const { saveMessageAttachments, cleanupExpiredAttachments, AttachmentError } = await import(
  "./attachmentService.js"
);
const { LocalAttachmentStorage, setAttachmentStorage, getAttachmentStorage } = await import(
  "./attachmentStorage.js"
);
const { getAttachment, markAttachmentDeleted } = await import("./attachmentRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

const filesDir = mkdtempSync(path.join(tmpdir(), "shpun-support-att-files-"));
setAttachmentStorage(new LocalAttachmentStorage(filesDir));

/* ─── Fixtures ───────────────────────────────────────────────────────────── */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from("%PDF-1.4\n% test pdf\n");

function pngBuffer(width = 4, height = 3): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(buf, 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const INVALID = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0x03]), Buffer.alloc(32, 0)]);

function upload(name: string, buffer: Buffer) {
  return { filename: name, mimetype: "application/octet-stream", buffer };
}

async function newTicket(userId = 900) {
  return await service.createTicket({ userId, source: "app", categoryKey: "other", text: "Тестовый тикет" });
}

/* ─── Storage / validation ───────────────────────────────────────────────── */

test("stores JPEG, PNG and PDF with detected mime types", async () => {
  const ticket = await newTicket(901);
  const created = service.addUserMessageWithAttachments(ticket.id, 901, "файлы", [
    upload("photo.jpg", JPEG),
    upload("shot.png", pngBuffer()),
    upload("doc.pdf", PDF),
  ]);

  const msg = created.messages[created.messages.length - 1];
  assert.equal(msg.attachments?.length, 3);
  assert.deepEqual(
    msg.attachments!.map((a) => a.mimeType).sort(),
    ["application/pdf", "image/jpeg", "image/png"].sort()
  );
  const png = msg.attachments!.find((a) => a.mimeType === "image/png")!;
  assert.equal(png.width, 4);
  assert.equal(png.height, 3);
  assert.ok(getAttachmentStorage().exists(png.storageKey));
});

test("rejects unsupported / invalid files", () => {
  assert.throws(
    () => saveMessageAttachments({ ticketId: 1, messageId: 1, files: [upload("x.bin", INVALID)] }),
    (e: any) => e instanceof AttachmentError && e.code === "unsupported_file_type"
  );
});

test("rejects oversized file, too many files and oversized message", () => {
  const prevFile = process.env.SUPPORT_ATTACHMENT_MAX_FILE_MB;
  const prevMsg = process.env.SUPPORT_ATTACHMENT_MAX_MESSAGE_MB;
  const prevFiles = process.env.SUPPORT_ATTACHMENT_MAX_FILES;
  try {
    process.env.SUPPORT_ATTACHMENT_MAX_FILE_MB = "1";
    assert.throws(
      () => saveMessageAttachments({ ticketId: 1, messageId: 1, files: [upload("big.jpg", Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024, 1)]))] }),
      (e: any) => e?.code === "file_too_large"
    );

    process.env.SUPPORT_ATTACHMENT_MAX_FILES = "2";
    assert.throws(
      () => saveMessageAttachments({ ticketId: 1, messageId: 1, files: [upload("a.jpg", JPEG), upload("b.jpg", JPEG), upload("c.jpg", JPEG)] }),
      (e: any) => e?.code === "too_many_files"
    );

    process.env.SUPPORT_ATTACHMENT_MAX_FILES = "5";
    process.env.SUPPORT_ATTACHMENT_MAX_MESSAGE_MB = "1";
    const half = Buffer.concat([JPEG, Buffer.alloc(600 * 1024, 1)]);
    assert.throws(
      () => saveMessageAttachments({ ticketId: 1, messageId: 1, files: [upload("a.jpg", half), upload("b.jpg", half)] }),
      (e: any) => e?.code === "message_too_large"
    );
  } finally {
    if (prevFile === undefined) delete process.env.SUPPORT_ATTACHMENT_MAX_FILE_MB; else process.env.SUPPORT_ATTACHMENT_MAX_FILE_MB = prevFile;
    if (prevMsg === undefined) delete process.env.SUPPORT_ATTACHMENT_MAX_MESSAGE_MB; else process.env.SUPPORT_ATTACHMENT_MAX_MESSAGE_MB = prevMsg;
    if (prevFiles === undefined) delete process.env.SUPPORT_ATTACHMENT_MAX_FILES; else process.env.SUPPORT_ATTACHMENT_MAX_FILES = prevFiles;
  }
});

test("supports text-only, attachment-only and text+attachment messages", async () => {
  const ticket = await newTicket(902);

  const textOnly = service.addUserMessageWithAttachments(ticket.id, 902, "только текст", []);
  assert.equal(textOnly.messages[textOnly.messages.length - 1].attachments?.length, 0);

  const attOnly = service.addUserMessageWithAttachments(ticket.id, 902, "", [upload("only.pdf", PDF)]);
  const attOnlyMsg = attOnly.messages[attOnly.messages.length - 1];
  assert.equal(attOnlyMsg.text, "");
  assert.equal(attOnlyMsg.attachments?.length, 1);

  const both = service.addUserMessageWithAttachments(ticket.id, 902, "смотрите", [upload("both.jpg", JPEG), upload("both.pdf", PDF)]);
  const bothMsg = both.messages[both.messages.length - 1];
  assert.equal(bothMsg.attachments?.length, 2);
});

test("closed ticket rejects attachment messages", async () => {
  const ticket = await newTicket(903);
  service.closeUserTicket(ticket.id, 903);
  assert.throws(
    () => service.addUserMessageWithAttachments(ticket.id, 903, "", [upload("x.jpg", JPEG)]),
    (e: any) => e?.code === "ticket_closed"
  );
});

test("partnership proposals accept attachments in the conversation", async () => {
  const proposal = await service.createPartnership({
    userId: 904,
    source: "app",
    proposalType: "channel",
    platformUrl: "@example",
    offer: "Предлагаю размещение в канале.",
  });
  const updated = service.addUserMessageWithAttachments(proposal.id, 904, "медиакит", [
    upload("mediakit.pdf", PDF),
    upload("stats.png", pngBuffer()),
  ]);
  const msg = updated.messages[updated.messages.length - 1];
  assert.equal(msg.attachments?.length, 2);
});

/* ─── Retention ──────────────────────────────────────────────────────────── */

function ageAttachment(attachmentId: number, days: number) {
  linkDb
    .prepare(`UPDATE support_attachments SET created_at = datetime('now', ?) WHERE id = ?`)
    .run(`-${days} days`, attachmentId);
}

test("attachments younger than retention remain", async () => {
  const ticket = await newTicket(905);
  const updated = service.addUserMessageWithAttachments(ticket.id, 905, "", [upload("young.jpg", JPEG)]);
  const att = updated.messages[updated.messages.length - 1].attachments![0];
  ageAttachment(att.id, 10);

  const summary = cleanupExpiredAttachments({ retentionDays: 180 });
  assert.ok(summary.scanned >= 0);
  assert.equal(getAttachment(att.id)?.deletedAt, null);
  assert.ok(getAttachmentStorage().exists(att.storageKey));
});

test("attachments older than retention are physically deleted with metadata kept", async () => {
  const ticket = await newTicket(906);
  const updated = service.addUserMessageWithAttachments(ticket.id, 906, "", [upload("old.jpg", JPEG)]);
  const att = updated.messages[updated.messages.length - 1].attachments![0];
  ageAttachment(att.id, 200);

  const summary = cleanupExpiredAttachments({ retentionDays: 180 });
  assert.ok(summary.deleted >= 1);

  const after = getAttachment(att.id);
  assert.ok(after);
  assert.ok(after!.deletedAt);
  assert.equal(after!.deleteReason, "retention");
  assert.equal(after!.originalName, "old.jpg");
  assert.equal(getAttachmentStorage().exists(att.storageKey), false);

  // Repeated cleanup is safe and idempotent.
  const again = cleanupExpiredAttachments({ retentionDays: 180 });
  assert.ok(again.expired >= 0);
  assert.equal(getAttachment(att.id)?.deleteReason, "retention");
});

test("missing physical file does not crash cleanup", async () => {
  const ticket = await newTicket(907);
  const updated = service.addUserMessageWithAttachments(ticket.id, 907, "", [upload("gone.jpg", JPEG)]);
  const att = updated.messages[updated.messages.length - 1].attachments![0];
  getAttachmentStorage().remove(att.storageKey);
  ageAttachment(att.id, 200);

  const summary = cleanupExpiredAttachments({ retentionDays: 180 });
  assert.ok(summary.already_missing >= 1);
  assert.ok(getAttachment(att.id)?.deletedAt);
});

test("one deletion failure does not stop the rest", async () => {
  const ticket = await newTicket(908);
  const updated = service.addUserMessageWithAttachments(ticket.id, 908, "", [
    upload("bad.jpg", JPEG),
    upload("good.jpg", JPEG),
  ]);
  const [bad, good] = updated.messages[updated.messages.length - 1].attachments!;
  ageAttachment(bad.id, 200);
  ageAttachment(good.id, 200);

  const failingStorage = {
    save: () => ({ storageProvider: "local", storageKey: "x" }),
    read: () => null,
    exists: () => false,
    remove: (key: string) => (getAttachment(bad.id)?.storageKey === key ? "failed" : getAttachmentStorage().remove(key)),
    listKeys: () => [],
  };

  const summary = cleanupExpiredAttachments({ retentionDays: 180, storage: failingStorage as any });
  assert.ok(summary.failed >= 1);
  // The other attachment was still processed.
  assert.ok(getAttachment(good.id)?.deletedAt);
});

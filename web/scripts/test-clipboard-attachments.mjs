#!/usr/bin/env node
// Regression tests for clipboard image extraction + the shared attachment
// composer wiring (user/admin/partnership must not re-implement paste logic).
//
// Usage: npm run test:clipboard

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "shpun-clipboard-"));
const outfile = path.join(outDir, "clipboard.mjs");

await build({
  stdin: {
    contents: [
      'export { extractClipboardImageFiles, screenshotFileName } from "./src/shared/support/clipboardAttachments.ts";',
      'export { toPendingFiles, releasePendingFiles, ATTACHMENT_MIME_TYPES, ATTACHMENT_ACCEPT } from "./src/shared/support/attachments.ts";',
    ].join("\n"),
    resolveDir: webRoot,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile,
  logLevel: "silent",
});

const { extractClipboardImageFiles, screenshotFileName, toPendingFiles, releasePendingFiles, ATTACHMENT_MIME_TYPES, ATTACHMENT_ACCEPT } =
  await import(pathToFileURL(outfile).href);

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function file(bytes, name, type) {
  return new File([bytes], name, { type });
}
function imageItem(itemType, f) {
  return { kind: "file", type: itemType, getAsFile: () => f };
}
function clipboard(items, files = []) {
  return { clipboardData: { items, files } };
}

/* 1. Screenshot name is safe + stamped. */
const stamped = screenshotFileName(new Date(2026, 8, 20, 21, 35, 0), "png");
check("screenshot filename format", stamped, "screenshot-2026-09-20-213500.png");
check("screenshot filename is safe", /^[a-z0-9.\-]+$/.test(stamped), true);

/* 2. Plain text paste -> no image files (text paste left intact). */
check("text-only clipboard", extractClipboardImageFiles(clipboard([])), []);

/* 3. PNG without a name -> generated screenshot name. */
const unnamedPng = extractClipboardImageFiles(clipboard([imageItem("image/png", file(PNG, "", "image/png"))]));
check("png extracted", unnamedPng.length, 1);
check("png generated name", /^screenshot-\d{4}-\d{2}-\d{2}-\d{6}\.png$/.test(unnamedPng[0].name), true);
check("png mime preserved", unnamedPng[0].type, "image/png");

/* 4. Clipboard file with a reasonable name keeps it. */
const named = extractClipboardImageFiles(clipboard([imageItem("image/png", file(PNG, "shot.png", "image/png"))]));
check("reasonable name kept", named[0].name, "shot.png");

/* 5. jpeg / webp extension mapping. */
const jpeg = extractClipboardImageFiles(clipboard([imageItem("image/jpeg", file(JPEG, "", "image/jpeg"))]));
check("jpeg extension", /\.jpg$/.test(jpeg[0].name), true);
const webp = extractClipboardImageFiles(clipboard([imageItem("image/webp", file(PNG, "", "image/webp"))]));
check("webp extension", /\.webp$/.test(webp[0].name), true);

/* 6. Multiple images (up to the composer limit later). */
const many = extractClipboardImageFiles(
  clipboard([
    imageItem("image/png", file(PNG, "", "image/png")),
    imageItem("image/png", file(PNG, "", "image/png")),
    imageItem("image/png", file(PNG, "", "image/png")),
  ])
);
check("multiple images extracted", many.length, 3);

/* 7. Non-image file items are ignored (no backend bypass). */
check(
  "non-image ignored",
  extractClipboardImageFiles(clipboard([imageItem("application/pdf", file(PNG, "x.pdf", "application/pdf"))])),
  []
);
check(
  "svg is not extracted by the client allowlist",
  extractClipboardImageFiles(clipboard([imageItem("image/svg+xml", file(PNG, "x.svg", "image/svg+xml"))])),
  []
);

/* 7b. MIME consistency with the backend allowlist (source of truth). */
const backendStorageSrc = fs.readFileSync(
  path.join(webRoot, "..", "api", "src", "modules", "support", "attachmentStorage.ts"),
  "utf8"
);
const allowedBlock = backendStorageSrc.match(/const ALLOWED_MIME = new Set\(\[([\s\S]*?)\]\);/);
check("backend ALLOWED_MIME block found", Boolean(allowedBlock), true);
const backendMimes = [...(allowedBlock ? allowedBlock[1].matchAll(/"([^"]+)"/g) : [])]
  .map((m) => m[1])
  .sort();
check("frontend allowlist == backend allowlist", [...ATTACHMENT_MIME_TYPES].sort(), backendMimes);
check("ATTACHMENT_ACCEPT derives from the shared list", ATTACHMENT_ACCEPT, ATTACHMENT_MIME_TYPES.join(","));

// Clipboard must accept exactly the supported image MIME types...
for (const type of ATTACHMENT_MIME_TYPES.filter((t) => t.startsWith("image/"))) {
  const files = extractClipboardImageFiles(clipboard([imageItem(type, file(PNG, "", type))]));
  check(`clipboard accepts supported ${type}`, files.length, 1);
}
// ...and reject types the backend would refuse (e.g. GIF is not in the allowlist).
check(
  "clipboard rejects gif (not in backend allowlist)",
  extractClipboardImageFiles(clipboard([imageItem("image/gif", file(PNG, "", "image/gif"))])),
  []
);

/* 8. dt.files fallback. */
const fallback = extractClipboardImageFiles(clipboard([], [file(PNG, "", "image/png")]));
check("files fallback", fallback.length, 1);

/* 9. Unsafe name -> regenerated. */
const unsafe = extractClipboardImageFiles(
  clipboard([imageItem("image/png", file(PNG, "screensh\u0007ot.png", "image/png"))])
);
check("unsafe name replaced", /^screenshot-/.test(unsafe[0].name), true);

/* 10. Pending pipeline: preview object URL for images, none for others. */
const pending = toPendingFiles([file(PNG, "a.png", "image/png"), file(PNG, "a.pdf", "application/pdf")]);
check("pending count", pending.length, 2);
check("image has preview url", typeof pending[0].previewUrl, "string");
check("non-image has no preview url", pending[1].previewUrl === undefined, true);
releasePendingFiles(pending); // must not throw

/* ── Static: single shared paste path (no per-composer duplication) ──────── */
const composers = [
  "src/pages/Support.tsx",
  "src/pages/admin/SupportSection.tsx",
  "src/pages/Partnership.tsx",
];
for (const rel of composers) {
  const src = fs.readFileSync(path.join(webRoot, rel), "utf8");
  check(`${rel}: uses shared hook`, /useAttachmentComposer/.test(src), true);
  check(`${rel}: textarea onPaste`, /onPaste=\{handlePaste\}/.test(src), true);
  check(`${rel}: no local clipboardData parsing`, /clipboardData/.test(src), false);
  check(`${rel}: no local toPendingFiles`, /toPendingFiles/.test(src), false);
}

fs.rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\nFAIL: ${failures} clipboard assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK: clipboard image extraction + shared composer wiring verified");
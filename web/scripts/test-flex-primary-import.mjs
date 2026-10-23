import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.window = new EventTarget();

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/flexPrimaryImport.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { hasFlexPrimaryImport, markFlexPrimaryImport } = await import(moduleUrl);

assert.equal(hasFlexPrimaryImport(10, 100), false, "Plus starts muted on a new device");
let updates = 0;
window.addEventListener("shpun:flex-primary-import", () => updates++);
markFlexPrimaryImport(10, 100);
assert.equal(updates, 1, "the open service list is updated immediately after the import action");
assert.equal(hasFlexPrimaryImport(10, 100), true);
assert.equal(hasFlexPrimaryImport(11, 100), false, "switching accounts does not unlock someone else's Plus key");
assert.equal(hasFlexPrimaryImport(10, 101), false, "another service still needs its own primary key");

const reloaded = await import(`${moduleUrl}#reload`);
assert.equal(reloaded.hasFlexPrimaryImport(10, 100), true, "closing the assistant or reloading preserves progress");
assert.equal(reloaded.hasFlexPrimaryImport(10, 101), false);
markFlexPrimaryImport(0, 101);
assert.equal(hasFlexPrimaryImport(10, 101), false, "missing account identity cannot unlock a key");

globalThis.localStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
};
markFlexPrimaryImport(10, 102);
assert.equal(hasFlexPrimaryImport(10, 102), true, "import flow remains usable when browser storage is blocked");
assert.equal(hasFlexPrimaryImport(10, 103), false);
console.log("PASS Flex import order, account/service isolation, reload and unavailable storage");

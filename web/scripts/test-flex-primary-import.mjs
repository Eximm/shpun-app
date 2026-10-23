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
  stdin: {
    contents: 'export * from "./flexPrimaryImport"; export * from "./connectionAssistant";',
    resolveDir: fileURLToPath(new URL("../src/shared/", import.meta.url)),
  },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { hasFlexPrimaryImport, markFlexPrimaryImport, flexPrimaryService, visibleFlexServices, selectConnectionService } = await import(moduleUrl);

const main = { userServiceId: 100, category: "remnawave" };
const plus = { userServiceId: 101, category: "remnawave-wl", parent: 100 };
const router = { userServiceId: 102, category: "remnawave-r" };
const orphan = { userServiceId: 103, category: "remnawave-wl", parent: 999 };
const services = [main, plus, router, orphan];
assert.deepEqual(visibleFlexServices(services), [main, router, orphan], "bundled Plus has no separate tile or service count");
assert.equal(flexPrimaryService(plus, services), main, "old Plus links open the primary service");
assert.equal(flexPrimaryService(orphan, services), orphan, "unlinked keys remain accessible");
assert.equal(flexPrimaryService(main, services), main);

const activeMain = { ...main, status: "active" };
const pendingMain = { ...main, status: "pending" };
const activePlus = { ...plus, status: "active" };
const pendingPlus = { ...plus, status: "pending" };
assert.equal(selectConnectionService([activePlus, pendingMain]), pendingMain,
  "an active additional key does not bypass the main service preparation screen");
assert.equal(selectConnectionService([pendingPlus, activeMain], plus.userServiceId), activeMain,
  "a direct assistant link to a pending Plus key opens its ready main service");
const unpaidMain = { ...main, status: "not_paid" };
assert.equal(selectConnectionService([activePlus, unpaidMain], plus.userServiceId), unpaidMain,
  "payment is requested for the main service, not its bundled key");
assert.equal(selectConnectionService([{ ...main, status: "removed" }]), null);
assert.equal(selectConnectionService([]), null);

assert.equal(hasFlexPrimaryImport(10, 100), false, "Plus starts hidden inside the primary connector");
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

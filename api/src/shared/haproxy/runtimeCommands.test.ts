import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSetStateCommand,
  buildSetWeightCommand,
  interpretRuntimeReply,
  isValidHaproxyName,
} from "./runtimeCommands.js";

test("builds valid state commands", () => {
  assert.equal(buildSetStateCommand("reality_fi", "fi_real_v4", "maint"), "set server reality_fi/fi_real_v4 state maint");
  assert.equal(buildSetStateCommand("router_de", "de_router_v6_0", "ready"), "set server router_de/de_router_v6_0 state ready");
  assert.equal(buildSetStateCommand("xhttp_pl_cdn", "pl_xhttp_v4", "drain"), "set server xhttp_pl_cdn/pl_xhttp_v4 state drain");
});

test("builds valid weight commands within bounds", () => {
  assert.equal(buildSetWeightCommand("reality_fi", "fi_real_v4", 4), "set server reality_fi/fi_real_v4 weight 4");
  assert.equal(buildSetWeightCommand("reality_fi", "fi_real_v4", 0), "set server reality_fi/fi_real_v4 weight 0");
  assert.equal(buildSetWeightCommand("reality_fi", "fi_real_v4", 256), "set server reality_fi/fi_real_v4 weight 256");
});

test("rejects invalid state", () => {
  assert.throws(() => buildSetStateCommand("bk", "sv", "running"), /invalid_state/);
});

test("rejects out-of-range or non-integer weight", () => {
  assert.throws(() => buildSetWeightCommand("bk", "sv", 257), /invalid_weight/);
  assert.throws(() => buildSetWeightCommand("bk", "sv", -1), /invalid_weight/);
  assert.throws(() => buildSetWeightCommand("bk", "sv", 1.5), /invalid_weight/);
});

test("rejects command injection via names", () => {
  assert.equal(isValidHaproxyName("reality_fi"), true);
  assert.equal(isValidHaproxyName("bad name"), false);
  assert.equal(isValidHaproxyName("bk/sv"), false);
  assert.equal(isValidHaproxyName("bk\nshutdown"), false);
  assert.throws(() => buildSetStateCommand("bk\nadd server x", "sv", "maint"), /invalid_backend_name/);
  assert.throws(() => buildSetWeightCommand("bk", "sv; disable", 1), /invalid_server_name/);
});

test("interprets runtime reply (empty = success)", () => {
  assert.deepEqual(interpretRuntimeReply(""), { ok: true, message: "" });
  assert.deepEqual(interpretRuntimeReply("  \n"), { ok: true, message: "" });
  const bad = interpretRuntimeReply("No such server.");
  assert.equal(bad.ok, false);
  assert.equal(bad.message, "No such server.");
});

import assert from "node:assert/strict";
import test from "node:test";
import voice from "./voice.json" with { type: "json" };
import { chooseSupportVoice } from "./voice.js";

test("catalog has 110 original phrases grouped by conversational purpose", () => {
  assert.equal(Object.values(voice.groups).flat().length, 110);
  for (const variants of Object.values(voice.groups)) {
    assert.equal(new Set(variants).size, variants.length);
    assert.ok(variants.every(v => v.trim() && v.length < 350));
  }
  assert.ok(voice.groups.greeting.every(v => /Шпунь/.test(v)));
});
test("variants change between tickets and remain stable for retries", () => {
  for (const group of Object.keys(voice.groups) as (keyof typeof voice.groups)[]) {
    const results = new Set<string>();
    for (let id = 1; id <= 80; id++) {
      const text = chooseSupportVoice(group, id, id * 2, 0);
      results.add(text);
      assert.equal(chooseSupportVoice(group, id, id * 2, 0), text);
      assert.ok(voice.groups[group].includes(text));
    }
    assert.ok(results.size >= Math.min(3, voice.groups[group].length), group);
  }
});

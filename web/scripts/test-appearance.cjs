const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/app/appearance/raceModel.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject });
const { newRace, steerRace, advanceRace } = exportsObject;
let race = newRace();
race = steerRace(race, -1); race = steerRace(race, -1);
assert.equal(race.lane, 0);
race = steerRace(steerRace(steerRace(race, 1), 1), 1);
assert.equal(race.lane, 2);
race = { ...newRace(), spawnAt: 999, items: [{ id: 1, x: 27, lane: 1, kind: "star" }, { id: 2, x: 27, lane: 0, kind: "barrier" }] };
race = advanceRace(race, .05);
assert.equal(race.stars, 1); assert.equal(race.lives, 3);
race = advanceRace(race, .05);
assert.equal(race.stars, 1, "a star can only be collected once");
race = advanceRace({ ...newRace(), spawnAt: 999, lives: 1, items: [{ id: 1, x: 25, lane: 1, kind: "barrier" }] }, .05);
assert.equal(race.finished, true); assert.equal(race.lives, 0);
assert.equal(advanceRace(race, .05), race, "finished races are immutable");
race = advanceRace({ ...newRace(), spawnAt: 999, elapsed: 29.99 }, .05);
assert.equal(race.finished, true);
assert.equal(advanceRace(newRace(), 100).elapsed, .1, "background frame gaps are bounded");
console.log("PASS lane bounds, collection, collision, timer and paused/background safety");

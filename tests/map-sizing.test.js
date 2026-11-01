const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const geometry = require("../map-hole-geometry.js");

function element() {
  return {
    value: "", checked: false, textContent: "", innerHTML: "", className: "",
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, click() {},
    contains() { return false; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
  };
}
function editor() {
  const elements = new Map();
  elements.set("mapCanvas", { ...element(), getContext() { return {}; } });
  const document = {
    activeElement: null, body: element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelector() { return element(); }, querySelectorAll() { return []; },
    createElement() { return element(); }, addEventListener() {},
  };
  const storage = new Map();
  const context = vm.createContext({
    __COSMOWAR_EDITOR_TEST__: true, MapHoleGeometry: geometry,
    document, console, structuredClone,
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)) },
    alert() {}, confirm() { return true; }, setTimeout() { return 0; }, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context, { filename: "app.js" });
  return context.CosmowarEditorTestApi;
}
function map(overrides = {}) {
  return {
    spawn_protection_size: 500,
    map_boundaries: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    spawn_points: [{ team_id: 0, x: 600, y: 700 }, { team_id: 1, x: 3400, y: 2400 }],
    bomb_sites: [{ site_letter: "A", x: 2000, y: 1500 }],
    towers: [], walls: [], ...overrides,
  };
}

test("legacy map roundtrip leaves optional sizing fields absent", () => {
  const e = editor();
  e.importState(map());
  assert.equal(JSON.stringify(e.getSpawnDimensions()), JSON.stringify({ width: 500, height: 500 }));
  assert.equal(e.getBombRadius(0), 250);
  const payload = e.exportState();
  assert.equal(payload.spawn_protection_size, 500);
  assert.equal(Object.hasOwn(payload, "spawn_protection_width"), false);
  assert.equal(Object.hasOwn(payload, "spawn_protection_height"), false);
  assert.equal(Object.hasOwn(payload.bomb_sites[0], "radius"), false);
});

test("spawn width and height are independent, valid, persisted and undoable", () => {
  const e = editor();
  e.importState(map());
  e.setSpawnDimensions(900, 300);
  assert.equal(JSON.stringify(e.getSpawnDimensions()), JSON.stringify({ width: 900, height: 300 }));
  const payload = e.exportState();
  assert.equal(payload.spawn_protection_width, 900);
  assert.equal(payload.spawn_protection_height, 300);
  assert.equal(e.validationMessages().length, 0);
  e.undo();
  assert.equal(JSON.stringify(e.getSpawnDimensions()), JSON.stringify({ width: 500, height: 500 }));
  assert.equal(Object.hasOwn(e.exportState(), "spawn_protection_width"), false);
  e.redo();
  assert.equal(e.exportState().spawn_protection_height, 300);
  assert.throws(() => e.setSpawnDimensions(0, 300), /greater than zero/);
});

test("partially specified spawn axes use legacy size for the other axis", () => {
  const e = editor();
  e.importState(map({ spawn_protection_width: 800 }));
  assert.equal(JSON.stringify(e.getSpawnDimensions()), JSON.stringify({ width: 800, height: 500 }));
  assert.equal(e.exportState().spawn_protection_width, 800);
  assert.equal(Object.hasOwn(e.exportState(), "spawn_protection_height"), false);
});

test("bomb radius persists and causes hole collision after enlargement", () => {
  const e = editor();
  const hole = [{ x: 2600, y: 1300 }, { x: 2800, y: 1300 }, { x: 2800, y: 1700 }, { x: 2600, y: 1700 }];
  e.importState(map({ map_holes: [hole] }));
  assert.equal(e.validationMessages().filter((m) => /overlaps hole/.test(m)).length, 0);
  e.setBombRadius(0, 700);
  assert.equal(e.exportState().bomb_sites[0].radius, 700);
  assert.match(e.validationMessages().join(" "), /Bomb site 'A' overlaps hole 0/);
  e.undo();
  assert.equal(Object.hasOwn(e.exportState().bomb_sites[0], "radius"), false);
  e.redo();
  assert.equal(e.exportState().bomb_sites[0].radius, 700);
  assert.throws(() => e.setBombRadius(0, -1), /greater than zero/);
});

test("invalid optional sizes fail on import rather than being silently truncated", () => {
  const e = editor();
  assert.throws(() => e.importState(map({ spawn_protection_height: 0 })), /spawn_protection_height.*greater than zero/);
  assert.throws(() => e.importState(map({ bomb_sites: [{ site_letter: "A", x: 2000, y: 1500, radius: -1 }] })), /radius.*greater than zero/);
});

test("existing map geometry respects a per-site bomb radius on upload", () => {
  const e = editor();
  e.importState(map({ bomb_sites: [{ site_letter: "A", x: 2000, y: 1500, radius: 420 }] }));
  assert.equal(e.getBombRadius(0), 420);
  assert.equal(e.exportState().bomb_sites[0].radius, 420);
  assert.equal(e.validationMessages().length, 0);
});

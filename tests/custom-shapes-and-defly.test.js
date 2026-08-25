const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const convertDeflyMap = require("../defly-import.js");
const geometry = require("../map-hole-geometry.js");

function createElement(overrides = {}) {
  return {
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    click() {},
    contains() { return false; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    ...overrides,
  };
}

function loadEditor() {
  const elements = new Map();
  elements.set("mapCanvas", createElement({ getContext() { return {}; } }));
  const document = {
    activeElement: null,
    body: createElement(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelector() { return createElement(); },
    querySelectorAll() { return []; },
    createElement() { return createElement(); },
    addEventListener() {},
  };
  const storage = new Map();
  const context = vm.createContext({
    __COSMOWAR_EDITOR_TEST__: true,
    MapHoleGeometry: geometry,
    document,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    structuredClone,
    console,
    alert() {},
    confirm() { return true; },
    setTimeout() { return 0; },
    clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context, { filename: "app.js" });
  return context.CosmowarEditorTestApi;
}

function emptyMap() {
  return {
    spawn_protection_size: 100,
    map_boundaries: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
    spawn_points: [],
    bomb_sites: [],
    towers: [],
    walls: [],
  };
}

function shapeClipboard(towerIds = [10, 20], offset = 0) {
  return {
    towers: [
      { id: towerIds[0], dx: -100 - offset, dy: 0, team_id: 0, health: 4, is_invincible: false },
      { id: towerIds[1], dx: 100 + offset, dy: 0, team_id: 0, health: 4, is_invincible: false },
    ],
    walls: [{ t1: towerIds[0], t2: towerIds[1], team_id: 0 }],
    spawns: [],
    bombs: [],
    structures: [],
  };
}

test("custom shape imports append unique presets, ignore identity-only duplicates, and preserve name collisions", () => {
  const editor = loadEditor();
  editor.clearCustomShapes();
  const duplicateWithDifferentIdsAndOrder = shapeClipboard([70, 80]);
  duplicateWithDifferentIdsAndOrder.towers.reverse();
  duplicateWithDifferentIdsAndOrder.walls = [{ t1: 80, t2: 70, team_id: 0 }];

  const result = editor.importCustomShapes({
    type: "cosmowar-custom-shapes",
    version: 1,
    custom_shapes: [
      { id: "first", name: "Gate", clipboard: shapeClipboard() },
      { id: "duplicate", name: "Same geometry", clipboard: duplicateWithDifferentIdsAndOrder },
      { id: "second", name: "Gate", clipboard: shapeClipboard([30, 40], 50) },
    ],
  });

  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.shapes.map((shape) => shape.name), ["Gate", "Gate (2)"]);

  assert.throws(() => editor.importCustomShapes({
    custom_shapes: [
      { name: "Would otherwise import", clipboard: shapeClipboard([90, 100], 90) },
      { name: "Broken", clipboard: { towers: "not-an-array" } },
    ],
  }), /towers must be an array/);
  assert.equal(editor.getCustomShapes().length, 2, "a failed file import must not append a partial batch");
});

test("using a custom shape enters the group placement path and recreates connected walls", () => {
  const editor = loadEditor();
  editor.importState(emptyMap());
  editor.importCustomShapes({ custom_shapes: [{ name: "Gate", clipboard: shapeClipboard() }] });
  const placement = editor.placeCustomShape(0, 1800, 1200);

  assert.equal(placement.valid, true);
  assert.equal(placement.state.towers.length, 2);
  assert.equal(placement.state.walls.length, 1);
  assert.equal(placement.state.towers[1].x - placement.state.towers[0].x, 200);
  assert.equal(placement.state.towers[0].y, placement.state.towers[1].y);
  assert.deepEqual([placement.state.walls[0].t1, placement.state.walls[0].t2], [1, 2]);
});

const deflyText = [
  "MAP_WIDTH 100",
  "MAP_HEIGHT 60",
  "s 1 2 2",
  "s 2 89 49",
  "d 1 20 25 2",
  "d 2 30 25 2",
  "l 1 2",
].join("\n");

test("Defly conversion options adjust spacing and clearances without changing connectivity", () => {
  const normal = convertDeflyMap(deflyText, {
    spacingPercent: 100,
    unitSize: 32,
    spawnProtectionSize: 100,
    towerClearance: 35.2,
    bombClearance: 250,
    boundaryPadding: 1,
  });
  const expanded = convertDeflyMap(deflyText, {
    spacingPercent: 150,
    unitSize: 32,
    spawnProtectionSize: 300,
    towerClearance: 80,
    bombClearance: 400,
    boundaryPadding: 25,
  });

  const normalDistance = Math.abs(normal.towers[1].x - normal.towers[0].x);
  const expandedDistance = Math.abs(expanded.towers[1].x - expanded.towers[0].x);
  assert.equal(normalDistance, 320);
  assert.equal(expandedDistance, 480);
  assert.ok(expanded.map_boundaries[1].x > normal.map_boundaries[1].x);
  assert.equal(expanded.spawn_protection_size, 300);
  assert.deepEqual(expanded.walls, [{ t1: 1, t2: 2, team_id: 0 }]);
});

test("Defly conversion rejects invalid live-control values", () => {
  assert.throws(() => convertDeflyMap(deflyText, { spacingPercent: 0 }), /Scale must be a positive number/);
  assert.throws(() => convertDeflyMap(deflyText, { unitSize: 0 }), /unit size must be a positive number/);
  assert.throws(() => convertDeflyMap(deflyText, { boundaryPadding: -1 }), /padding cannot be negative/);
});

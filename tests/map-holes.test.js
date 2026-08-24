const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const geometry = require("../map-hole-geometry.js");

function createElement(overrides = {}) {
  return {
    value: "",
    checked: false,
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

function loadEditor(canvasContext = {}) {
  const elements = new Map();
  const canvas = createElement({
    getContext() { return canvasContext; },
  });
  elements.set("mapCanvas", canvas);
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
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInContext(source, context, { filename: "app.js" });
  return context.CosmowarEditorTestApi;
}

function baseMap(overrides = {}) {
  return {
    spawn_protection_size: 200,
    map_boundaries: [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ],
    spawn_points: [
      { team_id: 0, x: 300, y: 300 },
      { team_id: 1, x: 3700, y: 2700 },
    ],
    bomb_sites: [],
    towers: [],
    walls: [],
    ...overrides,
  };
}

const squareHole = [
  { x: 1000, y: 1000 },
  { x: 1400, y: 1000 },
  { x: 1400, y: 1400 },
  { x: 1000, y: 1400 },
];

test("legacy maps import with an empty hole collection and export without map_holes", () => {
  const editor = loadEditor();
  const imported = editor.importState(baseMap({ custom_registry_note: "legacy" }));
  assert.deepEqual(imported.map_holes, []);
  const payload = editor.exportState();
  assert.equal(Object.hasOwn(payload, "map_holes"), false);
  assert.equal(Object.hasOwn(payload, "custom_registry_note"), false, "unknown fields retain the editor's existing non-preserving behavior");
  assert.equal(JSON.stringify(payload.map_boundaries), JSON.stringify(baseMap().map_boundaries));
});

test("one or multiple holes import and export as nested coordinate arrays without editor metadata", () => {
  const editor = loadEditor();
  const secondHole = squareHole.map((point) => ({ x: point.x + 1200, y: point.y + 200 }));
  const imported = editor.importState(baseMap({ map_holes: [squareHole, secondHole] }));
  assert.equal(imported.map_holes.length, 2);
  assert.match(imported.map_holes[0].uid, /^hole_/);
  assert.match(imported.map_holes[0].points[0].uid, /^hole_vertex_/);
  const payload = editor.exportState();
  assert.deepEqual(payload.map_holes, [squareHole, secondHole]);
  assert.deepEqual(Object.keys(payload.map_holes[0][0]).sort(), ["x", "y"]);
});

test("malformed map_holes input fails safely with actionable paths", () => {
  const editor = loadEditor();
  assert.throws(() => editor.importState(baseMap({ map_holes: {} })), /map_holes must be an array/);
  assert.throws(() => editor.importState(baseMap({ map_holes: ["bad"] })), /map_holes\[0\] must be an array of points/);
  assert.throws(() => editor.importState(baseMap({ map_holes: [[{ x: "nope", y: 1 }]] })), /map_holes\[0\]\[0\]\.x must be a number/);
});

test("hole creation, vertex editing, whole-hole movement, deletion, undo, and redo use snapshot history", () => {
  const editor = loadEditor();
  editor.importState(baseMap());
  editor.createHole(squareHole);
  assert.equal(editor.getState().map_holes.length, 1);

  editor.undo();
  assert.equal(editor.getState().map_holes.length, 0);
  editor.redo();
  assert.equal(editor.getState().map_holes.length, 1);

  editor.moveHoleVertex(0, 0, 900, 1000);
  assert.equal(editor.getState().map_holes[0].points[0].x, 900);
  editor.undo();
  assert.equal(editor.getState().map_holes[0].points[0].x, 1000);
  editor.redo();
  assert.equal(editor.getState().map_holes[0].points[0].x, 900);

  editor.moveHole(0, 2000, 1600);
  const movedCenter = geometry.polygonOf(editor.getState().map_holes[0]).reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  assert.equal(movedCenter.x / 4, 2000);
  assert.equal(movedCenter.y / 4, 1600);

  editor.deleteHole(0);
  assert.equal(editor.getState().map_holes.length, 0);
  editor.undo();
  assert.equal(editor.getState().map_holes.length, 1);
  editor.redo();
  assert.equal(editor.getState().map_holes.length, 0);
});

test("a legal hole is accepted", () => {
  const editor = loadEditor();
  editor.importState(baseMap({ map_holes: [squareHole] }));
  assert.equal(editor.validationMessages().length, 0);
});

test("outside, boundary-touching, self-intersecting, zero-area, and incomplete holes are rejected", () => {
  const cases = [
    [[{ x: -1, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 300 }], /outside the boundary polygon/],
    [[{ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 300 }], /outside the boundary polygon/],
    [[{ x: 1000, y: 1000 }, { x: 1400, y: 1400 }, { x: 1000, y: 1400 }, { x: 1400, y: 1000 }], /self-intersecting/],
    [[{ x: 1000, y: 1000 }, { x: 1200, y: 1200 }, { x: 1400, y: 1400 }], /zero area/],
    [[{ x: 1000, y: 1000 }, { x: 1400, y: 1000 }], /at least 3 distinct valid points/],
  ];
  cases.forEach(([hole, expected]) => {
    const editor = loadEditor();
    editor.importState(baseMap({ map_holes: [hole] }));
    assert.match(editor.validationMessages().join("\n"), expected);
  });
});

test("overlapping and nested holes are rejected", () => {
  const overlapping = squareHole.map((point) => ({ x: point.x + 200, y: point.y + 100 }));
  const nested = [
    { x: 1100, y: 1100 }, { x: 1200, y: 1100 }, { x: 1200, y: 1200 }, { x: 1100, y: 1200 },
  ];
  for (const second of [overlapping, nested]) {
    const editor = loadEditor();
    editor.importState(baseMap({ map_holes: [squareHole, second] }));
    assert.match(editor.validationMessages().join("\n"), /Holes 0 and 1 overlap/);
  }
});

test("spawn and tower centres inside or on a hole are rejected", () => {
  const editor = loadEditor();
  editor.importState(baseMap({
    map_holes: [squareHole],
    spawn_points: [{ team_id: 0, x: 1000, y: 1200 }, { team_id: 1, x: 3700, y: 2700 }],
    towers: [{ id: 4, team_id: 0, x: 1200, y: 1200, health: 4, is_invincible: false }],
  }));
  const messages = editor.validationMessages().join("\n");
  assert.match(messages, /Spawn point 'team_0' is inside hole 0/);
  assert.match(messages, /Tower 'tower_4' is inside hole 0/);
  assert.equal(editor.isPlacementAllowed("spawn", 1200, 1200), false);
  assert.equal(editor.isPlacementAllowed("tower", 1000, 1200), false);
});

test("bomb-site regions inside or overlapping a hole are rejected", () => {
  const editor = loadEditor();
  editor.importState(baseMap({
    map_holes: [squareHole],
    bomb_sites: [{ site_letter: "A", x: 800, y: 1200 }],
  }));
  assert.match(editor.validationMessages().join("\n"), /Bomb site 'A' overlaps hole 0/);
  assert.equal(editor.isPlacementAllowed("bomb", 800, 1200), false);
});

test("sampled four-way connectivity rejects holes that split walkable samples", () => {
  const boundary = [
    { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 410 },
    { x: 2000, y: 410 }, { x: 2000, y: 0 }, { x: 3000, y: 0 },
    { x: 3000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 610 },
    { x: 1000, y: 610 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 },
  ];
  const blocker = [
    { x: 1100, y: 420 }, { x: 1900, y: 420 }, { x: 1900, y: 600 }, { x: 1100, y: 600 },
  ];
  assert.equal(geometry.holesDisconnectBoundary(boundary, [{ points: blocker }]), true);
  const issues = geometry.validateMapHoles({ map_boundaries: boundary, map_holes: [{ points: blocker }] });
  assert.equal(issues.at(-1).message, "Map holes split the playable area into disconnected regions.");
});

test("connectivity grid respects the 262,144-cell cap", () => {
  const grid = geometry.getConnectivityGrid([
    { x: 0, y: 0 }, { x: 1000000, y: 0 }, { x: 1000000, y: 1000000 }, { x: 0, y: 1000000 },
  ]);
  assert.ok(grid.columns * grid.rows <= geometry.MAX_CONNECTIVITY_CELLS);
  assert.ok(grid.cellSize > geometry.BASE_CONNECTIVITY_CELL_SIZE);
});

test("a wall may span a hole, and holes do not affect boundary framing", () => {
  const editor = loadEditor();
  const data = baseMap({
    map_holes: [squareHole],
    towers: [
      { id: 1, team_id: 0, x: 500, y: 1200, health: 4, is_invincible: false },
      { id: 2, team_id: 0, x: 1800, y: 1200, health: 4, is_invincible: false },
    ],
    walls: [{ t1: 1, t2: 2, team_id: 0 }],
  });
  editor.importState(data);
  assert.equal(editor.validationMessages().length, 0);
  const withHoleView = editor.fitView(1200, 800);

  editor.importState(baseMap());
  const legacyView = editor.fitView(1200, 800);
  assert.deepEqual(withHoleView, legacyView);
  assert.equal(editor.isPlacementAllowed("tower", 2000, 1500), true);
});

test("hole interiors use the same fog shade and rim as the outer boundary", () => {
  const fills = [];
  const strokes = [];
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    fill() { fills.push(this.fillStyle); },
    stroke() { strokes.push(this.strokeStyle); },
  };
  const editor = loadEditor(context);
  editor.importState(baseMap({ map_holes: [squareHole] }));
  editor.renderHoles();
  assert.equal(fills[0], "rgba(2, 6, 14, 0.62)");
  assert.equal(strokes[0], "#2E3842");
});

test("box selection selects hole vertices as a movable group", () => {
  const editor = loadEditor();
  editor.importState(baseMap({ map_holes: [squareHole] }));
  const selected = editor.boxSelect({ x: 900, y: 900 }, { x: 1500, y: 1500 });
  assert.equal(selected.length, 4);
  assert.ok(selected.every((key) => key.startsWith("holeVertex:")));

  editor.moveSelection(100, 50);
  assert.deepEqual(
    JSON.parse(JSON.stringify(editor.getState().map_holes[0].points.map(({ x, y }) => ({ x, y })))),
    squareHole.map((point) => ({ x: point.x + 100, y: point.y + 50 })),
  );
  editor.undo();
  assert.deepEqual(
    JSON.parse(JSON.stringify(editor.getState().map_holes[0].points.map(({ x, y }) => ({ x, y })))),
    squareHole,
  );
});

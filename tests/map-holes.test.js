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

test("boundary authoring inserts on an existing edge and uses the closest sensible edge for expansion", () => {
  const editor = loadEditor();
  editor.importState(baseMap());

  let result = editor.placeBoundaryVertex(4000, 1500);
  assert.equal(result.changed, true);
  assert.equal(result.state.map_boundaries.length, 5);
  assert.deepEqual(
    result.state.map_boundaries.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1500 },
      { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ],
  );

  editor.undo();
  result = editor.placeBoundaryVertex(2000, -500);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.state.map_boundaries.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 0 }, { x: 2000, y: -500 }, { x: 4000, y: 0 },
      { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ],
    "an off-edge point should connect to the nearest valid neighbouring vertices",
  );
});

test("hole authoring inserts a vertex between the clicked edge endpoints and supports undo", () => {
  const editor = loadEditor();
  editor.importState(baseMap({ map_holes: [squareHole] }));

  const result = editor.placeHoleVertex(1200, 1000);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.state.map_holes[0].points.map(({ x, y }) => ({ x, y })),
    [
      { x: 1000, y: 1000 }, { x: 1200, y: 1000 }, { x: 1400, y: 1000 },
      { x: 1400, y: 1400 }, { x: 1000, y: 1400 },
    ],
  );
  assert.equal(editor.validationMessages().some((message) => message.includes("Hole 0")), false);

  editor.undo();
  assert.equal(editor.getState().map_holes[0].points.length, 4);
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

test("the bundled showcase arena imports cleanly and keeps mirrored competitive geometry", () => {
  const editor = loadEditor();
  const showcase = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "showcase-balanced-arena.json"), "utf8"));
  editor.importState(showcase);
  assert.equal(editor.validationMessages().length, 0);
  assert.equal(showcase.map_boundaries.length, 12);
  assert.equal(showcase.map_holes.length, 5);
  assert.equal(showcase.walls.length, 14);

  const towersById = new Map(showcase.towers.map((tower) => [tower.id, tower]));
  for (let blueId = 1; blueId <= 8; blueId += 1) {
    const blue = towersById.get(blueId);
    const red = towersById.get(blueId + 8);
    assert.deepEqual({ x: red.x, y: red.y }, { x: -blue.x, y: blue.y });
  }
  assert.deepEqual(showcase.spawn_points[1], { team_id: 1, x: -showcase.spawn_points[0].x, y: showcase.spawn_points[0].y });
});

test("hole vertex selections mirror complete hole polygons and live edits update their counterpart", () => {
  const editor = loadEditor();
  editor.importState(baseMap({ map_holes: [squareHole] }));
  editor.setMirror([{ type: "reflect", a: { x: 2000, y: 0 }, b: { x: 2000, y: 3000 } }], true);
  editor.selectHoleVertices(0);
  editor.mirrorSelectionOnce();

  let holes = editor.getState().map_holes;
  assert.equal(holes.length, 2);
  assert.deepEqual(holes[1].points.map(({ x, y }) => ({ x, y })), [
    { x: 3000, y: 1000 }, { x: 2600, y: 1000 }, { x: 2600, y: 1400 }, { x: 3000, y: 1400 },
  ]);

  editor.moveHoleVertex(0, 0, 900, 1000);
  holes = editor.getState().map_holes;
  assert.equal(holes[1].points[0].x, 3100);
  assert.equal(holes[1].points[0].y, 1000);
});

test("an in-progress hole draft exposes live mirrored vertices and edges before completion", () => {
  const editor = loadEditor();
  editor.importState(baseMap());
  editor.setMirror([{ type: "reflect", a: { x: 0, y: -1000 }, b: { x: 0, y: 1000 } }], true);
  const previews = editor.setHoleDraftPreview(
    [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    { x: 200, y: 200, closing: false, invalid: false },
  );

  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].points.map(({ x, y }) => ({ x, y })), [
    { x: -100, y: 100 }, { x: -200, y: 100 }, { x: -200, y: 200 },
  ]);
  assert.equal(editor.getState().map_holes.length, 0, "the mirrored draft should be visible before either hole is committed");
});

test("live mirror movement previews the selected wall and suppresses stale counterpart towers and wall", () => {
  const editor = loadEditor();
  editor.importState({
    spawn_protection_size: 100,
    map_boundaries: [
      { x: -2000, y: -1500 }, { x: 2000, y: -1500 }, { x: 2000, y: 1500 }, { x: -2000, y: 1500 },
    ],
    spawn_points: [{ team_id: 0, x: -1600, y: 0 }, { team_id: 1, x: 1600, y: 0 }],
    bomb_sites: [],
    towers: [
      { id: 1, team_id: 0, health: 4, is_invincible: false, x: -1000, y: -300 },
      { id: 2, team_id: 0, health: 4, is_invincible: false, x: -1000, y: 300 },
      { id: 3, team_id: 0, health: 4, is_invincible: false, x: 1000, y: -300 },
      { id: 4, team_id: 0, health: 4, is_invincible: false, x: 1000, y: 300 },
    ],
    walls: [
      { id: 1, t1: 1, t2: 2, team_id: 0 },
      { id: 2, t1: 3, t2: 4, team_id: 0 },
    ],
  });
  const initial = editor.getState();
  editor.setMirror([{ type: "reflect", a: { x: 0, y: -1000 }, b: { x: 0, y: 1000 } }], true);
  editor.selectKeys([
    `tower:${initial.towers[0].uid}`,
    `tower:${initial.towers[1].uid}`,
    `wall:${initial.walls[0].uid}`,
  ]);
  const preview = editor.beginSelectionMove(100, 0);

  assert.ok(preview.sourceWallUids.includes(initial.walls[0].uid), "the wall between the moving towers must be included in the mirror ghost");
  assert.ok(preview.suppressedWallUids.includes(initial.walls[1].uid), "the old mirrored wall must be hidden during the drag");
  assert.ok(preview.suppressedKeys.includes(`tower:${initial.towers[2].uid}`));
  assert.ok(preview.suppressedKeys.includes(`tower:${initial.towers[3].uid}`));

  const committed = editor.finishSelectionMove();
  assert.equal(committed.towers[2].x, 900);
  assert.equal(committed.towers[3].x, 900);
  assert.equal(committed.walls.length, 2);
  assert.deepEqual([committed.walls[1].t1, committed.walls[1].t2], [3, 4]);
});

test("live mirror movement creates a missing counterpart wall with its new mirrored towers", () => {
  const editor = loadEditor();
  editor.importState({
    spawn_protection_size: 100,
    map_boundaries: [
      { x: -2000, y: -1500 }, { x: 2000, y: -1500 }, { x: 2000, y: 1500 }, { x: -2000, y: 1500 },
    ],
    spawn_points: [{ team_id: 0, x: -1600, y: 0 }, { team_id: 1, x: 1600, y: 0 }],
    bomb_sites: [],
    towers: [
      { id: 1, team_id: 0, health: 4, is_invincible: false, x: -1000, y: -300 },
      { id: 2, team_id: 0, health: 4, is_invincible: false, x: -1000, y: 300 },
    ],
    walls: [{ id: 1, t1: 1, t2: 2, team_id: 0 }],
  });
  const initial = editor.getState();
  editor.setMirror([{ type: "reflect", a: { x: 0, y: -1000 }, b: { x: 0, y: 1000 } }], true);
  editor.selectKeys([
    `tower:${initial.towers[0].uid}`,
    `tower:${initial.towers[1].uid}`,
    `wall:${initial.walls[0].uid}`,
  ]);
  editor.beginSelectionMove(100, 0);
  const committed = editor.finishSelectionMove();

  assert.equal(committed.towers.length, 4);
  assert.equal(committed.walls.length, 2, "the mirrored towers must remain connected after placement");
  const mirroredTowerIds = committed.towers.filter((tower) => tower.x === 900).map((tower) => tower.id).sort((a, b) => a - b);
  const mirroredWall = committed.walls.find((wall) => mirroredTowerIds.includes(wall.t1) && mirroredTowerIds.includes(wall.t2));
  assert.ok(mirroredWall, "a wall should connect the two newly created mirrored towers");
});

test("mirror-axis add, move, and removal participate in undo without entering object selection", () => {
  const editor = loadEditor();
  editor.importState(baseMap());
  const axis = { type: "reflect", a: { x: 1000, y: 0 }, b: { x: 1000, y: 3000 } };

  editor.addMirrorAxis(axis);
  assert.equal(editor.getMirrorAxes().length, 1);
  editor.undo();
  assert.equal(editor.getMirrorAxes().length, 0, "undo should remove a newly added mirror axis");
  editor.redo();
  assert.equal(editor.getMirrorAxes().length, 1);

  const selectedBeforeMove = editor.boxSelect({ x: -100, y: -100 }, { x: 4100, y: 3100 });
  editor.moveMirrorAxis(0, 240, -96);
  let moved = editor.getMirrorAxes()[0];
  assert.deepEqual(moved, { type: "reflect", a: { x: 1240, y: -96 }, b: { x: 1240, y: 2904 } });
  assert.equal(JSON.stringify(editor.getSelection()), JSON.stringify(selectedBeforeMove), "moving an axis must not alter map-object selection");
  editor.undo();
  assert.deepEqual(editor.getMirrorAxes()[0], axis, "undo should restore the mirror axis position");
  editor.redo();
  moved = editor.getMirrorAxes()[0];
  assert.equal(moved.a.x, 1240);

  assert.ok(selectedBeforeMove.length > 0);
  assert.ok(selectedBeforeMove.every((key) => !key.startsWith("mirror")), "mirror axes must remain outside map-object group selection");

  editor.removeLastMirrorAxis();
  assert.equal(editor.getMirrorAxes().length, 0);
  editor.undo();
  assert.equal(editor.getMirrorAxes().length, 1, "undo should restore a removed mirror axis");
});

test("Delete removes the selected mirror axis and the removal can be undone", () => {
  const editor = loadEditor();
  editor.importState(baseMap());
  const axis = { type: "reflect", a: { x: 1000, y: 0 }, b: { x: 1000, y: 3000 } };
  editor.addMirrorAxis(axis);

  assert.equal(editor.selectMirrorAxis(0), true);
  assert.equal(editor.getSelectedMirrorAxisIndex(), 0);
  const result = editor.pressKey("Delete");

  assert.equal(result.prevented, true);
  assert.equal(result.axes.length, 0, "Delete should remove the selected mirror axis");
  assert.equal(editor.getSelectedMirrorAxisIndex(), null);
  editor.undo();
  assert.deepEqual(editor.getMirrorAxes(), [axis], "undo should restore the keyboard-deleted mirror axis");
});

test("grid and view settings survive a restored session", () => {
  const editor = loadEditor();
  editor.importState(baseMap());
  editor.updateSettings({
    snapStrength: 73,
    objectSnapEnabled: false,
    buildModeSnapEnabled: false,
    gridSnapEnabled: false,
    gridSize: 72,
    gridLineWidth: 2.5,
    gridMajorVisible: false,
    originAxesVisible: false,
  });
  editor.setView({ scale: 0.7, offsetX: 321, offsetY: 123 });
  editor.updateSettings({ gridSize: 12, gridMajorVisible: true, originAxesVisible: true }, false);
  editor.setView({ scale: 1, offsetX: 0, offsetY: 0 }, false);

  const restored = editor.restoreSession();
  assert.equal(restored.settings.snapStrength, 73);
  assert.equal(restored.settings.gridSize, 72);
  assert.equal(restored.settings.gridLineWidth, 2.5);
  assert.equal(restored.settings.gridMajorVisible, false);
  assert.equal(restored.settings.originAxesVisible, false);
  assert.equal(JSON.stringify(restored.view), JSON.stringify({ scale: 0.7, offsetX: 321, offsetY: 123 }));

});

test("centering on 0,0 translates the complete authored map and supports undo", () => {
  const editor = loadEditor();
  editor.importState({
    spawn_protection_size: 100,
    map_boundaries: [
      { x: 100, y: 200 }, { x: 1100, y: 200 }, { x: 1100, y: 1000 }, { x: 100, y: 1000 },
    ],
    map_holes: [[
      { x: 450, y: 450 }, { x: 550, y: 450 }, { x: 550, y: 550 }, { x: 450, y: 550 },
    ]],
    spawn_points: [{ team_id: 0, x: 200, y: 300 }, { team_id: 1, x: 1000, y: 900 }],
    bomb_sites: [{ site_letter: "A", x: 800, y: 700 }],
    towers: [{ id: 1, team_id: 0, health: 4, is_invincible: false, x: 300, y: 400 }],
    walls: [],
    structures: [{ id: 1, x: 700, y: 500, size: 40, color: "#fff", team_id: -1 }],
  });
  const before = editor.getState();
  const centered = editor.centerMapOnOrigin(1000, 600);
  const state = centered.state;

  assert.equal(centered.changed, true);
  assert.deepEqual(state.map_boundaries.map(({ x, y }) => ({ x, y })), [
    { x: -500, y: -400 }, { x: 500, y: -400 }, { x: 500, y: 400 }, { x: -500, y: 400 },
  ]);
  assert.equal(state.map_holes[0].points[0].x, -150);
  assert.equal(state.map_holes[0].points[0].y, -150);
  assert.deepEqual(state.spawn_points.map(({ x, y }) => ({ x, y })), [{ x: -400, y: -300 }, { x: 400, y: 300 }]);
  assert.deepEqual({ x: state.bomb_sites[0].x, y: state.bomb_sites[0].y }, { x: 200, y: 100 });
  assert.deepEqual({ x: state.towers[0].x, y: state.towers[0].y }, { x: -300, y: -200 });
  assert.deepEqual({ x: state.structures[0].x, y: state.structures[0].y }, { x: 100, y: -100 });

  editor.undo();
  assert.equal(JSON.stringify(editor.getState()), JSON.stringify(before));
});

test("import centering places the map centre at 0,0 and preserves relative geometry", () => {
  const editor = loadEditor();
  const centered = editor.centerImportedState({
    spawn_protection_size: 100,
    map_boundaries: [
      { x: 100, y: 200 }, { x: 1100, y: 200 }, { x: 1100, y: 1000 }, { x: 100, y: 1000 },
    ],
    map_holes: [[
      { x: 450, y: 450 }, { x: 550, y: 450 }, { x: 550, y: 550 }, { x: 450, y: 550 },
    ]],
    spawn_points: [{ team_id: 0, x: 200, y: 300 }],
    bomb_sites: [{ site_letter: "A", x: 800, y: 700 }],
    towers: [
      { id: 1, team_id: 0, health: 4, is_invincible: false, x: 300, y: 400 },
      { id: 2, team_id: 0, health: 4, is_invincible: false, x: 500, y: 400 },
    ],
    walls: [{ id: 1, t1: 1, t2: 2, team_id: 0 }],
    structures: [{ id: 1, x: 700, y: 500, size: 40, color: "#fff", team_id: -1 }],
  });
  const state = centered.state;
  const xs = state.map_boundaries.map((point) => point.x);
  const ys = state.map_boundaries.map((point) => point.y);

  assert.equal(centered.changed, true);
  assert.equal((Math.min(...xs) + Math.max(...xs)) / 2, 0);
  assert.equal((Math.min(...ys) + Math.max(...ys)) / 2, 0);
  assert.deepEqual({ x: state.map_holes[0].points[0].x, y: state.map_holes[0].points[0].y }, { x: -150, y: -150 });
  assert.deepEqual({ x: state.spawn_points[0].x, y: state.spawn_points[0].y }, { x: -400, y: -300 });
  assert.deepEqual({ x: state.bomb_sites[0].x, y: state.bomb_sites[0].y }, { x: 200, y: 100 });
  assert.deepEqual(state.towers.map(({ x, y }) => ({ x, y })), [{ x: -300, y: -200 }, { x: -100, y: -200 }]);
  assert.deepEqual({ x: state.structures[0].x, y: state.structures[0].y }, { x: 100, y: -100 });
  assert.deepEqual({ t1: state.walls[0].t1, t2: state.walls[0].t2 }, { t1: 1, t2: 2 });
});

test("group snapping falls back to the legal pointer position instead of blocking movement", () => {
  const editor = loadEditor();
  editor.importState(baseMap({
    towers: [{ id: 1, team_id: 0, health: 4, is_invincible: false, x: 200, y: 1000 }],
  }));
  const tower = editor.getState().towers[0];
  editor.selectKeys([`tower:${tower.uid}`]);
  editor.updateSettings({ snapStrength: 50, objectSnapEnabled: true, gridSnapEnabled: false }, false);
  editor.moveSelectionSnapped(-160, 0);
  assert.equal(editor.getState().towers[0].x, 40, "invalid snap to x=0 should fall back to the legal raw target");
});

test("a snapped whole-map selection is validated against its moving boundary and holes", () => {
  const editor = loadEditor();
  editor.importState(baseMap({
    map_holes: [squareHole],
    towers: [
      { id: 1, team_id: 0, health: 4, is_invincible: false, x: 500, y: 1500 },
      { id: 2, team_id: 1, health: 4, is_invincible: false, x: 3500, y: 1500 },
    ],
    walls: [{ id: 1, t1: 1, t2: 2, team_id: -1 }],
  }));
  const selected = editor.boxSelect({ x: -100, y: -100 }, { x: 4100, y: 3100 });
  assert.ok(selected.length >= 12, "the boundary, hole vertices, entities, towers, and wall should all be selected");
  editor.updateSettings({ objectSnapEnabled: true, gridSnapEnabled: true, gridSize: 48 }, false);
  editor.moveSelectionSnapped(480, 480);
  const moved = editor.getState();

  assert.deepEqual(moved.map_boundaries.map(({ x, y }) => ({ x, y })), [
    { x: 480, y: 480 }, { x: 4480, y: 480 }, { x: 4480, y: 3480 }, { x: 480, y: 3480 },
  ]);
  assert.deepEqual(
    moved.map_holes[0].points.map(({ x, y }) => ({ x, y })),
    squareHole.map(({ x, y }) => ({ x: x + 480, y: y + 480 })),
  );
  assert.deepEqual(moved.spawn_points.map(({ x, y }) => ({ x, y })), [
    { x: 780, y: 780 }, { x: 4180, y: 3180 },
  ]);
  assert.deepEqual(moved.towers.map(({ x, y }) => ({ x, y })), [
    { x: 980, y: 1980 }, { x: 3980, y: 1980 },
  ]);
});

test("side resize handles scale hole vertex groups horizontally and vertically", () => {
  const editor = loadEditor();
  editor.importState(baseMap({ map_holes: [squareHole] }));
  editor.updateSettings({ gridSnapEnabled: false }, false);
  editor.selectHoleVertices(0);
  editor.resizeSelection("e", { x: 1800, y: 1200 });
  let points = editor.getState().map_holes[0].points;
  assert.deepEqual(points.map((point) => point.x), [1000, 1800, 1800, 1000]);
  assert.deepEqual(points.map((point) => point.y), [1000, 1000, 1400, 1400]);

  editor.importState(baseMap({ map_holes: [squareHole] }));
  editor.updateSettings({ gridSnapEnabled: false }, false);
  editor.selectHoleVertices(0);
  editor.resizeSelection("s", { x: 1200, y: 1800 });
  points = editor.getState().map_holes[0].points;
  assert.deepEqual(points.map((point) => point.x), [1000, 1400, 1400, 1000]);
  assert.deepEqual(points.map((point) => point.y), [1000, 1000, 1800, 1800]);
});

test("matching selection uses exact type, colour, health, and invincibility", () => {
  const editor = loadEditor();
  editor.importState(baseMap({
    towers: [
      { id: 1, team_id: 0, health: 4, is_invincible: false, x: 500, y: 500 },
      { id: 2, team_id: 0, health: 4, is_invincible: false, x: 700, y: 500 },
      { id: 3, team_id: 1, health: 4, is_invincible: false, x: 900, y: 500 },
      { id: 4, team_id: 0, health: 3, is_invincible: false, x: 1100, y: 500 },
      { id: 5, team_id: 0, health: 4, is_invincible: true, x: 1300, y: 500 },
    ],
  }));
  const towers = editor.getState().towers;
  const selected = editor.selectMatching(`tower:${towers[0].uid}`);
  assert.equal(selected.length, 2);
  assert.ok(selected.includes(`tower:${towers[1].uid}`));
});

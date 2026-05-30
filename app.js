
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

const GAME = {
  SNAP_THRESHOLD: 20,
  WALL_MAX_LENGTH: 1800,
  WALL_THICKNESS: 32,
  TOWER_DIAMETER: 88,
  SPAWN_SIZE: 100,
  BOMB_DIAMETER: 500,
  MIN_ZOOM: 0.08,
  MAX_ZOOM: 4,
};

const COLORS = {
  bg: "#0D0F17",
  terrain: "#0D0F17",
  gridMinor: "#2E3842",
  gridMajor: "#2E3842",
  boundary: "#2E3842",
  blue: "#3D5DFF",
  red: "#FF3D3D",
  neutral: "#667380",
  guide: "#FFE08A",
  warn: "#FFC857",
  danger: "#FF6B6B",
  concrete: "#6A7D98",
};

const TEAM_COLORS = { "-1": COLORS.neutral, "0": COLORS.blue, "1": COLORS.red };
const TEAM_LABELS = { "-1": "Neutral", "0": "Team Blue", "1": "Team Red" };

const el = {
  toolButtons: Array.from(document.querySelectorAll(".tool-button")),
  teamSwatches: Array.from(document.querySelectorAll(".team-swatch")),
  selectionPanel: document.getElementById("selectionPanel"),
  settingsToggleBtn: document.getElementById("settingsToggleBtn"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  spawnProtectionInput: document.getElementById("spawnProtectionInput"),
  snapStrengthInput: document.getElementById("snapStrengthInput"),
  towerHealthInput: document.getElementById("towerHealthInput"),
  towerInvincibleInput: document.getElementById("towerInvincibleInput"),
  actionState: document.getElementById("actionState"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFileInput: document.getElementById("importFileInput"),
};

let uidSeed = 1000;
let towerIdSeed = 1;
let wallLocalIdSeed = 1;
let structureIdSeed = 1;
let needsRender = true;
let actionTimer = null;

let state = createInitialState();
const selection = new Set();
const history = { undo: [], redo: [], limit: 220 };

const defaults = {
  defaultTeam: 0,
  towerHealth: 5,
  towerInvincible: false,
};

const editorSettings = {
  snapStrength: GAME.SNAP_THRESHOLD,
};

const view = { scale: 0.32, offsetX: 130, offsetY: 80 };
const viewport = { width: 1, height: 1, dpr: 1 };

const interaction = {
  mode: "select",
  mouseScreen: { x: 0, y: 0 },
  mouseWorld: { x: 0, y: 0 },
  isPanning: false,
  panStartMouse: null,
  panStartOffset: null,
  drag: null,
  boxSelect: null,
  wallDraft: null,
  hoverTowerId: null,
  towerChainLastId: null,
  snapEnabled: true,
  guides: { x: null, y: null, xPoints: [], yPoints: [] },
};

setup();

function setup() {
  hydrateCountersFromState();
  bindUI();
  updateTeamSwatches();
  el.snapStrengthInput.value = String(editorSettings.snapStrength);
  el.towerHealthInput.max = "5";
  resizeCanvas();
  setMode("select");
  renderSelectionPanel();
  setActionState("Idle", "idle");
  requestRender();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(frame);
}

function frame() {
  if (needsRender) {
    draw();
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

function requestRender() {
  needsRender = true;
}

function bindUI() {
  el.toolButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.tool)));
  el.spawnProtectionInput.addEventListener("change", onGlobalSpawnProtectionChange);

  el.teamSwatches.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      defaults.defaultTeam = parseInt(swatch.dataset.team, 10);
      updateTeamSwatches();
      setActionState(`Default color: ${TEAM_LABELS[String(defaults.defaultTeam)]}`, "success", true);
    });
  });

  el.towerHealthInput.addEventListener("change", () => {
    const v = Math.round(Number(el.towerHealthInput.value));
    if (Number.isFinite(v)) {
      defaults.towerHealth = clamp(1, v, 5);
      el.towerHealthInput.value = String(defaults.towerHealth);
    }
  });
  el.towerInvincibleInput.addEventListener("change", () => { defaults.towerInvincible = el.towerInvincibleInput.checked; });

  el.snapStrengthInput.addEventListener("change", () => {
    const v = Math.round(Number(el.snapStrengthInput.value));
    if (!Number.isFinite(v)) {
      el.snapStrengthInput.value = String(editorSettings.snapStrength);
      return;
    }
    editorSettings.snapStrength = clamp(1, v, 500);
    el.snapStrengthInput.value = String(editorSettings.snapStrength);
    setActionState(`Object snapping strength: ${editorSettings.snapStrength}`, "success", true);
  });

  el.settingsToggleBtn.addEventListener("click", () => {
    setSettingsOpen(el.settingsPanel.classList.contains("hidden"));
  });
  el.settingsCloseBtn.addEventListener("click", () => setSettingsOpen(false));

  el.exportBtn.addEventListener("click", exportJSON);
  el.importBtn.addEventListener("click", () => el.importFileInput.click());
  el.importFileInput.addEventListener("change", importJSON);

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onDocumentMouseDown);
}

function updateTeamSwatches() {
  el.teamSwatches.forEach((swatch) => {
    const swatchTeam = parseInt(swatch.dataset.team, 10);
    swatch.classList.toggle("active", swatchTeam === defaults.defaultTeam);
  });
}

function setSettingsOpen(open) {
  el.settingsPanel.classList.toggle("hidden", !open);
}

function onDocumentMouseDown(event) {
  if (el.settingsPanel.classList.contains("hidden")) return;
  const target = event.target;
  if (el.settingsPanel.contains(target) || el.settingsToggleBtn.contains(target)) return;
  setSettingsOpen(false);
}

function onGlobalSpawnProtectionChange() {
  const value = Number(el.spawnProtectionInput.value);
  if (!Number.isFinite(value)) {
    el.spawnProtectionInput.value = String(state.spawn_protection_size);
    return;
  }
  withAction("UPDATE_GLOBAL", () => {
    state.spawn_protection_size = value;
    return true;
  });
  setActionState(`spawn_protection_size = ${value}`, "success", true);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  viewport.width = Math.max(1, Math.floor(rect.width));
  viewport.height = Math.max(1, Math.floor(rect.height));
  viewport.dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * viewport.dpr);
  canvas.height = Math.floor(viewport.height * viewport.dpr);
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  requestRender();
}

function setMode(mode) {
  interaction.mode = mode;
  interaction.drag = null;
  interaction.boxSelect = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  if (mode !== "wall") {
    interaction.wallDraft = null;
    interaction.hoverTowerId = null;
  }
  updateToolButtons();
  updateCursor();
  setActionState(`Tool: ${toolLabel(mode)}`, "idle", true);
  requestRender();
}

function toolLabel(mode) {
  if (mode === "select") return "Select / Move";
  if (mode === "boundary") return "Draw Boundary";
  if (mode === "spawn") return "Place Spawn";
  if (mode === "bomb") return "Place Bomb Site";
  if (mode === "tower") return "Place Tower";
  if (mode === "wall") return "Connect Walls";
  return mode;
}

function updateToolButtons() {
  el.toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === interaction.mode));
}

function updateCursor() {
  if (interaction.isPanning) {
    canvas.style.cursor = "grabbing";
    return;
  }
  if (interaction.mode === "select") {
    canvas.style.cursor = interaction.drag ? "grabbing" : "default";
    return;
  }
  canvas.style.cursor = "crosshair";
}

function onMouseDown(event) {
  updateMousePosition(event);

  if (isPanTrigger(event)) {
    interaction.isPanning = true;
    interaction.panStartMouse = { ...interaction.mouseScreen };
    interaction.panStartOffset = { x: view.offsetX, y: view.offsetY };
    updateCursor();
    return;
  }
  if (event.button !== 0) return;

  const world = interaction.mouseWorld;
  if (interaction.mode === "select") {
    handleSelectDown(event, world);
    return;
  }
  if (interaction.mode === "boundary") {
    withAction("ADD_BOUNDARY_POINT", () => {
      state.map_boundaries.push({ uid: createUid("boundary"), x: roundTo(world.x, 3), y: roundTo(world.y, 3) });
      return true;
    });
    setActionState("Boundary vertex added", "success", true);
    return;
  }
  if (interaction.mode === "spawn") {
    placeSpawn(world);
    return;
  }
  if (interaction.mode === "bomb") {
    placeBomb(world);
    return;
  }
  if (interaction.mode === "tower") {
    placeTower(world);
    return;
  }
  if (interaction.mode === "wall") {
    handleWallToolClick(world);
  }
}

function onMouseMove(event) {
  updateMousePosition(event);
  const world = interaction.mouseWorld;

  if (interaction.isPanning && interaction.panStartMouse && interaction.panStartOffset) {
    const dx = interaction.mouseScreen.x - interaction.panStartMouse.x;
    const dy = interaction.mouseScreen.y - interaction.panStartMouse.y;
    view.offsetX = interaction.panStartOffset.x + dx;
    view.offsetY = interaction.panStartOffset.y + dy;
    requestRender();
    return;
  }
  if (interaction.boxSelect) {
    interaction.boxSelect.end = { ...world };
    requestRender();
    return;
  }
  if (interaction.drag) {
    applyDrag(world);
    requestRender();
  }
  if (interaction.wallDraft) {
    interaction.wallDraft.mouse = { ...world };
    const hover = hitTower(world);
    interaction.hoverTowerId = hover ? hover.id : null;
    requestRender();
  }
  if (interaction.mode === "tower" && interaction.towerChainLastId != null) {
    const hover = hitTower(world);
    interaction.hoverTowerId = hover ? hover.id : null;
    requestRender();
  }

  if (interaction.mode === "tower" && interaction.towerChainLastId != null && !interaction.drag && !interaction.boxSelect) {
    requestRender();
  }
}

function onMouseUp() {
  interaction.isPanning = false;
  interaction.panStartMouse = null;
  interaction.panStartOffset = null;

  if (interaction.boxSelect) finishBoxSelection();
  if (interaction.drag) finishDrag();

  updateCursor();
  requestRender();
}

function onWheel(event) {
  event.preventDefault();
  updateMousePosition(event);
  const before = screenToWorld(interaction.mouseScreen.x, interaction.mouseScreen.y);
  const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
  const nextScale = clamp(GAME.MIN_ZOOM, view.scale * zoomFactor, GAME.MAX_ZOOM);
  view.scale = nextScale;
  const after = screenToWorld(interaction.mouseScreen.x, interaction.mouseScreen.y);
  view.offsetX += (after.x - before.x) * view.scale;
  view.offsetY += (after.y - before.y) * view.scale;
  requestRender();
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (mod && !event.shiftKey && key === "z") {
    event.preventDefault();
    undoAction();
    return;
  }
  if ((mod && key === "y") || (mod && event.shiftKey && key === "z")) {
    event.preventDefault();
    redoAction();
    return;
  }
  if (key === "escape") {
    interaction.wallDraft = null;
    interaction.hoverTowerId = null;
    interaction.towerChainLastId = null;
    interaction.boxSelect = null;
    interaction.drag = null;
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
    setActionState("Draft actions cancelled", "idle", true);
    requestRender();
    return;
  }
  if ((key === "delete" || key === "backspace") && !isTypingInFormControl()) {
    event.preventDefault();
    deleteSelected();
  }
}

function isTypingInFormControl() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function isPanTrigger(event) {
  return event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey && interaction.mode !== "select");
}

function updateMousePosition(event) {
  const rect = canvas.getBoundingClientRect();
  interaction.mouseScreen.x = event.clientX - rect.left;
  interaction.mouseScreen.y = event.clientY - rect.top;
  interaction.mouseWorld = screenToWorld(interaction.mouseScreen.x, interaction.mouseScreen.y);
}

function screenToWorld(screenX, screenY) {
  return { x: (screenX - view.offsetX) / view.scale, y: (screenY - view.offsetY) / view.scale };
}

function worldToScreen(worldX, worldY) {
  return { x: worldX * view.scale + view.offsetX, y: worldY * view.scale + view.offsetY };
}

function handleSelectDown(event, world) {
  const hit = hitTest(world);
  const multiModifier = event.shiftKey || event.ctrlKey || event.metaKey;
  if (!hit) {
    if (selection.size === 0) {
      interaction.boxSelect = { start: { ...world }, end: { ...world } };
      setActionState("Drag to create selection box", "idle");
      requestRender();
      return;
    }
    if (!multiModifier) clearSelection();
    return;
  }
  const key = hit.key;
  if (multiModifier) {
    if (selection.has(key)) selection.delete(key);
    else selection.add(key);
    renderSelectionPanel();
    requestRender();
    return;
  }
  if (!selection.has(key)) {
    selection.clear();
    selection.add(key);
    renderSelectionPanel();
  }
  if (!hit.movable) {
    requestRender();
    return;
  }
  const movable = getMovableSelectionKeys();
  startDrag(movable.length > 0 ? movable : [key], key, world);
}

function getMovableSelectionKeys() {
  return getSelectionEntries().filter((entry) => entry.movable).map((entry) => entry.key);
}

function startDrag(keysToDrag, primaryKey, world) {
  const startPositions = new Map();
  keysToDrag.forEach((key) => {
    const p = getKeyPosition(key);
    if (p) startPositions.set(key, p);
  });
  if (!startPositions.has(primaryKey)) return;
  interaction.drag = {
    keys: keysToDrag,
    primaryKey,
    startMouse: { ...world },
    startPositions,
    beforeState: cloneState(state),
    moved: false,
  };
  updateCursor();
}

function applyDrag(world) {
  const drag = interaction.drag;
  if (!drag) return;
  const anchorStart = drag.startPositions.get(drag.primaryKey);
  if (!anchorStart) return;

  const rawDx = world.x - drag.startMouse.x;
  const rawDy = world.y - drag.startMouse.y;
  const targetX = anchorStart.x + rawDx;
  const targetY = anchorStart.y + rawDy;
  const snap = interaction.snapEnabled
    ? getSnapResult(targetX, targetY, new Set(drag.keys))
    : { x: targetX, y: targetY, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  let dx = snap.x - anchorStart.x;
  let dy = snap.y - anchorStart.y;
  const clipped = constrainDeltaByWallLimit(dx, dy, drag);
  dx = clipped.dx;
  dy = clipped.dy;

  const willExitBoundary = Array.from(drag.startPositions.entries()).some(([key, pos]) => {
    const entry = resolveKey(key);
    if (!entry) return false;
    if (entry.type === "boundary") return false;
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    return !isPlacementInsideBoundary(entry.type, nx, ny, entry.item);
  });

  if (willExitBoundary) {
    setActionState("Cannot move objects outside map boundary.", "warn");
    return;
  }

  drag.startPositions.forEach((pos, key) => setKeyPosition(key, roundTo(pos.x + dx, 3), roundTo(pos.y + dy, 3)));
  interaction.guides = { x: snap.guideX, y: snap.guideY, xPoints: snap.xPoints, yPoints: snap.yPoints };
  drag.moved = Math.hypot(dx, dy) > 0.001;
  updateLiveSelectionCoordinates();
  if (clipped.clipped) setActionState(`Wall span clipped at ${GAME.WALL_MAX_LENGTH}`, "warn");
}

function constrainDeltaByWallLimit(dx, dy, drag) {
  const movedTowerIds = new Set();
  drag.keys.forEach((key) => {
    const entry = resolveKey(key);
    if (entry && entry.type === "tower") movedTowerIds.add(entry.item.id);
  });
  if (movedTowerIds.size === 0) return { dx, dy, clipped: false };

  const test = (scale) => {
    for (const wall of state.walls) {
      const ta = getTowerById(wall.t1);
      const tb = getTowerById(wall.t2);
      if (!ta || !tb) continue;
      const pa = movedTowerIds.has(ta.id) ? getDraggedTowerPos(ta, drag, dx, dy, scale) : { x: ta.x, y: ta.y };
      const pb = movedTowerIds.has(tb.id) ? getDraggedTowerPos(tb, drag, dx, dy, scale) : { x: tb.x, y: tb.y };
      if (distance(pa.x, pa.y, pb.x, pb.y) > GAME.WALL_MAX_LENGTH + 0.0001) return false;
    }
    return true;
  };

  if (test(1)) return { dx, dy, clipped: false };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  return { dx: dx * lo, dy: dy * lo, clipped: true };
}

function getDraggedTowerPos(tower, drag, dx, dy, scale) {
  const key = makeKey("tower", tower.uid);
  const start = drag.startPositions.get(key);
  if (!start) return { x: tower.x, y: tower.y };
  return { x: start.x + dx * scale, y: start.y + dy * scale };
}

function finishDrag() {
  const drag = interaction.drag;
  interaction.drag = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  updateCursor();
  if (!drag || !drag.moved) return;
  pushHistory("MOVE_MULTI", drag.beforeState, cloneState(state));
  renderSelectionPanel();
}

function finishBoxSelection() {
  const box = interaction.boxSelect;
  interaction.boxSelect = null;
  if (!box) return;
  const minX = Math.min(box.start.x, box.end.x);
  const maxX = Math.max(box.start.x, box.end.x);
  const minY = Math.min(box.start.y, box.end.y);
  const maxY = Math.max(box.start.y, box.end.y);
  selection.clear();
  getSelectableEntries().forEach((entry) => {
    const c = getEntryCenter(entry);
    if (!c) return;
    if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) selection.add(entry.key);
  });
  renderSelectionPanel();
  setActionState(selection.size ? `Selected ${selection.size} item(s)` : "Selection box found no entities", selection.size ? "success" : "idle", true);
}

function placeSpawn(world) {
  if (!isPlacementInsideBoundary("spawn", world.x, world.y)) {
    setActionState("Cannot place spawn outside map boundary.", "warn", true);
    return;
  }
  if (defaults.defaultTeam !== 0 && defaults.defaultTeam !== 1) {
    setActionState("Spawn team 'None' is not exportable", "warn", true);
    return;
  }
  withAction("PLACE_SPAWN", () => {
    const existing = state.spawn_points.find((point) => point.team_id === defaults.defaultTeam);
    if (existing) {
      existing.x = roundTo(world.x, 3);
      existing.y = roundTo(world.y, 3);
      selection.clear();
      selection.add(makeKey("spawn", existing.uid));
      return true;
    }
    const spawn = { uid: createUid("spawn"), team_id: defaults.defaultTeam, x: roundTo(world.x, 3), y: roundTo(world.y, 3) };
    state.spawn_points.push(spawn);
    selection.clear();
    selection.add(makeKey("spawn", spawn.uid));
    return true;
  });
  renderSelectionPanel();
  setActionState(`Spawn for ${TEAM_LABELS[String(defaults.defaultTeam)]} set`, "success", true);
}

function placeBomb(world) {
  if (!isPlacementInsideBoundary("bomb", world.x, world.y)) {
    setActionState("Cannot place bomb site outside map boundary.", "warn", true);
    return;
  }
  withAction("PLACE_BOMB", () => {
    const site = { uid: createUid("bomb"), site_letter: nextBombSiteLetter(), x: roundTo(world.x, 3), y: roundTo(world.y, 3) };
    state.bomb_sites.push(site);
    selection.clear();
    selection.add(makeKey("bomb", site.uid));
    return true;
  });
  renderSelectionPanel();
  setActionState("Bomb site placed", "success", true);
}

function placeTower(world) {
  if (!isPlacementInsideBoundary("tower", world.x, world.y)) {
    setActionState("Cannot place tower outside map boundary.", "warn", true);
    return;
  }
  withAction("PLACE_TOWER", () => {
    let x = roundTo(world.x, 3);
    let y = roundTo(world.y, 3);
    let clipped = false;
    const prev = interaction.towerChainLastId != null ? getTowerById(interaction.towerChainLastId) : null;
    if (prev) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dist = Math.hypot(dx, dy);
      if (dist > GAME.WALL_MAX_LENGTH) {
        const ratio = GAME.WALL_MAX_LENGTH / dist;
        x = roundTo(prev.x + dx * ratio, 3);
        y = roundTo(prev.y + dy * ratio, 3);
        clipped = true;
      }
    }
    if (!isPlacementInsideBoundary("tower", x, y)) {
      setActionState("Cannot place tower outside map boundary.", "warn", true);
      return false;
    }
    const tower = {
      uid: createUid("tower"),
      id: nextTowerId(),
      team_id: defaults.defaultTeam,
      x,
      y,
      health: clamp(1, Math.round(defaults.towerHealth), 5),
      is_invincible: defaults.towerInvincible,
    };
    state.towers.push(tower);
    if (prev && !hasDuplicateWall(prev.id, tower.id)) {
      const length = distance(prev.x, prev.y, tower.x, tower.y);
      if (length <= GAME.WALL_MAX_LENGTH + 0.0001) {
        state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: prev.id, t2: tower.id, team_id: defaults.defaultTeam });
      }
    }
    interaction.towerChainLastId = tower.id;
    selection.clear();
    selection.add(makeKey("tower", tower.uid));
    setActionState(clipped ? `Tower clipped to ${GAME.WALL_MAX_LENGTH}` : "Tower placed", clipped ? "warn" : "success", true);
    return true;
  });
  renderSelectionPanel();
}

function handleWallToolClick(world) {
  const hit = hitTower(world);
  if (!interaction.wallDraft) {
    if (!hit) {
      setActionState("Select a tower to start wall", "idle", true);
      return;
    }
    interaction.wallDraft = { startTowerId: hit.id, startTowerUid: hit.uid, mouse: { ...world } };
    interaction.hoverTowerId = hit.id;
    selection.clear();
    selection.add(makeKey("tower", hit.uid));
    renderSelectionPanel();
    setActionState("Wall draft started", "idle");
    requestRender();
    return;
  }
  if (!hit) {
    interaction.wallDraft = null;
    interaction.hoverTowerId = null;
    setActionState("Wall draft cancelled", "idle", true);
    requestRender();
    return;
  }
  const startId = interaction.wallDraft.startTowerId;
  const endId = hit.id;
  if (startId === endId) {
    alert("A tower cannot connect to itself.");
    return;
  }
  if (hasDuplicateWall(startId, endId)) {
    alert("This wall already exists.");
    return;
  }
  const a = getTowerById(startId);
  const b = getTowerById(endId);
  if (!a || !b) return;
  const length = distance(a.x, a.y, b.x, b.y);
  if (length > GAME.WALL_MAX_LENGTH) {
    setActionState(`Wall too long (${Math.round(length)}), max ${GAME.WALL_MAX_LENGTH}`, "error", true);
    return;
  }
  withAction("CREATE_WALL", () => {
    state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: startId, t2: endId, team_id: defaults.defaultTeam });
    selection.clear();
    selection.add(makeKey("wall", state.walls[state.walls.length - 1].uid));
    return true;
  });
  interaction.wallDraft = null;
  interaction.hoverTowerId = null;
  renderSelectionPanel();
  setActionState(`Wall created (${Math.round(length)} units)`, "success", true);
}

function getSnapResult(targetX, targetY, excludeKeys) {
  const candidates = getGuideCandidates(excludeKeys);
  const threshold = editorSettings.snapStrength / Math.max(view.scale, 0.0001);
  let bestX = null;
  let bestY = null;
  candidates.forEach((c) => {
    const dx = Math.abs(c.x - targetX);
    const dy = Math.abs(c.y - targetY);
    if (dx <= threshold && (!bestX || dx < bestX.delta)) bestX = { value: c.x, delta: dx };
    if (dy <= threshold && (!bestY || dy < bestY.delta)) bestY = { value: c.y, delta: dy };
  });
  const x = bestX ? bestX.value : targetX;
  const y = bestY ? bestY.value : targetY;
  return {
    x,
    y,
    guideX: bestX ? x : null,
    guideY: bestY ? y : null,
    xPoints: bestX ? candidates.filter((c) => Math.abs(c.x - x) <= 0.001).slice(0, 30) : [],
    yPoints: bestY ? candidates.filter((c) => Math.abs(c.y - y) <= 0.001).slice(0, 30) : [],
  };
}

function getGuideCandidates(excludeKeys) {
  const list = [];
  state.map_boundaries.forEach((p) => { if (!excludeKeys.has(makeKey("boundary", p.uid))) list.push({ x: p.x, y: p.y }); });
  state.walls.forEach((w) => {
    if (excludeKeys.has(makeKey("wall", w.uid))) return;
    const a = getTowerById(w.t1);
    const b = getTowerById(w.t2);
    if (!a || !b) return;
    list.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
  state.towers.forEach((t) => { if (!excludeKeys.has(makeKey("tower", t.uid))) list.push({ x: t.x, y: t.y }); });
  state.spawn_points.forEach((s) => { if (!excludeKeys.has(makeKey("spawn", s.uid))) list.push({ x: s.x, y: s.y }); });
  state.bomb_sites.forEach((b) => { if (!excludeKeys.has(makeKey("bomb", b.uid))) list.push({ x: b.x, y: b.y }); });
  return list;
}

function clearSelection() {
  selection.clear();
  renderSelectionPanel();
  requestRender();
}

function selectionTypeRow(label) {
  return `<label class="field"><span>Object</span><span class="readonly-tag">${label}</span></label>`;
}

function teamSwatchMarkup(team, includeNeutral = true) {
  const options = includeNeutral ? [0, 1, -1] : [0, 1];
  return `
    <div class="team-swatches compact" data-team-swatch-group>
      ${options.map((option) => `
        <button
          type="button"
          class="team-swatch ${option === 0 ? "blue" : option === 1 ? "red" : "neutral"} ${team === option ? "active" : ""}"
          data-team-option="${option}"
        ></button>
      `).join("")}
    </div>
  `;
}

function bindTeamSwatchGroup(container, currentTeam, onChange) {
  const buttons = Array.from(container.querySelectorAll("[data-team-option]"));
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTeam = parseInt(button.dataset.teamOption, 10);
      if (nextTeam === currentTeam) return;
      onChange(nextTeam);
    });
  });
}

function snapToggleMarkup() {
  return `
    <label class="checkbox-field">
      <input id="selSnapEnabled" type="checkbox" ${interaction.snapEnabled ? "checked" : ""}>
      <span>Enable object snapping</span>
    </label>
  `;
}

function bindSnapToggle() {
  const toggle = document.getElementById("selSnapEnabled");
  if (!toggle) return;
  toggle.addEventListener("change", () => {
    interaction.snapEnabled = toggle.checked;
    setActionState(`Object snapping ${interaction.snapEnabled ? "enabled" : "disabled"}`, "success", true);
  });
}

function updateLiveSelectionCoordinates() {
  const entries = getSelectionEntries();
  if (entries.length !== 1) return;
  const entry = entries[0];
  if (!["tower", "spawn", "bomb", "boundary", "structure"].includes(entry.type)) return;
  const xInput = document.getElementById("selLiveX") || document.getElementById("selTowerX") || document.getElementById("selSpawnX") || document.getElementById("selBombX") || document.getElementById("selBoundaryX") || document.getElementById("selStructureX");
  const yInput = document.getElementById("selLiveY") || document.getElementById("selTowerY") || document.getElementById("selSpawnY") || document.getElementById("selBombY") || document.getElementById("selBoundaryY") || document.getElementById("selStructureY");
  if (xInput) xInput.value = String(roundTo(entry.item.x, 3));
  if (yInput) yInput.value = String(roundTo(entry.item.y, 3));
}

function renderSelectionPanel() {
  const entries = getSelectionEntries();
  if (entries.length === 0) {
    el.selectionPanel.innerHTML = `<p class="muted">No selection yet.</p>`;
    return;
  }
  if (entries.length > 1) {
    renderMultiSelection(entries);
    return;
  }
  const entry = entries[0];
  if (entry.type === "tower") renderTowerSelection(entry);
  else if (entry.type === "spawn") renderSpawnSelection(entry);
  else if (entry.type === "bomb") renderBombSelection(entry);
  else if (entry.type === "wall") renderWallSelection(entry);
  else if (entry.type === "boundary") renderBoundarySelection(entry);
  else if (entry.type === "structure") renderStructureSelection(entry);
}

function renderMultiSelection(entries) {
  const allTowers = entries.every((entry) => entry.type === "tower");
  const teamEditable = entries.filter((entry) => ["tower", "spawn", "wall", "structure"].includes(entry.type));
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Multi Selection")}
    <label class="field"><span>Selected Count</span><span class="readonly-tag">${entries.length}</span></label>
    <p class="muted" style="margin-bottom:8px;">Mass edit properties for selected entities.</p>
    ${teamEditable.length ? `
      <label class="field">
        <span>Apply team to compatible objects</span>
      </label>
      ${teamSwatchMarkup(0, true)}
      <button id="applyMultiTeam" class="action-button">Apply Team</button>
    ` : ""}
    ${allTowers ? `
      <label class="field">
        <span>Set health for selected towers</span>
        <input id="multiTowerHealth" type="number" step="1" min="1" max="5" value="5">
      </label>
      <label class="checkbox-field">
        <input id="multiTowerInvincible" type="checkbox">
        <span>Set is_invincible = true</span>
      </label>
      <button id="applyMultiTowerProps" class="action-button secondary">Apply Tower Properties</button>
    ` : ""}
    ${snapToggleMarkup()}
    <button id="deleteMultiBtn" class="danger-button">Delete Selection</button>
  `;
  bindSnapToggle();
  const applyTeam = document.getElementById("applyMultiTeam");
  if (applyTeam) {
    let selectedTeam = defaults.defaultTeam;
    el.selectionPanel.querySelectorAll("[data-team-option]").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.teamOption, 10) === selectedTeam);
    });
    bindTeamSwatchGroup(el.selectionPanel, selectedTeam, (nextTeam) => {
      selectedTeam = nextTeam;
      el.selectionPanel.querySelectorAll("[data-team-option]").forEach((btn) => {
        btn.classList.toggle("active", parseInt(btn.dataset.teamOption, 10) === selectedTeam);
      });
    });
    applyTeam.addEventListener("click", () => {
      withAction("MASS_TEAM_EDIT", () => {
        let changed = false;
        entries.forEach((entry) => {
          if (["tower", "spawn", "wall", "structure"].includes(entry.type) && entry.item.team_id !== selectedTeam) {
            entry.item.team_id = selectedTeam;
            changed = true;
          }
        });
        return changed;
      });
      setActionState(`Team updated for ${teamEditable.length} item(s)`, "success", true);
      renderSelectionPanel();
    });
  }
  const applyTower = document.getElementById("applyMultiTowerProps");
  if (applyTower) {
    applyTower.addEventListener("click", () => {
      const health = clamp(1, Math.round(Number(document.getElementById("multiTowerHealth").value)), 5);
      const inv = document.getElementById("multiTowerInvincible").checked;
      withAction("MASS_TOWER_EDIT", () => {
        let changed = false;
        entries.forEach((entry) => {
          if (entry.type === "tower" && (entry.item.health !== health || entry.item.is_invincible !== inv)) {
            entry.item.health = health;
            entry.item.is_invincible = inv;
            changed = true;
          }
        });
        return changed;
      });
      setActionState("Tower properties applied", "success", true);
      renderSelectionPanel();
    });
  }
  document.getElementById("deleteMultiBtn").addEventListener("click", deleteSelected);
}

function renderTowerSelection(entry) {
  const tower = entry.item;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Tower")}
    <label class="field"><span>Team</span></label>
    ${teamSwatchMarkup(tower.team_id, true)}
    <label class="field"><span>x</span><input id="selTowerX" type="number" step="0.1" value="${tower.x}"></label>
    <label class="field"><span>y</span><input id="selTowerY" type="number" step="0.1" value="${tower.y}"></label>
    <label class="field"><span>health</span><input id="selTowerHealth" type="number" step="1" max="5" min="1" value="${tower.health}"></label>
    <label class="checkbox-field"><input id="selTowerInv" type="checkbox" ${tower.is_invincible ? "checked" : ""}><span>is_invincible</span></label>
    ${snapToggleMarkup()}
    <button id="deleteTowerBtn" class="danger-button">Delete Tower</button>
  `;
  bindTeamSwatchGroup(el.selectionPanel, tower.team_id, (nextTeam) => withAction("EDIT_TOWER", () => { tower.team_id = nextTeam; return true; }));
  bindNumericChange("selTowerX", (v) => withAction("MOVE_TOWER", () => { tower.x = roundTo(v, 3); return true; }));
  bindNumericChange("selTowerY", (v) => withAction("MOVE_TOWER", () => { tower.y = roundTo(v, 3); return true; }));
  bindNumericChange("selTowerHealth", (v) => withAction("EDIT_TOWER", () => { tower.health = clamp(1, Math.round(v), 5); return true; }));
  document.getElementById("selTowerInv").addEventListener("change", (e) => withAction("EDIT_TOWER", () => { tower.is_invincible = e.target.checked; return true; }));
  bindSnapToggle();
  document.getElementById("deleteTowerBtn").addEventListener("click", deleteSelected);
}

function renderSpawnSelection(entry) {
  const spawn = entry.item;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Spawn")}
    <label class="field"><span>Team</span></label>
    ${teamSwatchMarkup(spawn.team_id, false)}
    <label class="field"><span>x</span><input id="selSpawnX" type="number" step="0.1" value="${spawn.x}"></label>
    <label class="field"><span>y</span><input id="selSpawnY" type="number" step="0.1" value="${spawn.y}"></label>
    ${snapToggleMarkup()}
    <button id="deleteSpawnBtn" class="danger-button">Delete Spawn</button>
  `;
  bindTeamSwatchGroup(el.selectionPanel, spawn.team_id, (nextTeam) => {
    const duplicate = state.spawn_points.find((p) => p.uid !== spawn.uid && p.team_id === nextTeam);
    if (duplicate) {
      alert(`Team ${nextTeam} already has a spawn point.`);
      renderSelectionPanel();
      return;
    }
    withAction("EDIT_SPAWN", () => { spawn.team_id = nextTeam; return true; });
  });
  bindNumericChange("selSpawnX", (v) => withAction("MOVE_SPAWN", () => { spawn.x = roundTo(v, 3); return true; }));
  bindNumericChange("selSpawnY", (v) => withAction("MOVE_SPAWN", () => { spawn.y = roundTo(v, 3); return true; }));
  bindSnapToggle();
  document.getElementById("deleteSpawnBtn").addEventListener("click", deleteSelected);
}

function renderBombSelection(entry) {
  const bomb = entry.item;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Bomb Site")}
    <label class="field"><span>site_letter</span><input id="selBombLetter" type="text" maxlength="3" value="${bomb.site_letter}"></label>
    <label class="field"><span>x</span><input id="selBombX" type="number" step="0.1" value="${bomb.x}"></label>
    <label class="field"><span>y</span><input id="selBombY" type="number" step="0.1" value="${bomb.y}"></label>
    ${snapToggleMarkup()}
    <button id="deleteBombBtn" class="danger-button">Delete Bomb Site</button>
  `;
  document.getElementById("selBombLetter").addEventListener("change", (e) => {
    const value = String(e.target.value || "").trim().toUpperCase();
    if (!value) { renderSelectionPanel(); return; }
    withAction("EDIT_BOMB", () => { bomb.site_letter = value; return true; });
    renderSelectionPanel();
  });
  bindNumericChange("selBombX", (v) => withAction("MOVE_BOMB", () => { bomb.x = roundTo(v, 3); return true; }));
  bindNumericChange("selBombY", (v) => withAction("MOVE_BOMB", () => { bomb.y = roundTo(v, 3); return true; }));
  bindSnapToggle();
  document.getElementById("deleteBombBtn").addEventListener("click", deleteSelected);
}

function renderWallSelection(entry) {
  const wall = entry.item;
  const a = getTowerById(wall.t1);
  const b = getTowerById(wall.t2);
  const length = a && b ? distance(a.x, a.y, b.x, b.y) : 0;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Wall")}
    <label class="field"><span>Wall</span><span class="readonly-tag">Connected Towers</span></label>
    <label class="field"><span>Length</span><span class="readonly-tag">${Math.round(length)} units</span></label>
    <label class="field"><span>Team</span></label>
    ${teamSwatchMarkup(wall.team_id, true)}
    ${snapToggleMarkup()}
    <button id="deleteWallBtn" class="danger-button">Delete Wall</button>
  `;
  bindTeamSwatchGroup(el.selectionPanel, wall.team_id, (nextTeam) => withAction("EDIT_WALL", () => { wall.team_id = nextTeam; return true; }));
  bindSnapToggle();
  document.getElementById("deleteWallBtn").addEventListener("click", deleteSelected);
}

function renderBoundarySelection(entry) {
  const point = entry.item;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Boundary Vertex")}
    <label class="field"><span>Boundary point</span><span class="readonly-tag">${point.uid}</span></label>
    <label class="field"><span>x</span><input id="selBoundaryX" type="number" step="0.1" value="${point.x}"></label>
    <label class="field"><span>y</span><input id="selBoundaryY" type="number" step="0.1" value="${point.y}"></label>
    ${snapToggleMarkup()}
    <button id="deleteBoundaryBtn" class="danger-button">Delete Vertex</button>
  `;
  bindNumericChange("selBoundaryX", (v) => withAction("MOVE_BOUNDARY", () => { point.x = roundTo(v, 3); return true; }));
  bindNumericChange("selBoundaryY", (v) => withAction("MOVE_BOUNDARY", () => { point.y = roundTo(v, 3); return true; }));
  bindSnapToggle();
  document.getElementById("deleteBoundaryBtn").addEventListener("click", deleteSelected);
}

function renderStructureSelection(entry) {
  const s = entry.item;
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Structure")}
    <label class="field"><span>Structure</span><span class="readonly-tag">${s.id}</span></label>
    <label class="field"><span>Team</span></label>
    ${teamSwatchMarkup(s.team_id, true)}
    <label class="field"><span>x</span><input id="selStructureX" type="number" step="0.1" value="${s.x}"></label>
    <label class="field"><span>y</span><input id="selStructureY" type="number" step="0.1" value="${s.y}"></label>
    <label class="field"><span>size</span><input id="selStructureSize" type="number" step="1" value="${s.size}"></label>
    ${snapToggleMarkup()}
    <button id="deleteStructureBtn" class="danger-button">Delete Structure</button>
  `;
  bindTeamSwatchGroup(el.selectionPanel, s.team_id, (nextTeam) => withAction("EDIT_STRUCTURE", () => { s.team_id = nextTeam; return true; }));
  bindNumericChange("selStructureX", (v) => withAction("MOVE_STRUCTURE", () => { s.x = roundTo(v, 3); return true; }));
  bindNumericChange("selStructureY", (v) => withAction("MOVE_STRUCTURE", () => { s.y = roundTo(v, 3); return true; }));
  bindNumericChange("selStructureSize", (v) => withAction("EDIT_STRUCTURE", () => { s.size = Math.max(20, Math.round(v)); return true; }));
  bindSnapToggle();
  document.getElementById("deleteStructureBtn").addEventListener("click", deleteSelected);
}

function bindNumericChange(id, cb) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    cb(value);
  });
}

function deleteSelected() {
  const entries = getSelectionEntries();
  if (!entries.length) return;
  const towersToDelete = new Set(entries.filter((e) => e.type === "tower").map((e) => e.item.id));
  const linkedWalls = state.walls.filter((w) => towersToDelete.has(w.t1) || towersToDelete.has(w.t2)).length;
  if (entries.length > 1) {
    const message = linkedWalls ? `Delete ${entries.length} selected items and ${linkedWalls} linked wall(s)?` : `Delete ${entries.length} selected items?`;
    if (!confirm(message)) return;
  }
  withAction(entries.length > 1 ? "DELETE_MULTI" : "DELETE_SINGLE", () => {
    const keys = new Set(entries.map((e) => e.key));
    state.towers = state.towers.filter((t) => !keys.has(makeKey("tower", t.uid)));
    const deletedTowerIds = new Set([...towersToDelete]);
    state.spawn_points = state.spawn_points.filter((s) => !keys.has(makeKey("spawn", s.uid)));
    state.bomb_sites = state.bomb_sites.filter((b) => !keys.has(makeKey("bomb", b.uid)));
    state.map_boundaries = state.map_boundaries.filter((p) => !keys.has(makeKey("boundary", p.uid)));
    state.structures = state.structures.filter((s) => !keys.has(makeKey("structure", s.uid)));
    state.walls = state.walls.filter((w) => !keys.has(makeKey("wall", w.uid)) && !deletedTowerIds.has(w.t1) && !deletedTowerIds.has(w.t2));
    selection.clear();
    return true;
  });
  renderSelectionPanel();
  setActionState("Selection deleted", "success", true);
}

function withAction(type, mutator) {
  const before = cloneState(state);
  const changed = mutator();
  if (!changed) return false;
  pushHistory(type, before, cloneState(state));
  onStateChanged();
  return true;
}

function pushHistory(type, before, after) {
  history.undo.push({ type, before, after });
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo = [];
}

function undoAction() {
  if (!history.undo.length) {
    setActionState("Nothing to undo", "idle", true);
    return;
  }
  const action = history.undo.pop();
  history.redo.push(action);
  state = cloneState(action.before);
  onStateReplaced();
  setActionState(`Undo: ${action.type}`, "success", true);
}

function redoAction() {
  if (!history.redo.length) {
    setActionState("Nothing to redo", "idle", true);
    return;
  }
  const action = history.redo.pop();
  history.undo.push(action);
  state = cloneState(action.after);
  onStateReplaced();
  setActionState(`Redo: ${action.type}`, "success", true);
}

function onStateChanged() {
  hydrateCountersFromState();
  sanitizeSelection();
  renderSelectionPanel();
  el.spawnProtectionInput.value = String(state.spawn_protection_size);
  requestRender();
}

function onStateReplaced() {
  interaction.wallDraft = null;
  interaction.hoverTowerId = null;
  interaction.drag = null;
  interaction.boxSelect = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  hydrateCountersFromState();
  sanitizeSelection();
  renderSelectionPanel();
  el.spawnProtectionInput.value = String(state.spawn_protection_size);
  requestRender();
}

function sanitizeSelection() {
  Array.from(selection).forEach((key) => { if (!resolveKey(key)) selection.delete(key); });
}

function draw() {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  drawGrid();
  drawBoundary();
  drawBombSites();
  drawStructures();
  drawWalls();
  drawTowerChainGhostWall();
  drawSpawns();
  drawTowers();
  drawGuides();
  drawWallDraft();
  drawBoxSelection();
}

function drawGrid() {
  const left = screenToWorld(0, 0).x;
  const right = screenToWorld(viewport.width, 0).x;
  const top = screenToWorld(0, 0).y;
  const bottom = screenToWorld(0, viewport.height).y;
  const cell = 48;
  const xStart = Math.floor(left / cell) * cell;
  const yStart = Math.floor(top / cell) * cell;

  ctx.strokeStyle = COLORS.gridMinor;
  ctx.lineWidth = 1.5 * view.scale;

  for (let x = xStart; x <= right; x += cell) {
    const sx = worldToScreen(x, 0).x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, viewport.height);
    ctx.stroke();
  }

  for (let y = yStart; y <= bottom; y += cell) {
    const sy = worldToScreen(0, y).y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(viewport.width, sy);
    ctx.stroke();
  }
}

function drawBoundary() {
  if (!state.map_boundaries.length) return;
  ctx.strokeStyle = COLORS.boundary;
  ctx.lineWidth = 4.0 * view.scale;
  ctx.beginPath();
  state.map_boundaries.forEach((point, i) => {
    const p = worldToScreen(point.x, point.y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  if (state.map_boundaries.length >= 3) {
    const first = state.map_boundaries[0];
    const p = worldToScreen(first.x, first.y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  state.map_boundaries.forEach((point) => {
    const p = worldToScreen(point.x, point.y);
    const selected = selection.has(makeKey("boundary", point.uid));
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#FFFFFF" : "#AEBAC8";
    ctx.fill();
  });
}

function drawStructures() {
  state.structures.forEach((s) => {
    const p = worldToScreen(s.x, s.y);
    const size = Math.max(14, s.size * view.scale);
    const half = size / 2;
    const selected = selection.has(makeKey("structure", s.uid));
    const fillColor = TEAM_COLORS[String(s.team_id)] || s.color || COLORS.red;
    ctx.fillStyle = fillColor;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.lineWidth = selected ? 3.3 : 2;
    ctx.strokeStyle = selected ? "#FFD166" : "#5C1219";
    ctx.strokeRect(p.x - half, p.y - half, size, size);
    ctx.fillStyle = "#FFE9EC";
    ctx.font = "700 10px 'Space Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.label || "S", p.x, p.y);
  });
}

function drawWalls() {
  state.walls.forEach((wall) => {
    const aTower = getTowerById(wall.t1);
    const bTower = getTowerById(wall.t2);
    if (!aTower || !bTower) return;
    const a = worldToScreen(aTower.x, aTower.y);
    const b = worldToScreen(bTower.x, bTower.y);
    const color = getTeamColor(wall.team_id);
    ctx.lineCap = "round";
    ctx.lineWidth = 32 * view.scale;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    if (selection.has(makeKey("wall", wall.uid))) {
      ctx.lineCap = "round";
      ctx.lineWidth = (32 * view.scale) + (6 * view.scale);
      ctx.strokeStyle = "#FFFFFF";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  });
}

function drawSpawns() {
  state.spawn_points.forEach((spawn) => {
    const p = worldToScreen(spawn.x, spawn.y);
    const spawnSize = Math.max(1, Number(state.spawn_protection_size) || 500);
    const size = spawnSize * view.scale;
    const half = size / 2;
    const color = getTeamColor(spawn.team_id);
    ctx.lineWidth = 4 * view.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 1.0;
    ctx.strokeRect(p.x - half, p.y - half, size, size);

    ctx.fillStyle = color;
    const iconSize = 20 * view.scale;
    const iconHalf = 10 * view.scale;
    ctx.fillRect(p.x - iconHalf, p.y - iconHalf, iconSize, iconSize);

    if (selection.has(makeKey("spawn", spawn.uid))) {
      const pad = 8 * view.scale;
      ctx.lineWidth = 3 * view.scale;
      ctx.strokeStyle = "#FFFFFF";
      ctx.strokeRect(p.x - half - pad, p.y - half - pad, size + pad * 2, size + pad * 2);
    }
  });
}

function drawBombSites() {
  state.bomb_sites.forEach((bomb) => {
    const p = worldToScreen(bomb.x, bomb.y);
    const radius = 250 * view.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = "rgba(51, 127, 229, 0.8)";
    ctx.fillStyle = "rgba(51, 127, 229, 0.15)";
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${72 * view.scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(bomb.site_letter, p.x, p.y);

    if (selection.has(makeKey("bomb", bomb.uid))) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + (10 * view.scale), 0, Math.PI * 2);
      ctx.lineWidth = 3 * view.scale;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
    }
  });
}

function drawTowers() {
  state.towers.forEach((tower) => {
    const p = worldToScreen(tower.x, tower.y);
    const color = tower.is_invincible ? COLORS.neutral : getTeamColor(tower.team_id);

    ctx.beginPath();
    ctx.arc(p.x, p.y, 44 * view.scale, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `${16 * view.scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tower.health), p.x, p.y);

    if (selection.has(makeKey("tower", tower.uid))) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (44 * view.scale) + (8 * view.scale), 0, Math.PI * 2);
      ctx.lineWidth = 3 * view.scale;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
    }
  });
}

function drawTowerChainGhostWall() {
  if (interaction.mode !== "tower") return;
  if (interaction.towerChainLastId == null) return;
  const startTower = getTowerById(interaction.towerChainLastId);
  if (!startTower) return;

  const hoveredTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
  const rawTarget = hoveredTower && hoveredTower.id !== startTower.id
    ? { x: hoveredTower.x, y: hoveredTower.y }
    : { x: interaction.mouseWorld.x, y: interaction.mouseWorld.y };
  const endWorld = clipLineToMaxLength(startTower.x, startTower.y, rawTarget.x, rawTarget.y, GAME.WALL_MAX_LENGTH);

  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(endWorld.x, endWorld.y);
  const color = getTeamColor(defaults.defaultTeam);

  ctx.lineCap = "round";
  ctx.lineWidth = 32 * view.scale;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
}

function drawOctagon(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGuides() {
  if (interaction.guides.x != null) {
    const x = worldToScreen(interaction.guides.x, 0).x;
    ctx.strokeStyle = withAlpha(COLORS.guide, 0.82);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewport.height);
    ctx.stroke();
    interaction.guides.xPoints.forEach((point) => {
      const p = worldToScreen(point.x, point.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(COLORS.guide, 0.95);
      ctx.fill();
    });
  }
  if (interaction.guides.y != null) {
    const y = worldToScreen(0, interaction.guides.y).y;
    ctx.strokeStyle = withAlpha(COLORS.guide, 0.82);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
    ctx.stroke();
    interaction.guides.yPoints.forEach((point) => {
      const p = worldToScreen(point.x, point.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(COLORS.guide, 0.95);
      ctx.fill();
    });
  }
}

function drawWallDraft() {
  const draft = interaction.wallDraft;
  if (!draft) return;
  const startTower = getTowerById(draft.startTowerId);
  if (!startTower) return;
  const hoverTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
  const rawTarget = hoverTower && hoverTower.id !== startTower.id
    ? { x: hoverTower.x, y: hoverTower.y }
    : draft.mouse;
  const endWorld = clipLineToMaxLength(startTower.x, startTower.y, rawTarget.x, rawTarget.y, GAME.WALL_MAX_LENGTH);
  const length = distance(startTower.x, startTower.y, rawTarget.x, rawTarget.y);
  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(endWorld.x, endWorld.y);
  const ratio = length / GAME.WALL_MAX_LENGTH;
  let color = getTeamColor(defaults.defaultTeam);
  if (ratio > 0.95) color = COLORS.warn;
  if (ratio > 1) color = COLORS.danger;
  const width = 32 * view.scale;
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  if (length > GAME.WALL_MAX_LENGTH) setActionState(`Wall exceeds max length (${Math.round(length)})`, "error");
}

function drawBoxSelection() {
  const box = interaction.boxSelect;
  if (!box) return;
  const s = worldToScreen(box.start.x, box.start.y);
  const e = worldToScreen(box.end.x, box.end.y);
  const x = Math.min(s.x, e.x);
  const y = Math.min(s.y, e.y);
  const w = Math.abs(e.x - s.x);
  const h = Math.abs(e.y - s.y);
  ctx.fillStyle = "rgba(116, 200, 255, 0.16)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(116, 200, 255, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.strokeRect(x, y, w, h);
}

function getTotalWallLength() {
  let total = 0;
  state.walls.forEach((wall) => {
    const a = getTowerById(wall.t1);
    const b = getTowerById(wall.t2);
    if (a && b) total += distance(a.x, a.y, b.x, b.y);
  });
  return total;
}

function exportJSON() {
  const validation = validateForExport();
  if (validation) {
    alert(validation);
    setActionState(validation, "error", true);
    return;
  }
  const payload = {
    spawn_protection_size: Number(state.spawn_protection_size),
    map_boundaries: state.map_boundaries.map((p) => ({ x: roundTo(p.x, 3), y: roundTo(p.y, 3) })),
    spawn_points: state.spawn_points.map((s) => ({ team_id: s.team_id, x: roundTo(s.x, 3), y: roundTo(s.y, 3) })).sort((a, b) => a.team_id - b.team_id),
    bomb_sites: state.bomb_sites.map((b) => ({ site_letter: String(b.site_letter || "A").toUpperCase(), x: roundTo(b.x, 3), y: roundTo(b.y, 3) })),
    towers: [...state.towers].sort((a, b) => a.id - b.id).map((t) => ({
      id: t.id,
      team_id: t.team_id,
      x: roundTo(t.x, 3),
      y: roundTo(t.y, 3),
      health: clamp(1, Math.round(t.health), 5),
      is_invincible: Boolean(t.is_invincible),
    })),
    walls: state.walls.map((w) => ({ t1: w.t1, t2: w.t2, team_id: w.team_id })),
  };
  if (state.structures.length) {
    payload.structures = state.structures.map((s) => ({ id: s.id, x: roundTo(s.x, 3), y: roundTo(s.y, 3), size: s.size, label: s.label, color: s.color, team_id: s.team_id }));
  }
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "map.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setActionState("Export successful", "success", true);
}

function validateForExport() {
  if (state.map_boundaries.length < 3) return "Validation error: map_boundaries must contain at least 3 points.";
  const team0 = state.spawn_points.filter((p) => p.team_id === 0).length;
  const team1 = state.spawn_points.filter((p) => p.team_id === 1).length;
  if (state.spawn_points.length !== 2 || team0 !== 1 || team1 !== 1) {
    return "Validation error: spawn_points must include exactly one Team 0 and one Team 1 spawn.";
  }
  const ids = new Set(state.towers.map((t) => t.id));
  const seen = new Set();
  for (const wall of state.walls) {
    if (wall.t1 === wall.t2) return "Validation error: wall cannot connect a tower to itself.";
    if (!ids.has(wall.t1) || !ids.has(wall.t2)) return "Validation error: wall references a missing tower id.";
    const key = `${Math.min(wall.t1, wall.t2)}:${Math.max(wall.t1, wall.t2)}`;
    if (seen.has(key)) return "Validation error: duplicate wall between two towers.";
    seen.add(key);
  }
  return null;
}

function importJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const imported = parseImportedState(parsed);
      const before = cloneState(state);
      state = imported;
      pushHistory("IMPORT_JSON", before, cloneState(state));
      onStateReplaced();
      setActionState("JSON imported", "success", true);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
      setActionState("Import failed", "error", true);
    } finally {
      el.importFileInput.value = "";
    }
  };
  reader.onerror = () => {
    alert("Import failed: could not read file.");
    el.importFileInput.value = "";
  };
  reader.readAsText(file);
}

function parseImportedState(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Root must be an object.");
  const mapRaw = expectArray(data.map_boundaries, "map_boundaries");
  const spawnRaw = expectArray(data.spawn_points, "spawn_points");
  const bombRaw = expectArray(data.bomb_sites, "bomb_sites");
  const towersRaw = expectArray(data.towers, "towers");
  const wallsRaw = expectArray(data.walls, "walls");
  const structRaw = Array.isArray(data.structures) ? data.structures : [];
  const imported = {
    spawn_protection_size: expectNumber(data.spawn_protection_size, "spawn_protection_size"),
    map_boundaries: mapRaw.map((p, i) => ({ uid: createUid("boundary"), x: expectNumber(p?.x, `map_boundaries[${i}].x`), y: expectNumber(p?.y, `map_boundaries[${i}].y`) })),
    spawn_points: spawnRaw.map((s, i) => ({ uid: createUid("spawn"), team_id: expectInteger(s?.team_id, `spawn_points[${i}].team_id`), x: expectNumber(s?.x, `spawn_points[${i}].x`), y: expectNumber(s?.y, `spawn_points[${i}].y`) })),
    bomb_sites: bombRaw.map((b, i) => ({ uid: createUid("bomb"), site_letter: expectString(b?.site_letter, `bomb_sites[${i}].site_letter`).toUpperCase(), x: expectNumber(b?.x, `bomb_sites[${i}].x`), y: expectNumber(b?.y, `bomb_sites[${i}].y`) })),
    towers: towersRaw.map((t, i) => ({
      uid: createUid("tower"),
      id: expectInteger(t?.id, `towers[${i}].id`),
      team_id: expectInteger(t?.team_id, `towers[${i}].team_id`),
      x: expectNumber(t?.x, `towers[${i}].x`),
      y: expectNumber(t?.y, `towers[${i}].y`),
      health: clamp(1, expectInteger(t?.health, `towers[${i}].health`), 5),
      is_invincible: expectBoolean(t?.is_invincible, `towers[${i}].is_invincible`),
    })),
    walls: wallsRaw.map((w, i) => ({ uid: createUid("wall"), id: nextWallLocalId(), t1: expectInteger(w?.t1, `walls[${i}].t1`), t2: expectInteger(w?.t2, `walls[${i}].t2`), team_id: expectInteger(w?.team_id, `walls[${i}].team_id`) })),
    structures: structRaw.map((s, i) => ({
      uid: createUid("structure"),
      id: typeof s?.id === "number" ? s.id : nextStructureId(),
      x: expectNumber(s?.x, `structures[${i}].x`),
      y: expectNumber(s?.y, `structures[${i}].y`),
      size: Math.max(20, Math.round(expectNumber(s?.size ?? 130, `structures[${i}].size`))),
      label: typeof s?.label === "string" ? s.label : "BLOCK",
      color: typeof s?.color === "string" ? s.color : COLORS.red,
      team_id: Number.isInteger(s?.team_id) ? s.team_id : 1,
    })),
  };

  const spawnCounts = new Map();
  imported.spawn_points.forEach((s) => {
    if (s.team_id !== 0 && s.team_id !== 1) throw new Error(`spawn_points includes invalid team_id ${s.team_id}`);
    spawnCounts.set(s.team_id, (spawnCounts.get(s.team_id) || 0) + 1);
  });
  if ((spawnCounts.get(0) || 0) > 1 || (spawnCounts.get(1) || 0) > 1) throw new Error("spawn_points cannot contain duplicate team spawns.");

  const towerIds = new Set();
  imported.towers.forEach((t) => {
    if (towerIds.has(t.id)) throw new Error(`Duplicate tower id ${t.id}.`);
    towerIds.add(t.id);
  });
  const wallSeen = new Set();
  imported.walls.forEach((w) => {
    if (w.t1 === w.t2) throw new Error("A wall cannot connect a tower to itself.");
    if (!towerIds.has(w.t1) || !towerIds.has(w.t2)) throw new Error("Wall references a missing tower id.");
    const key = `${Math.min(w.t1, w.t2)}:${Math.max(w.t1, w.t2)}`;
    if (wallSeen.has(key)) throw new Error("Duplicate wall connection found.");
    wallSeen.add(key);
  });

  return imported;
}

function getSelectionEntries() {
  const out = [];
  selection.forEach((key) => {
    const entry = resolveKey(key);
    if (entry) out.push(entry);
  });
  return out;
}

function getSelectableEntries() {
  const list = [];
  state.towers.forEach((item) => list.push({ type: "tower", item, key: makeKey("tower", item.uid), movable: true }));
  state.spawn_points.forEach((item) => list.push({ type: "spawn", item, key: makeKey("spawn", item.uid), movable: true }));
  state.bomb_sites.forEach((item) => list.push({ type: "bomb", item, key: makeKey("bomb", item.uid), movable: true }));
  state.walls.forEach((item) => list.push({ type: "wall", item, key: makeKey("wall", item.uid), movable: false }));
  state.map_boundaries.forEach((item) => list.push({ type: "boundary", item, key: makeKey("boundary", item.uid), movable: true }));
  state.structures.forEach((item) => list.push({ type: "structure", item, key: makeKey("structure", item.uid), movable: true }));
  return list;
}

function resolveKey(key) {
  const [type, uid] = String(key).split(":");
  if (!type || !uid) return null;
  if (type === "tower") {
    const item = state.towers.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  if (type === "spawn") {
    const item = state.spawn_points.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  if (type === "bomb") {
    const item = state.bomb_sites.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  if (type === "wall") {
    const item = state.walls.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: false } : null;
  }
  if (type === "boundary") {
    const item = state.map_boundaries.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  if (type === "structure") {
    const item = state.structures.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  return null;
}

function getEntryCenter(entry) {
  if (["tower", "spawn", "bomb", "boundary", "structure"].includes(entry.type)) return { x: entry.item.x, y: entry.item.y };
  if (entry.type === "wall") {
    const a = getTowerById(entry.item.t1);
    const b = getTowerById(entry.item.t2);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return null;
}

function makeKey(type, uid) { return `${type}:${uid}`; }
function getKeyPosition(key) {
  const entry = resolveKey(key);
  if (!entry || !entry.movable) return null;
  return { x: entry.item.x, y: entry.item.y };
}
function setKeyPosition(key, x, y) {
  const entry = resolveKey(key);
  if (!entry || !entry.movable) return;
  entry.item.x = x;
  entry.item.y = y;
}

function hitTest(world) {
  const tower = hitTower(world);
  if (tower) return { key: makeKey("tower", tower.uid), movable: true };
  const spawn = hitSpawn(world);
  if (spawn) return { key: makeKey("spawn", spawn.uid), movable: true };
  const bomb = hitBomb(world);
  if (bomb) return { key: makeKey("bomb", bomb.uid), movable: true };
  const structure = hitStructure(world);
  if (structure) return { key: makeKey("structure", structure.uid), movable: true };
  const boundary = hitBoundary(world);
  if (boundary) return { key: makeKey("boundary", boundary.uid), movable: true };
  const wall = hitWall(world);
  if (wall) return { key: makeKey("wall", wall.uid), movable: false };
  return null;
}

function hitTower(world) {
  const threshold = 44;
  for (let i = state.towers.length - 1; i >= 0; i -= 1) {
    if (distance(world.x, world.y, state.towers[i].x, state.towers[i].y) <= threshold) return state.towers[i];
  }
  return null;
}
function hitSpawn(world) {
  const half = (Number(state.spawn_protection_size) || 500) / 2;
  for (let i = state.spawn_points.length - 1; i >= 0; i -= 1) {
    const s = state.spawn_points[i];
    if (Math.abs(world.x - s.x) <= half && Math.abs(world.y - s.y) <= half) return s;
  }
  return null;
}
function hitBomb(world) {
  const threshold = 250;
  for (let i = state.bomb_sites.length - 1; i >= 0; i -= 1) {
    if (distance(world.x, world.y, state.bomb_sites[i].x, state.bomb_sites[i].y) <= threshold) return state.bomb_sites[i];
  }
  return null;
}
function hitStructure(world) {
  for (let i = state.structures.length - 1; i >= 0; i -= 1) {
    const s = state.structures[i];
    const half = s.size / 2;
    if (Math.abs(world.x - s.x) <= half && Math.abs(world.y - s.y) <= half) return s;
  }
  return null;
}
function hitBoundary(world) {
  const threshold = 24;
  for (let i = state.map_boundaries.length - 1; i >= 0; i -= 1) {
    if (distance(world.x, world.y, state.map_boundaries[i].x, state.map_boundaries[i].y) <= threshold) return state.map_boundaries[i];
  }
  return null;
}
function hitWall(world) {
  const threshold = 16;
  for (let i = state.walls.length - 1; i >= 0; i -= 1) {
    const wall = state.walls[i];
    const a = getTowerById(wall.t1);
    const b = getTowerById(wall.t2);
    if (!a || !b) continue;
    if (pointToSegmentDistance(world, a, b) <= threshold) return wall;
  }
  return null;
}

function getTowerById(id) {
  return state.towers.find((t) => t.id === id) || null;
}
function hasDuplicateWall(t1, t2) {
  return state.walls.some((w) => (w.t1 === t1 && w.t2 === t2) || (w.t1 === t2 && w.t2 === t1));
}

function createUid(prefix) {
  uidSeed += 1;
  return `${prefix}_${uidSeed}`;
}
function nextTowerId() {
  const id = towerIdSeed;
  towerIdSeed += 1;
  return id;
}
function nextWallLocalId() {
  const id = wallLocalIdSeed;
  wallLocalIdSeed += 1;
  return id;
}
function nextStructureId() {
  const id = structureIdSeed;
  structureIdSeed += 1;
  return id;
}

function nextBombSiteLetter() {
  const used = new Set(state.bomb_sites.map((b) => String(b.site_letter || "").toUpperCase()));
  for (let i = 0; i < 300; i += 1) {
    const v = numberToLetters(i);
    if (!used.has(v)) return v;
  }
  return "A";
}
function numberToLetters(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function setActionState(text, tone = "idle", autoReset = false) {
  if (actionTimer) {
    clearTimeout(actionTimer);
    actionTimer = null;
  }
  el.actionState.textContent = text;
  el.actionState.className = `action-state ${tone}`;
  if (autoReset) {
    actionTimer = setTimeout(() => {
      el.actionState.textContent = "Idle";
      el.actionState.className = "action-state idle";
      actionTimer = null;
    }, 2200);
  }
}

function getTeamColor(teamId) {
  return TEAM_COLORS[String(teamId)] || COLORS.neutral;
}

function hydrateCountersFromState() {
  let maxUid = uidSeed;
  let maxTower = 0;
  let maxWall = 0;
  let maxStruct = 0;
  const scanUid = (uid) => {
    const m = String(uid || "").match(/_(\d+)$/);
    if (m) maxUid = Math.max(maxUid, Number(m[1]));
  };
  state.map_boundaries.forEach((p) => scanUid(p.uid));
  state.spawn_points.forEach((p) => scanUid(p.uid));
  state.bomb_sites.forEach((p) => scanUid(p.uid));
  state.towers.forEach((t) => { scanUid(t.uid); maxTower = Math.max(maxTower, t.id); });
  state.walls.forEach((w) => { scanUid(w.uid); maxWall = Math.max(maxWall, w.id || 0); });
  state.structures.forEach((s) => { scanUid(s.uid); maxStruct = Math.max(maxStruct, s.id || 0); });
  uidSeed = maxUid + 1;
  towerIdSeed = maxTower + 1;
  wallLocalIdSeed = maxWall + 1;
  structureIdSeed = maxStruct + 1;
}

function cloneState(v) {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function expectArray(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}
function expectNumber(value, path) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${path} must be a number.`);
  return n;
}
function expectInteger(value, path) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${path} must be an integer.`);
  return n;
}
function expectBoolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
  return value;
}
function expectString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string.`);
  return value.trim();
}

function isInsideCurrentBoundary(x, y) {
  if (state.map_boundaries.length < 3) return true;
  return pointInPolygon(x, y, state.map_boundaries);
}

function isPlacementInsideBoundary(type, x, y, item = null) {
  if (state.map_boundaries.length < 3) return true;
  if (type === "tower") return isCircleInsideBoundary(x, y, 44);
  if (type === "bomb") return isCircleInsideBoundary(x, y, 250);
  if (type === "spawn") return isSquareInsideBoundary(x, y, (Number(state.spawn_protection_size) || 500) / 2);
  if (type === "structure") {
    const half = item && Number.isFinite(item.size) ? item.size / 2 : 70;
    return isSquareInsideBoundary(x, y, half);
  }
  return isInsideCurrentBoundary(x, y);
}

function isCircleInsideBoundary(x, y, radius) {
  if (!isInsideCurrentBoundary(x, y)) return false;
  const testPoints = [
    { x: x + radius, y },
    { x: x - radius, y },
    { x, y: y + radius },
    { x, y: y - radius },
    { x: x + radius * 0.707, y: y + radius * 0.707 },
    { x: x + radius * 0.707, y: y - radius * 0.707 },
    { x: x - radius * 0.707, y: y + radius * 0.707 },
    { x: x - radius * 0.707, y: y - radius * 0.707 },
  ];
  return testPoints.every((p) => isInsideCurrentBoundary(p.x, p.y));
}

function isSquareInsideBoundary(x, y, half) {
  const testPoints = [
    { x, y },
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x - half, y: y + half },
    { x: x + half, y: y + half },
  ];
  return testPoints.every((p) => isInsideCurrentBoundary(p.x, p.y));
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.0000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function roundTo(v, d) { const p = 10 ** d; return Math.round(v * p) / p; }
function clamp(min, v, max) { return Math.max(min, Math.min(v, max)); }
function distance(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function withAlpha(hex, alpha) {
  const s = String(hex).replace("#", "");
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(point.x, point.y, a.x, a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  t = clamp(0, t, 1);
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return distance(point.x, point.y, px, py);
}

function clipLineToMaxLength(ax, ay, bx, by, maxLength) {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxLength || dist === 0) return { x: bx, y: by };
  const ratio = maxLength / dist;
  return {
    x: ax + dx * ratio,
    y: ay + dy * ratio,
  };
}

function createInitialState() {
  return {
    spawn_protection_size: 500,
    map_boundaries: [
      { uid: "boundary_1", x: 140, y: 180 },
      { uid: "boundary_2", x: 3240, y: 180 },
      { uid: "boundary_3", x: 3560, y: 620 },
      { uid: "boundary_4", x: 3480, y: 1820 },
      { uid: "boundary_5", x: 2920, y: 2260 },
      { uid: "boundary_6", x: 1420, y: 2440 },
      { uid: "boundary_7", x: 260, y: 2150 },
      { uid: "boundary_8", x: 80, y: 1060 },
    ],
    spawn_points: [
      { uid: "spawn_1", team_id: 0, x: 300, y: 1200 },
      { uid: "spawn_2", team_id: 1, x: 3220, y: 1210 },
    ],
    bomb_sites: [
      { uid: "bomb_1", site_letter: "A", x: 820, y: 640 },
      { uid: "bomb_2", site_letter: "B", x: 2550, y: 640 },
      { uid: "bomb_3", site_letter: "C", x: 880, y: 1900 },
    ],
    towers: [
      { uid: "tower_1", id: 1, team_id: 0, x: 1180, y: 1080, health: 5, is_invincible: false },
      { uid: "tower_2", id: 2, team_id: 0, x: 1580, y: 900, health: 5, is_invincible: false },
      { uid: "tower_3", id: 3, team_id: 0, x: 2060, y: 1180, health: 5, is_invincible: false },
      { uid: "tower_4", id: 4, team_id: 0, x: 1660, y: 1520, health: 5, is_invincible: false },
      { uid: "tower_5", id: 5, team_id: 0, x: 830, y: 560, health: 5, is_invincible: false },
      { uid: "tower_6", id: 6, team_id: 0, x: 2590, y: 560, health: 5, is_invincible: false },
      { uid: "tower_7", id: 7, team_id: 0, x: 900, y: 1820, health: 5, is_invincible: false },
      { uid: "tower_8", id: 8, team_id: 1, x: 3000, y: 1580, health: 5, is_invincible: false },
    ],
    walls: [
      { uid: "wall_1", id: 1, t1: 1, t2: 2, team_id: 0 },
      { uid: "wall_2", id: 2, t1: 2, t2: 3, team_id: 0 },
      { uid: "wall_3", id: 3, t1: 3, t2: 4, team_id: 0 },
      { uid: "wall_4", id: 4, t1: 4, t2: 1, team_id: 0 },
    ],
    structures: [
      { uid: "structure_1", id: 1, x: 2840, y: 1720, size: 140, label: "BLOCK", color: COLORS.red, team_id: 1 },
    ],
  };
}

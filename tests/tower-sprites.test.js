const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
function loadTowerArt() {
  const images = [];
  class TestImage {
    constructor() {
      this.complete = true;
      this.naturalWidth = 590;
      this.naturalHeight = 350;
      images.push(this);
    }
  }
  const globals = vm.createContext({ Image: TestImage });
  vm.runInContext(fs.readFileSync(path.join(root, "tower-art.js"), "utf8"), globals, { filename: "tower-art.js" });
  return { api: globals.CosmowarTowerArt, images };
}

test("game tower sheets are checked in with original 590x350 atlas geometry", () => {
  const { api } = loadTowerArt();
  assert.equal(api.CELL, 110);
  assert.equal(api.STRIDE, 120);
  for (const file of ["blue.png", "red.png", "neutral.png"]) {
    const bytes = fs.readFileSync(path.join(root, "assets", "tower-sprites", file));
    assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), 590);
    assert.equal(bytes.readUInt32BE(20), 350);
  }
});

test("health, neutral and indestructible frames map to the game's atlas order", () => {
  const { api } = loadTowerArt();
  assert.equal(api.frameFor({ health: 4 }), 0);
  assert.equal(api.frameFor({ health: 3 }), 5);
  assert.equal(api.frameFor({ health: 2 }), 9);
  assert.equal(api.frameFor({ health: 1 }), 12);
  assert.equal(api.frameFor({ health: 1, is_invincible: true }), 14);
  assert.equal(api.teamFor({ team_id: 0 }), 0);
  assert.equal(api.teamFor({ team_id: 1 }), 1);
  assert.equal(api.teamFor({ team_id: -1 }), -1);
});

test("tower art is drawn at the unchanged editor diameter, centered on the original position", () => {
  const { api, images } = loadTowerArt();
  const calls = [];
  const canvas = {
    globalAlpha: 1,
    save() {},
    restore() {},
    drawImage(...args) { calls.push(args); },
  };
  assert.equal(api.draw(canvas, { team_id: 1, health: 2 }, 300, 200, 70.4, 0.55), true);
  assert.equal(images.length, 3);
  assert.equal(calls.length, 1);
  const args = calls[0];
  assert.equal(args[0].src, "assets/tower-sprites/red.png");
  assert.deepEqual(args.slice(1, 5), [480, 120, 110, 110]);
  assert.ok(Math.abs(args[5] - 264.8) < 0.00001);
  assert.ok(Math.abs(args[6] - 164.8) < 0.00001);
  assert.equal(args[7], 70.4);
  assert.equal(args[8], 70.4);
});

test("tower hit-testing radius stays unchanged and all relevant editors render actual art", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(source, /TOWER_DIAMETER:\s*70\.4/);
  assert.match(source, /function hitTower\(world\)\s*\{\s*const threshold = GAME\.TOWER_DIAMETER\s*\/\s*2/);
  for (const fn of ["drawTowers", "drawBuildGhostTower", "drawPasteDraft", "renderCleanSceneToCanvas", "drawMirrorPreviewEntity"]) {
    const start = source.indexOf("function " + fn + "(");
    const end = source.indexOf("\n}", start);
    assert.ok(start >= 0 && end > start, fn + " is missing");
    assert.match(source.slice(start, end), /drawGameTower\(/, fn + " does not use game artwork");
  }
});

test("new UI is mandatory even when an old saved session asks for the previous interface", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const shell = fs.readFileSync(path.join(root, "ui-shell.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.doesNotMatch(html, /data-ui-shell=/);
  assert.match(shell, /function readInitialShell\(\) \{ return "new"; \}/);
  assert.match(shell, /function applyShell\(shell, persist\) \{ const next = "new";/);
  assert.match(app, /editorSettings\.uiShell = "new";/);
});

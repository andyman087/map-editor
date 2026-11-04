(function () {
  "use strict";

  // The same 590x350 / 110px cell / 10px gap atlas used by Cosmowar.
  // Source artwork: Defly-2/Project-Capture (dev), assets/{Blue,Red,Gray}_Towers.png.
  const CELL = 110;
  const STRIDE = 120;
  const SHEET_WIDTH = 590;
  const SHEET_HEIGHT = 350;
  const SOURCE = Object.freeze({
    0: "assets/tower-sprites/blue.png",
    1: "assets/tower-sprites/red.png",
    "-1": "assets/tower-sprites/neutral.png",
  });
  const IMAGES = {};
  const FRAME_BY_HP = Object.freeze({ 4: 0, 3: 5, 2: 9, 1: 12 });

  function frameFor(tower) {
    if (tower?.is_invincible) return 14;
    const hp = Math.max(1, Math.min(4, Math.round(Number(tower?.health) || 4)));
    return FRAME_BY_HP[hp];
  }

  function teamFor(tower) {
    const id = Number(tower?.team_id);
    return id === 1 ? 1 : id === -1 ? -1 : 0;
  }

  function draw(target, tower, x, y, diameter, alpha = 1) {
    const image = IMAGES[teamFor(tower)];
    if (!image || !image.complete || image.naturalWidth < SHEET_WIDTH || image.naturalHeight < SHEET_HEIGHT) return false;
    if (!target || typeof target.drawImage !== "function" || !Number.isFinite(diameter) || diameter <= 0) return false;
    const frame = frameFor(tower);
    const sourceX = (frame % 5) * STRIDE;
    const sourceY = Math.floor(frame / 5) * STRIDE;
    target.save();
    target.globalAlpha *= alpha;
    target.drawImage(image, sourceX, sourceY, CELL, CELL, x - diameter / 2, y - diameter / 2, diameter, diameter);
    target.restore();
    return true;
  }

  if (typeof Image === "function") {
    for (const [team, path] of Object.entries(SOURCE)) {
      const image = new Image();
      IMAGES[team] = image;
      image.onload = () => {
        if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") {
          globalThis.dispatchEvent(new Event("cosmowar:tower-art-ready"));
        }
      };
      image.src = path;
    }
  }

  globalThis.CosmowarTowerArt = Object.freeze({ draw, frameFor, teamFor, CELL, STRIDE, SOURCE });
})();

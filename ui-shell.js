(function () {
  "use strict";

  const legacyIds = new Map();
  const shellCurrent = document.getElementById("shellCurrent");
  const shellNew = document.getElementById("shellNew");
  const canvas = document.getElementById("mapCanvas");

  function icon(name, className = "") {
    return `<svg class="ico ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function prefixLegacyIds() {
    shellCurrent.querySelectorAll("[id]").forEach((node) => {
      if (node.id === "mapCanvas") return;
      const canonicalId = node.id;
      legacyIds.set(canonicalId, node);
      node.dataset.mirror = canonicalId;
      node.id = `lg${canonicalId[0].toUpperCase()}${canonicalId.slice(1)}`;
      if (canonicalId === "actionState") node.dataset.actionState = "";
      if (["selectionPanel", "customShapesList", "deflyConversionPanel"].includes(canonicalId)) node.dataset.mirrorView = canonicalId;
    });
  }

  function toolButton(tool, iconName, label, key) {
    return `<button class="tool-button ${tool === "select" ? "active" : ""}" data-tool="${tool}" type="button" title="${label} (${key})" aria-label="${label}">${icon(iconName)}<span class="tool-key">${key}</span></button>`;
  }

  function teamPicker(includeNeutral = true) {
    return `<div class="team-swatches compact"><button class="team-swatch blue active" data-team="0" type="button" aria-label="Team Blue"><span>Blue</span></button><button class="team-swatch red" data-team="1" type="button" aria-label="Team Red"><span>Red</span></button>${includeNeutral ? '<button class="team-swatch neutral" data-team="-1" type="button" aria-label="Neutral"><span>Neutral</span></button>' : ""}</div>`;
  }

  function switchControl(id, label, checked = true) {
    return `<label class="switch"><input id="${id}" type="checkbox" ${checked ? "checked" : ""}><span class="switch-track"></span>${label ? `<span>${label}</span>` : ""}</label>`;
  }

  function optionsMarkup() {
    return `<div class="tool-options-panel" aria-live="polite">
      <section data-tool-options="select"><strong>Select and move</strong>${switchControl("selectObjectSnapProxy", "Object snap")}${switchControl("selectGridSnapProxy", "Grid snap")}<span class="option-hint">Drag to box-select. Shift-click adds to selection.</span></section>
      <section data-tool-options="boundary" hidden><strong>Draw boundary</strong><label>Preset<select id="mapPresetSelect"><option value="square">Square</option><option value="wide">Wide Rectangle</option><option value="diamond">Diamond</option><option value="octagon">Octagon</option><option value="circle">Round Arena</option></select></label><label>Width<input id="mapPresetWidth" type="number" min="500" step="100" value="4000"></label><label>Height<input id="mapPresetHeight" type="number" min="500" step="100" value="4000"></label><button id="applyMapPresetBtn" class="btn primary" type="button">Replace boundary</button></section>
      <section data-tool-options="hole" hidden><strong>Draw hole</strong><span class="readonly"><b id="holeVertexCount">0</b> vertices</span><button class="btn" id="cancelHoleDraftBtn" type="button">Cancel</button><span class="option-hint">Click the first vertex or press Enter to close. Backspace removes a vertex.</span></section>
      <section data-tool-options="build" hidden><strong>Build</strong>${teamPicker(true)}<span class="option-label">Health</span><div class="health-pips">${[1, 2, 3, 4].map((n) => `<button type="button" data-health="${n}" class="health-pip ${n === 4 ? "active" : ""}">${n}</button>`).join("")}</div><label class="hidden-control"><input type="number" id="towerHealthInput" value="4" min="1" max="4" step="1"></label>${switchControl("towerInvincibleInput", "Invincible", false)}<span class="option-hint">Click to place towers; consecutive towers connect automatically.</span></section>
      <section data-tool-options="spawn" hidden><strong>Place spawn</strong>${teamPicker(false)}</section>
      <section data-tool-options="bomb" hidden><strong>Place bomb site</strong><span class="option-label">Next site</span><span id="nextBombSiteValue" class="letter-chip">A</span><span class="option-hint">Letters are assigned automatically.</span></section>
      <section data-tool-options="mirror" hidden><strong>Draw mirror axis</strong><label>Axis action<select id="mirrorTransformType"><option value="reflect">Reflect across line</option><option value="rotate">Rotate 180° around centre</option></select></label>${switchControl("mirrorLiveInput", "Live mirroring", false)}<button id="applyMirrorSelectionBtn" class="btn" type="button">Mirror once</button><span id="mirrorStatus" class="option-hint">No mirror axes.</span><button id="removeLastMirrorBtn" class="btn" type="button">Undo axis</button><button id="clearMirrorAxesBtn" class="btn danger" type="button">Clear axes</button></section>
    </div>`;
  }

  function menuItem(action, label, key = "", iconName = "caret-right") {
    return `<button role="menuitem" data-action="${action}">${icon(iconName, "sm")}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`;
  }

  function menusMarkup() {
    return `<div class="menu-popover" id="menuFile" role="menu" hidden>${menuItem("new-map", "New map", "", "plus")}${menuItem("import", "Import map", "", "upload-simple")}${menuItem("export", "Export map", "", "download-simple")}<hr>${menuItem("export-shapes", "Export saved shapes", "", "download-simple")}${menuItem("import-shapes", "Import saved shapes", "", "upload-simple")}</div>
      <div class="menu-popover" id="menuEdit" role="menu" hidden>${menuItem("undo", "Undo", "Ctrl Z", "arrow-counter-clockwise")}${menuItem("redo", "Redo", "Ctrl Y", "arrow-clockwise")}<hr>${menuItem("copy", "Copy", "Ctrl C", "stack-simple")}${menuItem("paste", "Paste", "Ctrl V", "plus")}${menuItem("delete", "Delete", "Del", "trash")}<hr>${menuItem("select-matching", "Select matching objects")}${menuItem("origin", "Move map to origin", "", "crosshair-simple")}${menuItem("invincible", "Make all towers invincible", "", "shield-check")}</div>
      <div class="menu-popover" id="menuView" role="menu" hidden>${menuItem("fit", "Zoom to fit map", "F", "magnifying-glass")}<div class="menu-heading">Grid</div>${menuItem("grid-visible", "Show grid", "G", "grid-four")}${menuItem("grid-major", "Emphasise every 5th line", "", "check-circle")}${menuItem("origin-axes", "Show origin axes", "", "check-circle")}<hr><div class="menu-heading">Snapping</div>${menuItem("grid-snap", "Snap to grid", "", "check-circle")}${menuItem("object-snap", "Snap to objects", "", "check-circle")}${menuItem("build-snap", "Snap while building", "", "check-circle")}</div>`;
  }

  function settingsRow(title, description, control) {
    return `<div class="settings-row"><div><strong>${title}</strong><span>${description}</span></div><div>${control}</div></div>`;
  }

  function settingsMarkup() {
    return `<div id="settingsPanel" class="modal-scrim hidden"><section class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings"><header>${icon("gear-six")}<h2>Settings</h2><button id="settingsCloseBtn" class="icon-btn" aria-label="Close settings">${icon("x")}</button></header><div class="settings-layout"><nav role="tablist"><button class="settings-tab active" data-settings-tab="canvas">${icon("grid-four", "sm")}Canvas and grid</button><button class="settings-tab" data-settings-tab="snapping">${icon("magnet", "sm")}Snapping</button><button class="settings-tab" data-settings-tab="rules">${icon("shield-check", "sm")}Map rules</button><button class="settings-tab" data-settings-tab="multiplayer">${icon("users-three", "sm")}Multiplayer</button><button class="settings-tab" data-settings-tab="data">${icon("floppy-disk", "sm")}Import and export</button></nav><div class="settings-content">
      <section data-settings-pane="canvas"><h3>Canvas and grid</h3><p>Local workspace appearance.</p>${settingsRow("Theme", "Dark or light interface.", '<select id="themeSelect"><option value="dark">Dark</option><option value="light">Light</option></select>')}${settingsRow("Show grid", "Draw grid and origin axes.", switchControl("gridVisibleInput", "", true))}${settingsRow("Grid size", "Spacing in map units.", '<input id="gridSizeInput" type="number" value="48" min="4" max="1000" step="1">')}${settingsRow("Grid line thickness", "Line width in pixels.", '<input id="gridLineWidthInput" type="number" value="1" min="0.25" max="8" step="0.25">')}${settingsRow("Emphasise every 5th line", "Makes distances easier to count.", switchControl("gridMajorVisibleInput", "", true))}${settingsRow("Show origin axes", "Draw the 0,0 crosshair.", switchControl("originAxesVisibleInput", "", true))}</section>
      <section data-settings-pane="snapping" hidden><h3>Snapping</h3><p>Hold Ctrl to suspend snapping temporarily.</p>${settingsRow("Snap to grid", "Land on grid intersections.", switchControl("gridSnapEnabledInput", "", true))}${settingsRow("Snap to objects", "Align to nearby objects.", switchControl("objectSnapEnabledInput", "", true))}${settingsRow("Snap while building", "Use object snapping in Build.", switchControl("buildSnapEnabledInput", "", true))}${settingsRow("Snap strength", "Pull radius in map units.", '<input id="snapStrengthInput" type="number" value="20" min="1" step="1">')}</section>
      <section data-settings-pane="rules" hidden><h3>Map rules</h3><p>Values saved into the exported map.</p>${settingsRow("Spawn protection size", "spawn_protection_size", '<input id="spawnProtectionInput" type="number" value="500" step="0.1">')}</section>
      <section data-settings-pane="multiplayer" hidden><h3>Multiplayer</h3><p>Share a link for real-time editing.</p>${settingsRow("Display name", "Shown beside your cursor.", '<input id="usernameInput" type="text" maxlength="32" placeholder="Player">')}${settingsRow("Invite link", "Keep this tab open while hosting.", '<button id="hostSessionBtn" class="btn" type="button">Copy host link</button>')}</section>
      <section data-settings-pane="data" hidden><h3>Import and export</h3><p>Map files and saved shapes move independently.</p><div class="settings-actions"><button id="importBtn" class="btn" type="button">Import map</button><button id="exportBtn" class="btn primary" type="button">Export map</button><button id="importCustomShapesBtn" class="btn" type="button">Import saved shapes</button><button id="exportCustomShapesBtn" class="btn" type="button">Export saved shapes</button></div></section>
      </div></div></section></div>`;
  }

  function conversionMarkup() {
    return `<section id="deflyConversionPanel" class="conversion-panel hidden" aria-label="Map conversion"><h2>Convert map</h2><p>Editing is paused while the imported map updates live.</p><label>Object spacing (%)<input id="deflySpacingInput" type="number" min="1" max="1000" step="1" value="100"></label><label>Unit size<input id="deflyUnitSizeInput" type="number" min="0.1" max="1000" step="0.1" value="32"></label><label>Spawn protection size<input id="deflySpawnSizeInput" type="number" min="1" max="10000" step="10" value="500"></label><label>Tower clearance<input id="deflyTowerClearanceInput" type="number" min="0" max="5000" step="0.1" value="35.2"></label><label>Bomb clearance<input id="deflyBombClearanceInput" type="number" min="0" max="5000" step="1" value="250"></label><label>Boundary padding<input id="deflyBoundaryPaddingInput" type="number" min="0" max="5000" step="1" value="1"></label><p id="deflyConversionStatus" class="conversion-status">Preparing preview…</p><div class="button-row"><button id="finishDeflyConversionBtn" class="btn primary" type="button">Finish</button><button id="cancelDeflyConversionBtn" class="btn" type="button">Cancel</button></div></section>`;
  }

  function shortcut(label, key) { return `<div class="shortcut-row"><span>${label}</span><kbd>${key}</kbd></div>`; }

  function shortcutsMarkup() {
    return `<div id="shortcutsPanel" class="modal-scrim" hidden><section class="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><header>${icon("keyboard")}<h2>Keyboard shortcuts</h2><button id="shortcutsCloseBtn" class="icon-btn" aria-label="Close shortcuts">${icon("x")}</button></header><div class="shortcuts-grid"><section><h3>Tools</h3>${shortcut("Select and move", "1")}${shortcut("Draw boundary", "2")}${shortcut("Draw hole", "3")}${shortcut("Build", "4")}${shortcut("Place spawn", "5")}${shortcut("Place bomb site", "6")}${shortcut("Draw mirror axis", "7")}${shortcut("Shape library", "L")}</section><section><h3>Edit</h3>${shortcut("Undo", "Ctrl Z")}${shortcut("Redo", "Ctrl Y")}${shortcut("Copy", "Ctrl C")}${shortcut("Paste", "Ctrl V")}${shortcut("Delete", "Delete")}${shortcut("Cancel", "Esc")}</section><section><h3>View</h3>${shortcut("Show grid", "G")}${shortcut("Zoom to fit", "F")}${shortcut("Settings", "Ctrl ,")}${shortcut("Shortcuts", "?")}${shortcut("Pan", "W A S D")}</section><section><h3>Draw hole</h3>${shortcut("Close", "Enter")}${shortcut("Remove last vertex", "Backspace")}${shortcut("Cancel", "Esc")}</section></div></section></div>`;
  }

  function buildNewShell() {
    shellNew.innerHTML = `<div class="app"><header class="topbar"><div class="brand-name">Cosmowar Editor</div><nav class="menubar" aria-label="Main menu"><button class="menu-btn" data-menu="menuFile" aria-haspopup="true" aria-expanded="false">File</button><button class="menu-btn" data-menu="menuEdit" aria-haspopup="true" aria-expanded="false">Edit</button><button class="menu-btn" data-menu="menuView" aria-haspopup="true" aria-expanded="false">View</button></nav><span class="top-separator"></span><button class="icon-btn" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon("arrow-counter-clockwise")}</button><button class="icon-btn" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${icon("arrow-clockwise")}</button><span class="top-spacer"></span><button class="session-chip" id="sessionMenuBtn" type="button"><span class="live-dot"></span><span>Session</span></button><button class="icon-btn" id="themeToggleBtn" title="Switch theme" aria-label="Switch theme">${icon("sun")}</button><button class="icon-btn" id="settingsToggleBtn" title="Settings (Ctrl+,)" aria-label="Open settings">${icon("gear-six")}</button><button class="icon-btn" id="shortcutsToggleBtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${icon("keyboard")}</button></header>
      <div class="body"><nav class="toolrail" aria-label="Tools">${toolButton("select", "cursor", "Select and move", "1")}${toolButton("boundary", "bounding-box", "Draw boundary", "2")}${toolButton("hole", "polygon", "Draw hole", "3")}${toolButton("build", "castle-turret", "Build towers and walls", "4")}${toolButton("spawn", "flag-pennant", "Place spawn", "5")}${toolButton("bomb", "bomb", "Place bomb site", "6")}${toolButton("mirror", "flip-horizontal", "Draw mirror axis", "7")}<span class="rail-separator"></span><button class="library-button" id="shapeLibraryToggleBtn" type="button" title="Shape library (L)" aria-label="Shape library">${icon("shapes")}<span class="tool-key">L</span></button></nav>
      <div class="stage"><div class="canvas-wrap" id="newWorkspace">${optionsMarkup()}<aside class="shape-library" id="shapeLibrary" hidden aria-label="Shape library"><header><span>${icon("shapes")} Shape library</span><button class="icon-btn" id="shapeLibraryCloseBtn" aria-label="Close shape library">${icon("x", "sm")}</button></header><div class="library-body"><label class="library-name"><span>Shape name</span><input id="customShapeNameInput" type="text" maxlength="60" placeholder="e.g. Fortified corner"></label><button id="saveCustomShapeBtn" class="btn primary wide" type="button" disabled>${icon("plus", "sm")}Save selection</button><div id="customShapesList" class="shape-list" aria-live="polite"></div></div></aside></div><footer class="statusbar"><div class="status-message action-state idle" id="actionState" data-action-state aria-live="polite">Idle</div><div class="status-snapping"><span>Snapping</span><button id="statusGridSnap" class="status-chip" type="button">${icon("grid-four", "sm")}<span>Grid 48</span></button><button id="statusObjectSnap" class="status-chip" type="button">${icon("magnet", "sm")}<span>Objects</span></button></div><div id="cursorCoordinates" class="status-coordinates">X 0&nbsp;&nbsp;Y 0</div><button id="statusZoom" class="status-zoom" type="button">${icon("magnifying-glass", "sm")}<span>100%</span></button></footer></div>
      <div id="rightResizeHandle" class="inspector-resize-handle" role="separator" aria-label="Resize inspector" aria-orientation="vertical"></div><aside class="inspector right-sidebar" aria-label="Inspector"><header class="inspector-header">${icon("selection-plus")}<strong>Inspector</strong></header><div class="inspector-scroll">${conversionMarkup()}<div id="selectionPanel" class="selection-panel"></div></div></aside><div id="leftResizeHandle" hidden></div></div></div>${menusMarkup()}${settingsMarkup()}${shortcutsMarkup()}<button id="centerMapOriginBtn" type="button" hidden></button><button id="makeAllTowersInvincibleBtn" type="button" hidden></button><input type="file" id="importFileInput" accept=".json,.txt,application/json,text/plain" hidden><input type="file" id="customShapesFileInput" accept=".json,application/json" hidden>`;
  }

  prefixLegacyIds();
  buildNewShell();

  const newHost = document.getElementById("newWorkspace");
  const currentHost = shellCurrent.querySelector(".workspace");
  const modeButtons = Array.from(document.querySelectorAll("[data-ui-shell]"));
  let activeMenu = null;

  function closeMenus() { shellNew.querySelectorAll(".menu-popover").forEach((menu) => { menu.hidden = true; }); shellNew.querySelectorAll("[data-menu]").forEach((button) => button.setAttribute("aria-expanded", "false")); activeMenu = null; }
  function applyShell(shell, persist) { const next = shell === "current" ? "current" : "new"; const isNew = next === "new"; shellNew.hidden = !isNew; shellCurrent.hidden = isNew; const host = isNew ? newHost : currentHost; host.insertBefore(canvas, host.firstChild); modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.uiShell === next))); document.documentElement.dataset.uiShell = next; if (persist) globalThis.CosmowarEditorUI?.setShell?.(next); if (typeof globalThis.resizeCanvas === "function") globalThis.resizeCanvas(); closeMenus(); }
  function readInitialShell() { try { const preview = new URLSearchParams(location.search).get("shell"); if (preview === "current" || preview === "new") return preview; const saved = JSON.parse(localStorage.getItem("top_down_map_editor_session_v1") || "{}"); return saved?.editorSettings?.uiShell === "current" ? "current" : "new"; } catch (_error) { return "new"; } }
  function readInitialTheme() { try { const preview = new URLSearchParams(location.search).get("theme"); if (preview === "light" || preview === "dark") return preview; const saved = JSON.parse(localStorage.getItem("top_down_map_editor_session_v1") || "{}"); return saved?.editorSettings?.theme === "light" ? "light" : "dark"; } catch (_error) { return "dark"; } }
  function openMenu(button) { const menu = document.getElementById(button.dataset.menu); closeMenus(); if (!menu) return; const rect = button.getBoundingClientRect(); menu.style.left = `${rect.left}px`; menu.style.top = `${rect.bottom + 4}px`; menu.hidden = false; button.setAttribute("aria-expanded", "true"); activeMenu = menu.id; }
  function toggleCheckbox(id) { const input = document.getElementById(id); if (!input) return; input.checked = !input.checked; input.dispatchEvent(new Event("change", { bubbles: true })); }
  function runAction(action) { const api = globalThis.CosmowarEditorUI; const click = (id) => document.getElementById(id)?.click(); const actions = { "new-map": () => api?.newMap?.(), import: () => click("importBtn"), export: () => click("exportBtn"), "export-shapes": () => click("exportCustomShapesBtn"), "import-shapes": () => click("importCustomShapesBtn"), undo: () => api?.undo?.(), redo: () => api?.redo?.(), copy: () => api?.copy?.(), paste: () => api?.paste?.(), delete: () => api?.delete?.(), "select-matching": () => api?.selectMatching?.(), origin: () => click("centerMapOriginBtn"), invincible: () => click("makeAllTowersInvincibleBtn"), fit: () => api?.fit?.(), "grid-visible": () => toggleCheckbox("gridVisibleInput"), "grid-major": () => toggleCheckbox("gridMajorVisibleInput"), "origin-axes": () => toggleCheckbox("originAxesVisibleInput"), "grid-snap": () => toggleCheckbox("gridSnapEnabledInput"), "object-snap": () => toggleCheckbox("objectSnapEnabledInput"), "build-snap": () => toggleCheckbox("buildSnapEnabledInput") }; actions[action]?.(); closeMenus(); }
  function syncMirroredControl(source, target) { if (!source || !target) return; if ("checked" in source && (source.type === "checkbox" || source.type === "radio")) target.checked = source.checked; else if ("value" in source && "value" in target) target.value = source.value; else target.textContent = source.textContent; }

  function setupMirrors() {
    legacyIds.forEach((legacy, id) => {
      const canonical = document.getElementById(id);
      if (!canonical || legacy.dataset.mirrorView !== undefined || id === "actionState" || ["settingsToggleBtn", "settingsCloseBtn"].includes(id)) return;
      syncMirroredControl(canonical, legacy);
      legacy.addEventListener("input", () => { syncMirroredControl(legacy, canonical); canonical.dispatchEvent(new Event("input", { bubbles: true })); });
      legacy.addEventListener("change", () => { syncMirroredControl(legacy, canonical); canonical.dispatchEvent(new Event("change", { bubbles: true })); });
      if (legacy.tagName === "BUTTON") legacy.addEventListener("click", () => canonical.click());
      canonical.addEventListener("input", () => syncMirroredControl(canonical, legacy)); canonical.addEventListener("change", () => syncMirroredControl(canonical, legacy));
    });
    const legacySettings = legacyIds.get("settingsPanel");
    legacyIds.get("settingsToggleBtn")?.addEventListener("click", (event) => { event.stopImmediatePropagation(); legacySettings?.classList.toggle("hidden"); });
    legacyIds.get("settingsCloseBtn")?.addEventListener("click", (event) => { event.stopImmediatePropagation(); legacySettings?.classList.add("hidden"); });
  }

  function cloneView(id) {
    const source = document.getElementById(id); const target = legacyIds.get(id); if (!source || !target) return;
    if (id === "deflyConversionPanel") target.classList.toggle("hidden", source.classList.contains("hidden"));
    if (id === "selectionPanel" && source.querySelector?.(".empty")) {
      target.innerHTML = '<p class="muted">No selection yet.</p>';
      return;
    }
    target.innerHTML = source.innerHTML.replace(/id="([^"]+)"/g, (_all, childId) => `id="lgView${childId}" data-mirror="${childId}"`);
    target.querySelectorAll("[data-mirror]").forEach((legacyControl) => { const canonical = document.getElementById(legacyControl.dataset.mirror); if (!canonical) return; legacyControl.addEventListener("input", () => { syncMirroredControl(legacyControl, canonical); canonical.dispatchEvent(new Event("input", { bubbles: true })); }); legacyControl.addEventListener("change", () => { syncMirroredControl(legacyControl, canonical); canonical.dispatchEvent(new Event("change", { bubbles: true })); }); if (legacyControl.tagName === "BUTTON") legacyControl.addEventListener("click", () => canonical.click()); });
  }
  function observeView(id) { const source = document.getElementById(id); if (!source) return; new MutationObserver(() => cloneView(id)).observe(source, { childList: true, subtree: true, characterData: true, attributes: true }); cloneView(id); }
  function setTheme(theme, persist = true) { const next = theme === "light" ? "light" : "dark"; shellNew.dataset.theme = next; const select = document.getElementById("themeSelect"); if (select) select.value = next; document.querySelector("#themeToggleBtn use")?.setAttribute("href", next === "dark" ? "#i-sun" : "#i-moon"); if (persist) globalThis.CosmowarEditorUI?.setTheme?.(next); }

  modeButtons.forEach((button) => button.addEventListener("click", () => applyShell(button.dataset.uiShell, true)));
  shellNew.querySelectorAll("[data-menu]").forEach((button) => { button.addEventListener("click", (event) => { event.stopPropagation(); activeMenu === button.dataset.menu ? closeMenus() : openMenu(button); }); button.addEventListener("mouseenter", () => { if (activeMenu && activeMenu !== button.dataset.menu) openMenu(button); }); });
  shellNew.addEventListener("click", (event) => { const action = event.target.closest("[data-action]")?.dataset.action; if (action) runAction(action); });
  document.addEventListener("click", (event) => { if (!event.target.closest(".menu-popover, [data-menu]")) closeMenus(); });
  document.getElementById("themeToggleBtn").addEventListener("click", () => setTheme(shellNew.dataset.theme === "light" ? "dark" : "light"));
  document.getElementById("themeSelect").addEventListener("change", (event) => setTheme(event.target.value));
  document.getElementById("shortcutsToggleBtn").addEventListener("click", () => { document.getElementById("shortcutsPanel").hidden = false; }); document.getElementById("shortcutsCloseBtn").addEventListener("click", () => { document.getElementById("shortcutsPanel").hidden = true; });
  document.getElementById("shapeLibraryToggleBtn").addEventListener("click", () => { const library = document.getElementById("shapeLibrary"); library.hidden = !library.hidden; }); document.getElementById("shapeLibraryCloseBtn").addEventListener("click", () => { document.getElementById("shapeLibrary").hidden = true; });
  document.getElementById("statusZoom").addEventListener("click", () => runAction("fit")); document.getElementById("statusGridSnap").addEventListener("click", () => runAction("grid-snap")); document.getElementById("statusObjectSnap").addEventListener("click", () => runAction("object-snap")); document.getElementById("cancelHoleDraftBtn").addEventListener("click", () => globalThis.CosmowarEditorUI?.cancelDraft?.());
  [["selectObjectSnapProxy", "objectSnapEnabledInput"], ["selectGridSnapProxy", "gridSnapEnabledInput"]].forEach(([proxyId, canonicalId]) => {
    const proxy = document.getElementById(proxyId); const canonical = document.getElementById(canonicalId);
    proxy?.addEventListener("change", () => { canonical.checked = proxy.checked; canonical.dispatchEvent(new Event("change", { bubbles: true })); });
    canonical?.addEventListener("change", () => { proxy.checked = canonical.checked; });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.documentElement.dataset.uiShell !== "new") return;
    closeMenus(); document.getElementById("shortcutsPanel").hidden = true; document.getElementById("shapeLibrary").hidden = true;
  });
  [["leftResizeHandle", "left"], ["rightResizeHandle", "right"]].forEach(([id, side]) => {
    const handle = legacyIds.get(id); if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (document.documentElement.dataset.uiShell !== "current" || window.matchMedia("(max-width: 980px)").matches) return;
      event.preventDefault(); const app = shellCurrent.querySelector(".app-shell"); const panel = shellCurrent.querySelector(`.${side}-sidebar`); const startX = event.clientX; const startWidth = panel.getBoundingClientRect().width;
      const move = (moveEvent) => { const delta = moveEvent.clientX - startX; const width = Math.max(210, Math.min(620, Math.round(side === "left" ? startWidth + delta : startWidth - delta))); app.style.setProperty(`--${side}-sidebar-width`, `${width}px`); globalThis.resizeCanvas?.(); };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
  });
  shellNew.querySelectorAll(".health-pip").forEach((button) => button.addEventListener("click", () => { const input = document.getElementById("towerHealthInput"); input.value = button.dataset.health; input.dispatchEvent(new Event("change", { bubbles: true })); shellNew.querySelectorAll(".health-pip").forEach((pip) => pip.classList.toggle("active", pip === button)); }));
  shellNew.querySelectorAll(".settings-tab").forEach((button) => button.addEventListener("click", () => { shellNew.querySelectorAll(".settings-tab").forEach((tab) => tab.classList.toggle("active", tab === button)); shellNew.querySelectorAll("[data-settings-pane]").forEach((pane) => { pane.hidden = pane.dataset.settingsPane !== button.dataset.settingsTab; }); }));
  setupMirrors(); ["selectionPanel", "customShapesList", "deflyConversionPanel"].forEach(observeView); applyShell(readInitialShell(), false); setTheme(readInitialTheme(), false);
  globalThis.CosmowarUIShell = { get current() { return document.documentElement.dataset.uiShell || "new"; }, set: (shell) => applyShell(shell, true), setTheme, closeLibrary: () => { document.getElementById("shapeLibrary").hidden = true; }, toggleLibrary: () => document.getElementById("shapeLibraryToggleBtn").click(), openShortcuts: () => { document.getElementById("shortcutsPanel").hidden = false; }, closeOverlays: () => { closeMenus(); document.getElementById("shortcutsPanel").hidden = true; } };
}());

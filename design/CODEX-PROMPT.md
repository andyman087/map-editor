# Task: rebuild the Cosmowar Map Editor interface, leaving the map engine untouched

## The repository

A vanilla-JS, no-build web app. Open `index.html` directly; there is no bundler.

| File | Role |
|---|---|
| `index.html` | The entire markup: two sidebars, a canvas, a floating settings sheet |
| `styles.css` | All styling (~14 KB) |
| `app.js` | ~313 KB. Map state, rendering, tools, undo, import/export, multiplayer |
| `defly-import.js` | Parses foreign map files |
| `map-hole-geometry.js` | Hole geometry helpers |
| `tests/*.test.js` | Run with `npm test` (`node --test`) |

## What this task is, in one sentence

Replace the interface *around* the map with a new one, keep a toggle so either interface can be used, and change nothing about the map itself.

---

## 1. Hard constraints: what must not change

**Do not touch the map view or any map logic. Not one bit.** Specifically, leave these completely alone:

- `resizeCanvas()`, `draw()`, `drawGrid()`, `drawBoundary()`, `drawHoles()`, `drawBoundaryFogMask()`, and every other `draw*` function. The canvas must render pixel-for-pixel identically.
- All pointer/wheel/keyboard handling that acts on the canvas: panning, zooming, box select, dragging, the rotate handle, the scale handles, vertex editing.
- `setMode()`, snapping maths, `withAction()`, the undo/redo history, `state`, `defaults`, `mirrorState`, `view`, `viewport`, `interaction`.
- Import, export, validation, Defly conversion, and the multiplayer/PeerJS layer.
- `const canvas = document.getElementById("mapCanvas")` at `app.js:2`. Same element, same id, same reference.

There is exactly one sanctioned exception, described under the View menu in section 2: a single `if (editorSettings.gridVisible)` guard on the `drawGrid()` call inside `draw()`. Nothing else in the draw path may change.

If a change appears to require editing any of the above beyond that one guard, stop and flag it rather than proceeding. The only acceptable edits to map-adjacent code are ones that read from or write to a differently-shaped DOM.

**Things that are already correct. Do not "improve" them:**

- **Bomb site letters already auto-assign.** `nextBombSiteLetter()` at `app.js:7238` returns the first unused letter (A, B, … Z, AA), and placement at `app.js:2846` already calls it. Keep that function exactly as is.
- **Conversion already starts automatically on import.** `importMap()` at `app.js:5840` calls `beginDeflyConversion()` for `.txt` files. There is no manual convert button today and none should be added.
- **Draw Hole already closes when you click the first vertex.** Do not add a "close shape" button and do not alter the hole drafting logic.
- `Enter` closes a hole draft, `Backspace` removes the last vertex, `Esc` cancels. Keep all three.

---

## 2. What to build

Two interface shells that share one canvas and one application state, plus a toggle to switch between them.

- Shell A, **"New"** — the redesign. Default.
- Shell B, **"Current"** — today's interface, unchanged.

The toggle is a two-segment control at the top centre labelled exactly `Current` and `New`. The choice persists across reloads.

### The New shell

```
┌──────────────────────────────────────────────────────────────────┐
│ Cosmowar Editor │ File Edit View │ ↶ ↷        session ☀ ⚙ ⌨      │  52px
├────┬────────────────────────────────────────────┬────────────────┤
│ 1  │ ┌────────────────────────────────┐         │                │
│ 2  │ │ contextual options for the      │        │   INSPECTOR    │
│ 3  │ │ active tool only                │        │                │
│ 4  │ └────────────────────────────────┘         │  what is       │
│ 5  │                                             │  selected and  │
│ 6  │              CANVAS (unchanged)             │  its fields    │
│ 7  │                                             │                │
│ L  │                                             │                │
│    ├────────────────────────────────────────────┤                │
│    │ message      │ Snapping [Grid 48][Objects] │ x,y │ zoom │    │  28px
└────┴────────────────────────────────────────────┴────────────────┘
```

**Tool rail (52px, left).** The seven existing tools as icons, keyboard `1`-`7`, plus a shape library button on `L`. Replaces the seven full-width text buttons.

**Contextual tool options (floating, top-left of canvas).** Only the active tool's options are present in the DOM-visible sense:

| Tool | Options shown |
|---|---|
| Select and move | object snap, grid snap, hint text |
| Draw boundary | preset select, width, height, "Replace boundary" |
| Draw hole | live vertex count, Cancel, hint text |
| Build | team, health 1-4, invincible, hint text |
| Place spawn | team (Blue/Red only) |
| Place bomb site | read-only "next site" letter, hint text |
| Draw mirror axis | axis action, live mirroring, mirror once, axis count, clear axes |

This is the core of the redesign: the old **Mirroring**, **Map Shape** and **Defaults** panels stop existing as permanent panels. Their controls move into the tool that uses them.

**Menu bar.** `File`, `Edit`, `View`. Click to open, hover to move between them while open, click-away and `Esc` to close.

- **File** — New map, Import map, Export map, then Export saved shapes, Import saved shapes
- **Edit** — Undo, Redo, Copy, Paste, Delete, Select matching objects, Move map to origin, Make all towers invincible
- **View** — Zoom to fit map (F), then Grid (show grid `G`, emphasise every 5th line, show origin axes), then Snapping (snap to grid, snap to objects, snap while building)

Note: **the only new visibility setting is `Show grid`.** Add `gridVisible: true` to `editorSettings` and guard the existing `drawGrid()` call inside `draw()` with it. That is a single line, and it is the same pattern `drawGrid()` already uses internally for `gridMajorVisible` (`app.js:4855`) and `originAxesVisible` (`app.js:4896`). This one guard is explicitly permitted. Everything else in the View menu maps to a setting that already exists.

Do **not** add visibility toggles for spawn protection zones or mirror axes. An earlier draft of this spec listed them; that was wrong. Spawn zones are drawn inline inside `drawSpawns()` and hiding them would conceal a placement constraint. Mirror axes are selectable and draggable, so hiding them would leave invisible objects that still respond to the pointer. Both are out of scope.

Note: `Move map to origin` is the existing `centerMapOriginBtn`. It edits map geometry, so it belongs in Edit, not View. Keep its existing behaviour and its place in undo history; only the label and location change.

**Inspector (right, resizable).** Sole job is the current selection. Sections: Position, Appearance, Properties, then a destructive action. Empty state shows a map summary. Multi-select shows contents, apply-to-all, and towers-only groups.

**Status bar (28px, under the canvas).** Message, a `Snapping` group with two state chips, cursor coordinates, zoom. The chips read filled when on and outlined when off. Do not repeat the tool name here; the options bar already shows it.

**Shape library (flyout on `L`).** The existing Custom Shapes panel, saved shapes only. Boundary presets do not belong here; they live in the Draw boundary tool options.

**Settings modal.** Five tabs: Canvas and grid, Snapping, Map rules, Multiplayer, Import and export. Replaces the sheet that floats over the canvas. File actions move to the File menu.

**Shortcuts overlay on `?`.** Replaces the 17-item Quick Help list in the right sidebar.

**Light and dark themes** driven by CSS custom properties, with a toggle in the top bar. Sun icon in dark mode, moon in light. If this needs to be cut for scope, cut it last and ship dark only.

---

## 3. Architecture: how to avoid breaking `app.js`

`app.js` reaches into the DOM two ways. Respect the difference and most of the wiring survives untouched.

### Class hooks may exist in both shells

`app.js:56` builds its `el` cache with, among others:

```js
toolButtons: Array.from(document.querySelectorAll(".tool-button")),
teamSwatches: Array.from(document.querySelectorAll(".team-swatch")),
```

Because these are collected by class, **give the New shell's tool rail buttons `class="tool-button"` and `data-tool="..."`, and its team pickers `class="team-swatch"` and `data-team="..."`**. Both shells then get picked up automatically. `app.js:1522` binds clicks on all of them and `app.js:1771` syncs the `active` class on all of them, so the two shells stay in step with zero logic changes. Style them separately with a shell-scoped selector.

### Id hooks must exist exactly once, and live in the New shell

Every `document.getElementById(...)` in the `el` cache must resolve. So:

1. **Move each id-bearing control into its new home in the New shell**, keeping the id byte-for-byte identical. For example `gridSizeInput` moves into the Settings modal, `mirrorLiveInput` into the Mirror tool options, `towerHealthInput` into the Build tool options, `customShapeNameInput` into the library flyout, the `defly*` inputs into the Inspector when a conversion is active.
2. **Give the Current shell's copies prefixed ids** (`lgGridSizeInput`, etc.) so nothing collides, and add `data-mirror="gridSizeInput"`.
3. In a new file `ui-shell.js`, write a small two-way mirror: a change on a `[data-mirror]` control copies its value to the real control and dispatches `new Event("change", { bubbles: true })`; a change on the real control copies back. This adapter only serves the comparison view, so it stays small and low-risk.

Do not put the indirection on the New shell. The New shell is the product going forward and should own the canonical ids.

### One canvas, re-parented

Keep a single `<canvas id="mapCanvas">`. On toggle, move that same element into the active shell's workspace container with `insertBefore(canvas, host.firstChild)`, then call `resizeCanvas()`. Because `resizeCanvas()` measures with `canvas.getBoundingClientRect()`, this works without touching it. All canvas listeners live on the canvas element itself, so they travel with it.

Insert it as the **first** child so overlays layered after it stay on top.

### CSS isolation

Both shells are in the DOM at once, one hidden. Their stylesheets must not bleed into each other.

- Wrap the current markup in `#shellCurrent` and prefix every existing rule in `styles.css` with it. Map `:root`, `html` and `body` selectors onto `#shellCurrent` itself so its custom properties stay local.
- Scope the new generic element rules (`input`, `select`, `button`, `kbd`, `svg`) under `#shellNew` so they cannot restyle the Current view. Getting this wrong makes the comparison a lie.
- Rename the existing `toastIn` / `toastOut` keyframes if the new stylesheet also defines animations by those names.

---

## 4. Changes required inside `app.js`

These are all view-layer functions. Rewrite the markup they emit; keep every binding, every `withAction(...)` call and every id they bind to.

1. **`renderSelectionPanel` and its family** (`app.js` ~3900-4170: `renderMultiSelection`, `renderTowerSelection`, `renderSpawnSelection`, `renderBombSelection`, `renderWallSelection`, `renderBoundarySelection`, `renderHoleSelection`, `renderHoleVertexSelection`, `renderStructureSelection`). Emit the new grouped Inspector markup. Keep `bindNumericChange`, `bindTeamSwatchGroup`, `bindSnapToggle`, `deleteSelected` and the input ids (`selTowerX`, `selSpawnY`, …) exactly as they are.

2. **Delete the bomb site letter input.** `app.js:4179` renders `<input id="selBombLetter">` and `app.js:4188` binds it. Remove both. Render the letter as a read-only value instead. The letter is derived by `nextBombSiteLetter()` and should not be typeable.

3. **`snapToggleMarkup()`** (`app.js:3870`). New switch markup, same `selSnapEnabled` id so `bindSnapToggle()` keeps working.

4. **`renderCustomShapes()`** (`app.js:3534`). Emit the new shape-card markup for the library flyout.

5. **`setActionState()`** (`app.js`, writes to `el.actionState`). Generalise it to write text and the tone class to **every** element matching `[data-action-state]`, then put that attribute on the New shell's status-bar message and the Current shell's `.action-state` box. Keep the signature and the 2200 ms auto-reset.

6. **`updateMirrorStatus()`** (`app.js:6472`). Keep the logic; retarget the text to whatever element the Mirror tool options bar uses, and keep the three `disabled` assignments working against controls that exist.

7. **`editorSettings`** (`app.js`) and `saveSession()`. Add `uiShell: "new" | "current"` and `theme: "dark" | "light"`, and restore them on load. Follow the existing pattern; do not change the storage key or version.

8. **Keyboard.** Add `1`-`7` for tools, `L` for the library, `G` for grid, `F` for zoom-to-fit, `?` for the shortcuts overlay, `Ctrl+,` for settings. Guard the New-shell-only ones so they do nothing while the Current shell is active. Every existing shortcut keeps working: `Ctrl+Z`, `Ctrl+Y`, `Ctrl+C`, `Ctrl+V`, `Delete`, `Esc`, `Enter`, `Backspace`, WASD and arrows, and the `isTypingInFormControl()` guard.

9. **Panel resize handles.** `leftResizeHandle` and `rightResizeHandle` must both stay in the DOM so `el` lookups do not go null. In the New shell only the Inspector handle is visible; wire it to the Inspector column width. The tool rail is fixed width.

---

## 5. Icons

Use Phosphor, installed properly: `npm i @phosphor-icons/core`, then inline the regular-weight SVGs you need as a `<symbol>` sprite and reference them with `<use href="#i-name">`. Do not hand-draw icon paths. Do not add a CDN script tag; the app must keep working from `file://`.

The attached prototype already contains a working sprite built this way. Reuse it.

---

## 6. The attached prototype

`ui-prototype.html` is a self-contained, working prototype of the New shell. **Treat it as the visual and interaction specification**, not as code to paste.

Take from it: the token system and both palettes, the layout and spacing, the component styling, every menu and its item ordering, the tool options for each tool, the Inspector section grouping, the status bar, the settings modal, the shortcuts overlay, the library flyout, the icon sprite.

Ignore in it: the sample map data, its stand-in canvas renderer, the stubbed actions (undo, export, mirroring and multiplayer all just print messages), the "What changed" drawer, and the way it duplicates the old stylesheet inline. The real app has all of that logic already.

The prototype also carries the same Current/New toggle, so you can see the intended switching behaviour directly.

---

## 7. Acceptance checks

Functional, must all pass by hand:

- [ ] `npm test` passes with no new failures.
- [ ] The canvas renders identically to `main` in both shells, with `Show grid` on. Compare screenshots at the same zoom and pan.
- [ ] Toggling `Show grid` hides only the grid and the origin axes drawn by `drawGrid()`. Everything else on the canvas is unaffected.
- [ ] Every tool behaves exactly as before: draw a boundary, draw a hole and close it by clicking the first vertex, build a chain of towers and walls, place both spawns, place bomb sites and confirm the letters still auto-assign, draw a mirror axis and use both live and once modes.
- [ ] Select, multi-select with Shift, box select, double-click to select matching, move, rotate, scale. All unchanged.
- [ ] Undo and redo across at least ten mixed operations.
- [ ] Export a map, reimport it, confirm it round-trips. Import a `.txt` and confirm conversion still opens on its own.
- [ ] Save a custom shape, reload the page, confirm it is still there.
- [ ] A multiplayer session still connects and syncs.
- [ ] Toggle to Current, do a full edit, toggle back to New. Selection, camera, tool and undo history all survive.
- [ ] Reload and confirm the shell choice and theme were remembered.

Interface, must all be true:

- [ ] No control appears in two places in the New shell.
- [ ] Every id in the `el` cache at `app.js:56` resolves to exactly one element.
- [ ] The Current shell looks and behaves exactly as it does on `main`.
- [ ] Menu bar fits on one line and the top bar is 52px.
- [ ] Every interactive element is reachable by keyboard and shows a visible focus ring.
- [ ] Text meets WCAG AA contrast in both themes, including hint text, placeholders and the status bar.
- [ ] No console errors or warnings on load, on toggle, or during a full edit session.

---

## 8. How to work

Commit in this order so each step is reviewable and revertable:

1. Shell scaffolding: wrap the current markup, scope its CSS, add the empty New shell, the toggle, canvas re-parenting, and persistence. **At this commit the Current shell must be fully working and visually identical to `main`.**
2. New shell chrome: tokens, top bar, tool rail, menus, status bar.
3. Tool options bar, and remove the Mirroring, Map Shape and Defaults panels from the New shell.
4. Inspector: the `renderSelectionPanel` family.
5. Settings modal, library flyout, shortcuts overlay.
6. Themes, then a polish pass against the acceptance checks.

Keep each commit's diff to `app.js` as small as the step allows. If a step tempts you into the rendering or interaction code listed in section 1, stop and raise it instead.

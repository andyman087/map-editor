
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const HOLE_GEOMETRY = globalThis.MapHoleGeometry;

if (!HOLE_GEOMETRY) throw new Error("Map hole geometry helpers failed to load.");

const GAME = {
  SNAP_THRESHOLD: 20,
  ROTATION_SNAP_DEGREES: 45,
  ROTATION_SNAP_THRESHOLD_DEGREES: 5,
  WALL_THICKNESS: 32,
  TOWER_DIAMETER: 70.4,
  TOWER_MAX_HEALTH: 4,
  KEYBOARD_PAN_SPEED: 700,
  SPAWN_SIZE: 100,
  BOMB_DIAMETER: 500,
  MIN_ZOOM: 0.08,
  MAX_ZOOM: 4,
};

const COLORS = {
  bg: "#0D0F17",
  terrain: "#0D0F17",
  gridMinor: "#2E3842",
  gridMajor: "#526679",
  boundary: "#2E3842",
  boundaryFog: "rgba(2, 6, 14, 0.62)",
  holeRim: "#2E3842",
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
const SESSION_STORAGE_KEY = "top_down_map_editor_session_v1";
const PANEL_LAYOUT_STORAGE_KEY = "top_down_map_editor_panel_layout_v1";
const MULTIPLAYER_USERNAME_KEY = "top_down_map_editor_username";
const CUSTOM_SHAPES_STORAGE_KEY = "top_down_map_editor_custom_shapes_v1";
const CUSTOM_SHAPES_FILE_TYPE = "cosmowar-custom-shapes";
const MULTIPLAYER_COLLECTIONS = [
  { key: "map_boundaries", type: "boundary", prefix: "boundary" },
  { key: "map_holes", type: "hole", prefix: "hole" },
  { key: "spawn_points", type: "spawn", prefix: "spawn" },
  { key: "bomb_sites", type: "bomb", prefix: "bomb" },
  { key: "towers", type: "tower", prefix: "tower" },
  { key: "structures", type: "structure", prefix: "structure" },
  { key: "walls", type: "wall", prefix: "wall" },
];

const el = {
  appShell: document.querySelector(".app-shell"),
  leftSidebar: document.querySelector(".left-sidebar"),
  rightSidebar: document.querySelector(".right-sidebar"),
  leftResizeHandle: document.getElementById("leftResizeHandle"),
  rightResizeHandle: document.getElementById("rightResizeHandle"),
  toolButtons: Array.from(document.querySelectorAll(".tool-button")),
  teamSwatches: Array.from(document.querySelectorAll(".team-swatch")),
  selectionPanel: document.getElementById("selectionPanel"),
  settingsToggleBtn: document.getElementById("settingsToggleBtn"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  spawnProtectionInput: document.getElementById("spawnProtectionInput"),
  snapStrengthInput: document.getElementById("snapStrengthInput"),
  objectSnapEnabledInput: document.getElementById("objectSnapEnabledInput"),
  buildSnapEnabledInput: document.getElementById("buildSnapEnabledInput"),
  gridSnapEnabledInput: document.getElementById("gridSnapEnabledInput"),
  gridSizeInput: document.getElementById("gridSizeInput"),
  gridLineWidthInput: document.getElementById("gridLineWidthInput"),
  gridMajorVisibleInput: document.getElementById("gridMajorVisibleInput"),
  originAxesVisibleInput: document.getElementById("originAxesVisibleInput"),
  centerMapOriginBtn: document.getElementById("centerMapOriginBtn"),
  mirrorTransformType: document.getElementById("mirrorTransformType"),
  mirrorLiveInput: document.getElementById("mirrorLiveInput"),
  mirrorStatus: document.getElementById("mirrorStatus"),
  applyMirrorSelectionBtn: document.getElementById("applyMirrorSelectionBtn"),
  removeLastMirrorBtn: document.getElementById("removeLastMirrorBtn"),
  clearMirrorAxesBtn: document.getElementById("clearMirrorAxesBtn"),
  mapPresetSelect: document.getElementById("mapPresetSelect"),
  mapPresetWidth: document.getElementById("mapPresetWidth"),
  mapPresetHeight: document.getElementById("mapPresetHeight"),
  applyMapPresetBtn: document.getElementById("applyMapPresetBtn"),
  customShapeNameInput: document.getElementById("customShapeNameInput"),
  saveCustomShapeBtn: document.getElementById("saveCustomShapeBtn"),
  customShapesList: document.getElementById("customShapesList"),
  exportCustomShapesBtn: document.getElementById("exportCustomShapesBtn"),
  importCustomShapesBtn: document.getElementById("importCustomShapesBtn"),
  customShapesFileInput: document.getElementById("customShapesFileInput"),
  deflyConversionPanel: document.getElementById("deflyConversionPanel"),
  deflySpacingInput: document.getElementById("deflySpacingInput"),
  deflyUnitSizeInput: document.getElementById("deflyUnitSizeInput"),
  deflySpawnSizeInput: document.getElementById("deflySpawnSizeInput"),
  deflyTowerClearanceInput: document.getElementById("deflyTowerClearanceInput"),
  deflyBombClearanceInput: document.getElementById("deflyBombClearanceInput"),
  deflyBoundaryPaddingInput: document.getElementById("deflyBoundaryPaddingInput"),
  deflyConversionStatus: document.getElementById("deflyConversionStatus"),
  finishDeflyConversionBtn: document.getElementById("finishDeflyConversionBtn"),
  cancelDeflyConversionBtn: document.getElementById("cancelDeflyConversionBtn"),
  usernameInput: document.getElementById("usernameInput"),
  hostSessionBtn: document.getElementById("hostSessionBtn"),
  multiplayerToastStack: document.getElementById("multiplayerToastStack"),
  towerHealthInput: document.getElementById("towerHealthInput"),
  towerInvincibleInput: document.getElementById("towerInvincibleInput"),
  makeAllTowersInvincibleBtn: document.getElementById("makeAllTowersInvincibleBtn"),
  cursorCoordinates: document.getElementById("cursorCoordinates"),
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
let invalidObjectWarningCount = 0;
let editorClipboard = null;
let multiplayerManager = null;
let panelResize = null;
let activeValidationReport = null;
let activeLiveMirrorPreviewModel = null;
let conversionSession = null;
let customShapes = [];
const keyboardPanKeys = new Set();
let lastFrameTime = null;

let state = createInitialState();
const selection = new Set();
const history = { undo: [], redo: [], limit: 220 };

const defaults = {
  defaultTeam: 0,
  towerHealth: GAME.TOWER_MAX_HEALTH,
  towerInvincible: false,
};

const editorSettings = {
  snapStrength: GAME.SNAP_THRESHOLD,
  objectSnapEnabled: true,
  buildModeSnapEnabled: true,
  gridSnapEnabled: true,
  gridSize: 48,
  gridLineWidth: 1,
  gridMajorVisible: true,
  originAxesVisible: true,
};

const mirrorState = {
  axes: [],
  liveEnabled: false,
  applying: false,
};

const view = { scale: 0.32, offsetX: 130, offsetY: 80 };
let restoredViewFromSession = false;
const viewport = { width: 1, height: 1, dpr: 1 };

const interaction = {
  mode: "select",
  mouseScreen: { x: 0, y: 0 },
  mouseWorld: { x: 0, y: 0 },
  isPanning: false,
  panStartMouse: null,
  panStartOffset: null,
  drag: null,
  rotate: null,
  resize: null,
  boxSelect: null,
  wallDraft: null,
  hoverTowerId: null,
  buildGhost: null,
  placementGhost: null,
  pasteDraft: null,
  snapTemporarilyDisabled: false,
  towerDraftWarnActive: false,
  wallDraftWarnActive: false,
  snapEnabled: true,
  mirrorDraft: null,
  mirrorAxisDrag: null,
  selectedMirrorAxisIndex: null,
  holeDraft: null,
  guides: { x: null, y: null, xPoints: [], yPoints: [] },
};

class MultiplayerManager {
  constructor() {
    this.role = "offline";
    this.peer = null;
    this.localPeerId = "";
    this.hostPeerId = "";
    this.hostConn = null;
    this.connections = new Map();
    this.connectedPeers = {};
    this.actionSequence = 0;
    this.actionQueue = [];
    this.processingQueue = false;
    this.isApplyingRemote = false;
    this.lastCursorSentAt = 0;
    this.retryTimer = null;
    this.heartbeatTimer = null;
    this.hostWatchTimer = null;
    this.lastHostHeartbeatAt = 0;
    this.migrationInProgress = false;
    this.reconnectTarget = "";
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 24;
    this.lastToast = { text: "", at: 0 };
    this.succession = new SuccessionLogic(this);
    this.validator = new ActionValidator(this);
    this.rollback = new RollbackHandler(this);
  }

  bindUI() {
    if (!el.usernameInput) return;
    el.usernameInput.value = this.getUsername();
    el.usernameInput.addEventListener("change", () => {
      const username = this.getUsername();
      localStorage.setItem(MULTIPLAYER_USERNAME_KEY, username);
      this.updateLocalPeerMeta();
      this.broadcastPeerList();
      this.setStatus(`Username set to ${username}`);
    });
    el.hostSessionBtn?.addEventListener("click", () => this.copyOrCreateHostLink());
    this.autofillAndAutoJoinFromUrl();
    this.updateUi();
  }

  getUsername() {
    const raw = el.usernameInput?.value || localStorage.getItem(MULTIPLAYER_USERNAME_KEY) || "Player";
    return String(raw).trim().slice(0, 32) || "Player";
  }

  shouldUseTemporaryIds() {
    return this.role === "client" && !this.isApplyingRemote;
  }

  copyOrCreateHostLink() {
    if ((this.role === "host" && this.localPeerId) || (this.role === "client" && this.hostPeerId)) {
      this.copyHostLink();
      return;
    }
    this.hostSession({ copyOnOpen: true });
  }

  hostSession(options = {}) {
    if (!this.ensurePeerJs()) return;
    this.closeExistingConnections();
    this.role = "hosting";
    this.setStatus("Starting host session...");
    this.peer = new Peer();
    this.attachPeerEvents();
    this.peer.on("open", (id) => {
      this.role = "host";
      this.localPeerId = id;
      this.hostPeerId = id;
      this.succession.set([id]);
      this.updateLocalPeerMeta();
      this.updateInviteLink();
      this.startHostServices();
      this.updateUi();
      if (options.copyOnOpen) this.copyHostLink();
      else this.setStatus("Hosting. Use Copy host link to invite others.", "success");
    });
  }

  joinSession(hostId, options = {}) {
    const cleanHostId = String(hostId || "").trim();
    if (!cleanHostId) {
      this.setStatus("No host id found in the invite link.", "warn");
      return;
    }
    if (!this.ensurePeerJs()) return;
    if (!options.reconnect) this.closeExistingConnections();
    this.role = "client";
    this.hostPeerId = cleanHostId;
    this.startHostWatchdog();
    this.stopHostServices();
    this.lastHostHeartbeatAt = Date.now();
    this.setStatus(options.reconnect ? `Reconnecting to new host ${cleanHostId}...` : `Joining ${cleanHostId}...`);
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer();
      this.attachPeerEvents();
      this.peer.on("open", (id) => {
        this.localPeerId = id;
        this.connectToHost(cleanHostId, options);
      });
    } else if (this.peer.open) {
      this.connectToHost(cleanHostId, options);
    } else {
      this.peer.once("open", (id) => {
        this.localPeerId = id;
        this.connectToHost(cleanHostId, options);
      });
    }
    this.updateUi();
  }

  connectToHost(hostId, options = {}) {
    if (!this.peer || !this.peer.open) return;
    if (options.reconnect) {
      this.reconnectTarget = hostId;
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts > this.maxReconnectAttempts) {
        this.role = "offline";
        this.migrationInProgress = false;
        this.setStatus("Session disconnected. Host migration could not reconnect.", "error");
        this.updateUi();
        return;
      }
    }
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
    }
    this.hostPeerId = hostId;
    const conn = this.peer.connect(hostId, {
      reliable: true,
      metadata: {
        username: this.getUsername(),
        migration: Boolean(options.reconnect),
        previousHostId: options.previousHostId || "",
      },
    });
    this.hostConn = conn;
    let handledClose = false;
    conn.on("open", () => {
      this.lastHostHeartbeatAt = Date.now();
      this.safeSend(conn, { type: "peer_meta", username: this.getUsername() });
      this.setStatus(`Connected to host ${hostId}. Waiting for map state...`, options.reconnect ? "success" : "idle");
      this.updateUi();
      if (options.reconnect) {
        this.scheduleReconnect(hostId, "Waiting for migrated host to send map state...");
      }
    });
    conn.on("data", (payload) => this.handleHostData(payload));
    conn.on("close", () => {
      if (conn._manualClose) return;
      if (handledClose) return;
      handledClose = true;
      this.handleHostConnectionLost();
    });
    conn.on("error", () => {
      if (conn._manualClose) return;
      if (handledClose) return;
      handledClose = true;
      this.handleHostConnectionLost();
    });
    if (options.reconnect) {
      this.scheduleReconnect(hostId, "Trying the next host again...");
    }
  }

  promoteToHost(previousList) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopHostWatchdog();
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
    }
    this.role = "host";
    this.hostPeerId = this.localPeerId;
    this.hostConn = null;
    this.connections.clear();
    this.connectedPeers = {};
    this.migrationInProgress = false;
    this.reconnectTarget = "";
    this.reconnectAttempts = 0;
    if (this.peer?.disconnected && !this.peer.destroyed) {
      try {
        this.peer.reconnect();
      } catch (error) {
        console.warn("Peer reconnect during host migration failed", error);
      }
    }
    const nextList = [this.localPeerId, ...previousList.slice(2).filter((id) => id !== this.localPeerId)];
    this.succession.set(nextList);
    this.updateLocalPeerMeta();
    this.updateInviteLink();
    this.startHostServices();
    this.updateUi();
    this.setStatus("Host migrated. You are now the host.", "success");
  }

  attachPeerEvents() {
    if (!this.peer) return;
    this.peer.on("connection", (conn) => this.acceptIncomingConnection(conn));
    this.peer.on("error", (error) => this.setStatus(`Peer error: ${error.type || error.message}`, "warn"));
    this.peer.on("disconnected", () => this.setStatus("Peer server disconnected; existing P2P links may remain open.", "warn"));
  }

  acceptIncomingConnection(conn) {
    if (this.role !== "host") {
      conn.on("open", () => this.safeSend(conn, { type: "join_reject", reason: "This peer is not the active host." }));
      return;
    }
    const peerId = conn.peer;
    const existing = this.connections.get(peerId);
    if (existing && existing !== conn) {
      existing._manualClose = true;
      existing.close();
    }
    this.connections.set(peerId, conn);
    this.connectedPeers[peerId] = {
      peerId,
      username: conn.metadata?.username || `Peer ${peerId.slice(0, 5)}`,
      color: this.colorForPeer(peerId),
      role: "client",
    };
    conn.on("open", () => {
      this.succession.add(peerId);
      this.sendFullState(conn);
      this.broadcastSuccession();
      this.broadcastPeerList();
      const joinedFromMigration = conn.metadata?.migration ? " after host migration" : "";
      this.setStatus(`Peer joined${joinedFromMigration}: ${this.connectedPeers[peerId].username}`, "success");
    });
    conn.on("data", (payload) => this.handleClientData(conn, payload));
    conn.on("close", () => this.removeClient(peerId, conn));
    conn.on("error", () => this.removeClient(peerId, conn));
  }

  removeClient(peerId, conn = null) {
    if (conn && this.connections.get(peerId) !== conn) return;
    if (!this.connections.has(peerId) && !this.connectedPeers[peerId]) return;
    const username = this.connectedPeers[peerId]?.username || peerId;
    this.connections.delete(peerId);
    delete this.connectedPeers[peerId];
    this.succession.remove(peerId);
    this.broadcastSuccession();
    this.broadcastPeerList();
    this.setStatus(`Peer left: ${username}`, "warn");
  }

  handleHostConnectionLost(reason = "Host connection lost.") {
    if (this.role !== "client") return;
    if (this.migrationInProgress) return;
    this.migrationInProgress = true;
    const list = this.succession.list.slice();
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
      this.hostConn = null;
    }
    this.setStatus(`${reason} Checking host succession...`, "warn");
    this.succession.handleHostLost(list);
  }

  handleClientData(conn, payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "action_request") this.enqueueActionRequest(conn, payload);
    else if (payload.type === "cursor_move") this.receiveClientCursor(conn.peer, payload);
    else if (payload.type === "peer_meta") {
      this.connectedPeers[conn.peer] = {
        ...(this.connectedPeers[conn.peer] || {}),
        peerId: conn.peer,
        username: payload.username || conn.peer,
        color: this.colorForPeer(conn.peer),
        role: "client",
      };
      this.broadcastPeerList();
    }
  }

  handleHostData(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "full_state") this.applyFullState(payload);
    else if (payload.type === "host_heartbeat") this.receiveHostHeartbeat(payload);
    else if (payload.type === "succession_update") this.succession.set(payload.successionList || []);
    else if (payload.type === "peer_list") this.applyPeerList(payload.peers || {});
    else if (payload.type === "action_commit") this.applyActionCommit(payload);
    else if (payload.type === "action_reject") this.rollback.reject(payload);
    else if (payload.type === "cursor_move") this.receiveRemoteCursor(payload);
    else if (payload.type === "join_reject") {
      const reason = payload.reason || "Join rejected.";
      this.setStatus(reason, "warn");
      if (this.migrationInProgress && this.hostPeerId) this.scheduleReconnect(this.hostPeerId, reason);
    }
  }

  enqueueActionRequest(conn, payload) {
    this.actionQueue.push({ conn, payload });
    this.processActionQueue();
  }

  processActionQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;
    while (this.actionQueue.length) {
      const { conn, payload } = this.actionQueue.shift();
      this.processActionRequest(conn, payload);
    }
    this.processingQueue = false;
  }

  processActionRequest(conn, payload) {
    const result = this.validator.applyActionRequest(state, payload);
    if (!result.valid) {
      this.safeSend(conn, {
        type: "action_reject",
        actionId: payload.actionId,
        temporaryIds: payload.temporaryIds || {},
        reason: result.reason,
        state: cloneState(state),
      });
      return;
    }
    this.runWithoutNetwork(() => {
      state = result.state;
      onStateReplaced();
    });
    this.broadcast({
      type: "action_commit",
      actionId: payload.actionId,
      actionType: payload.actionType,
      temporaryIds: payload.temporaryIds || {},
      permanentIds: result.permanentIds,
      state: cloneState(state),
    });
    this.setStatus(`Committed ${payload.actionType || "remote action"}`, "success", { toast: false });
  }

  handleLocalAction(type, before, after, historyEntry = null) {
    if (this.isApplyingRemote || this.role === "offline") return;
    const actionId = `${this.localPeerId || "local"}_${Date.now()}_${++this.actionSequence}`;
    if (historyEntry) historyEntry.actionId = actionId;
    const payload = {
      type: "action_request",
      actionId,
      actionType: type,
      peerId: this.localPeerId,
      username: this.getUsername(),
      before,
      after,
      temporaryIds: this.validator.getTemporaryIds(before, after),
      timestamp: Date.now(),
    };
    if (this.role === "host") {
      this.broadcast({
        type: "action_commit",
        actionId,
        actionType: type,
        temporaryIds: payload.temporaryIds,
        permanentIds: { uids: {}, towerIds: {}, wallIds: {}, structureIds: {} },
        state: cloneState(state),
      });
      return;
    }
    if (this.role === "client" && this.hostConn?.open) {
      this.rollback.track(payload);
      this.safeSend(this.hostConn, payload);
    }
  }

  applyFullState(payload) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.migrationInProgress = false;
    this.reconnectTarget = "";
    this.reconnectAttempts = 0;
    this.lastHostHeartbeatAt = Date.now();
    if (payload.successionList) this.succession.set(payload.successionList);
    if (payload.peers) this.applyPeerList(payload.peers);
    this.applyAuthoritativeState(payload.state);
    this.setStatus(`Synced full state from host ${this.hostPeerId}`, "success");
  }

  applyActionCommit(payload) {
    this.rewriteHistoryIds(payload);
    this.rollback.resolve(payload.actionId);
    this.applyAuthoritativeState(payload.state);
    this.setStatus(`Synced ${payload.actionType || "remote action"}`, "success", { toast: false });
  }

  removeHistoryAction(actionId) {
    if (!actionId) return;
    history.undo = history.undo.filter((action) => action.actionId !== actionId);
    history.redo = history.redo.filter((action) => action.actionId !== actionId);
  }

  rewriteHistoryIds(payload) {
    const permanentIds = payload?.permanentIds;
    if (!permanentIds) return;
    [...history.undo, ...history.redo].forEach((action) => {
      if (action.actionId !== payload.actionId) return;
      rewriteStateIds(action.before, permanentIds);
      rewriteStateIds(action.after, permanentIds);
    });
  }

  applyAuthoritativeState(nextState) {
    if (!nextState) return;
    this.runWithoutNetwork(() => {
      state = cloneState(nextState);
      onStateReplaced();
    });
    queueRedraw();
  }

  runWithoutNetwork(fn) {
    const previous = this.isApplyingRemote;
    this.isApplyingRemote = true;
    try {
      fn();
    } finally {
      this.isApplyingRemote = previous;
    }
  }

  sendFullState(conn) {
    this.safeSend(conn, {
      type: "full_state",
      hostId: this.localPeerId,
      state: cloneState(state),
      successionList: this.succession.list.slice(),
      peers: this.getPeerSnapshot(),
    });
  }

  startHostServices() {
    this.stopHostWatchdog();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.sendHostHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHostHeartbeat(), 1000);
  }

  stopHostServices() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  sendHostHeartbeat() {
    if (this.role !== "host") return;
    this.broadcast({
      type: "host_heartbeat",
      hostId: this.localPeerId,
      successionList: this.succession.list.slice(),
      timestamp: Date.now(),
    });
  }

  receiveHostHeartbeat(payload) {
    this.lastHostHeartbeatAt = Date.now();
    if (payload.successionList) this.succession.set(payload.successionList);
  }

  startHostWatchdog() {
    if (this.hostWatchTimer) return;
    this.hostWatchTimer = setInterval(() => {
      if (this.role !== "client") return;
      if (this.migrationInProgress) return;
      const missingFor = Date.now() - this.lastHostHeartbeatAt;
      if (missingFor > 4200) {
        this.handleHostConnectionLost("Host heartbeat timed out.");
      }
    }, 900);
  }

  stopHostWatchdog() {
    if (this.hostWatchTimer) clearInterval(this.hostWatchTimer);
    this.hostWatchTimer = null;
  }

  scheduleReconnect(hostId, reason = "Trying the migrated host again...") {
    if (!hostId || this.role !== "client") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.role !== "client") return;
      if (!this.migrationInProgress && this.hostConn?.open) return;
      this.setStatus(`${reason} Reconnect attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}.`, "warn");
      this.connectToHost(hostId, { reconnect: true, previousHostId: this.succession.list[0] || "" });
    }, 1200);
  }

  broadcastSuccession() {
    if (this.role !== "host") return;
    this.broadcast({ type: "succession_update", successionList: this.succession.list.slice() });
  }

  broadcastPeerList() {
    if (this.role !== "host") return;
    this.broadcast({ type: "peer_list", peers: this.getPeerSnapshot() });
  }

  getPeerSnapshot() {
    const peers = {
      [this.localPeerId]: {
        peerId: this.localPeerId,
        username: this.getUsername(),
        color: this.colorForPeer(this.localPeerId || "host"),
        role: this.role,
      },
    };
    Object.entries(this.connectedPeers).forEach(([peerId, info]) => {
      peers[peerId] = {
        peerId,
        username: info.username || peerId,
        color: info.color || this.colorForPeer(peerId),
        role: info.role || "client",
        x: info.x,
        y: info.y,
      };
    });
    return peers;
  }

  applyPeerList(peers) {
    const previousPeers = { ...this.connectedPeers };
    const previousIds = new Set(Object.keys(previousPeers));
    this.connectedPeers = {};
    Object.entries(peers).forEach(([peerId, info]) => {
      if (peerId === this.localPeerId) return;
      this.connectedPeers[peerId] = {
        peerId,
        username: info.username || peerId,
        color: info.color || this.colorForPeer(peerId),
        role: info.role || "peer",
        x: info.x,
        y: info.y,
      };
    });
    const nextIds = new Set(Object.keys(this.connectedPeers));
    if (previousIds.size) {
      nextIds.forEach((peerId) => {
        if (!previousIds.has(peerId)) {
          this.setStatus(`Peer joined: ${this.connectedPeers[peerId]?.username || peerId}`, "success");
        }
      });
      previousIds.forEach((peerId) => {
        if (!nextIds.has(peerId)) {
          this.setStatus(`Peer left: ${previousPeers[peerId]?.username || peerId}`, "warn");
        }
      });
    }
    queueRedraw();
  }

  receiveClientCursor(peerId, payload) {
    const info = this.connectedPeers[peerId] || {};
    this.connectedPeers[peerId] = {
      ...info,
      peerId,
      username: payload.username || info.username || peerId,
      color: info.color || this.colorForPeer(peerId),
      x: payload.x,
      y: payload.y,
      role: "client",
    };
    this.broadcast({ ...payload, type: "cursor_move", peerId }, peerId);
    queueRedraw();
  }

  receiveRemoteCursor(payload) {
    if (!payload.peerId || payload.peerId === this.localPeerId) return;
    const info = this.connectedPeers[payload.peerId] || {};
    this.connectedPeers[payload.peerId] = {
      ...info,
      peerId: payload.peerId,
      username: payload.username || info.username || payload.peerId,
      color: info.color || payload.color || this.colorForPeer(payload.peerId),
      x: payload.x,
      y: payload.y,
      role: payload.role || info.role || "peer",
    };
    queueRedraw();
  }

  sendCursorMove(world) {
    if (this.role === "offline" || !this.localPeerId) return;
    const now = performance.now();
    if (now - this.lastCursorSentAt < 33) return;
    this.lastCursorSentAt = now;
    const payload = {
      type: "cursor_move",
      peerId: this.localPeerId,
      username: this.getUsername(),
      color: this.colorForPeer(this.localPeerId),
      x: roundTo(world.x, 2),
      y: roundTo(world.y, 2),
    };
    if (this.role === "host") this.broadcast(payload);
    else if (this.hostConn?.open) this.safeSend(this.hostConn, payload);
  }

  drawCursors() {
    Object.values(this.connectedPeers).forEach((peer) => {
      if (!Number.isFinite(peer.x) || !Number.isFinite(peer.y)) return;
      const p = worldToScreen(peer.x, peer.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = peer.color || "#6FCF97";
      ctx.strokeStyle = "#0D0F17";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(14, 5);
      ctx.lineTo(5, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = "800 14px 'Space Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = peer.username || peer.peerId || "Peer";
      const textX = 20;
      const textY = 18;
      const labelWidth = ctx.measureText(label).width + 16;
      roundRectPath(textX - 8, textY - 12, labelWidth, 24, 7);
      ctx.fillStyle = "rgba(8, 13, 24, 0.86)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, textX, textY);
      ctx.restore();
    });
  }

  broadcast(payload, exceptPeerId = null) {
    this.connections.forEach((conn, peerId) => {
      if (peerId !== exceptPeerId) this.safeSend(conn, payload);
    });
  }

  safeSend(conn, payload) {
    try {
      if (conn?.open) conn.send(payload);
    } catch (error) {
      console.warn("Peer send failed", error);
    }
  }

  updateLocalPeerMeta() {
    if (!this.localPeerId) return;
    if (this.role === "client" && this.hostConn?.open) {
      this.safeSend(this.hostConn, { type: "peer_meta", username: this.getUsername() });
    }
  }

  autofillAndAutoJoinFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hostId = params.get("host");
    if (!hostId) return;
    setTimeout(() => {
      if (this.role === "offline") this.joinSession(hostId);
    }, 250);
  }

  updateInviteLink() {
    return this.getHostLink();
  }

  getHostLink() {
    const sharePeerId = this.role === "client" ? this.hostPeerId : this.localPeerId;
    if (!sharePeerId) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("host", sharePeerId);
    return url.toString();
  }

  async copyHostLink() {
    const link = this.getHostLink();
    if (!link) {
      this.setStatus("Host link is not ready yet.", "warn");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        this.copyTextFallback(link);
      }
      this.setStatus("Host link copied. Send it to players to join.", "success");
    } catch (error) {
      this.copyTextFallback(link);
      this.setStatus("Host link copied. Send it to players to join.", "success");
    }
  }

  copyTextFallback(text) {
    const input = document.createElement("input");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  updateUi() {
    if (el.hostSessionBtn) {
      el.hostSessionBtn.textContent = this.role === "hosting" ? "Starting..." : "Copy host link";
      el.hostSessionBtn.disabled = this.role === "hosting";
    }
    this.updateInviteLink();
  }

  setStatus(text, tone = "idle", options = {}) {
    const shouldToast = options.toast ?? true;
    if (shouldToast) this.showStatusToast(text, tone === "idle" ? "info" : tone);
  }

  showStatusToast(text, tone = "info") {
    if (!el.multiplayerToastStack || !text) return;
    const now = performance.now();
    if (this.lastToast.text === text && now - this.lastToast.at < 900) return;
    this.lastToast = { text, at: now };

    const toast = document.createElement("div");
    toast.className = "multiplayer-toast";
    toast.dataset.tone = tone;

    const title = document.createElement("strong");
    title.textContent = this.labelForStatusTone(tone);
    const body = document.createElement("span");
    body.textContent = text;
    toast.append(title, body);

    el.multiplayerToastStack.appendChild(toast);
    while (el.multiplayerToastStack.children.length > 4) {
      el.multiplayerToastStack.firstElementChild?.remove();
    }
    window.setTimeout(() => toast.classList.add("is-hiding"), 3800);
    window.setTimeout(() => toast.remove(), 4300);
  }

  labelForStatusTone(tone) {
    if (tone === "success") return "Session update";
    if (tone === "warn") return "Connection warning";
    if (tone === "error") return "Session error";
    return "Multiplayer";
  }

  ensurePeerJs() {
    if (typeof Peer === "undefined") {
      alert("PeerJS failed to load. Check your network connection and reload the editor.");
      return false;
    }
    return true;
  }

  closeExistingConnections() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopHostServices();
    this.stopHostWatchdog();
    this.migrationInProgress = false;
    this.reconnectTarget = "";
    this.reconnectAttempts = 0;
    this.role = "offline";
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
    }
    this.connections.forEach((conn) => {
      conn._manualClose = true;
      conn.close();
    });
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = null;
    this.hostConn = null;
    this.connections.clear();
    this.connectedPeers = {};
    this.localPeerId = "";
    this.hostPeerId = "";
    this.succession.set([]);
  }

  colorForPeer(peerId) {
    const palette = ["#6FCF97", "#47AFFF", "#FFB020", "#FF6B9A", "#A5B8D9", "#B388FF"];
    let hash = 0;
    String(peerId || "peer").split("").forEach((char) => { hash = ((hash << 5) - hash) + char.charCodeAt(0); });
    return palette[Math.abs(hash) % palette.length];
  }
}

class SuccessionLogic {
  constructor(manager) {
    this.manager = manager;
    this.list = [];
  }

  set(nextList) {
    const unique = [];
    (nextList || []).forEach((peerId) => {
      if (peerId && !unique.includes(peerId)) unique.push(peerId);
    });
    this.list = unique;
    this.manager.updateUi();
  }

  add(peerId) {
    if (!this.list.includes(peerId)) this.list.push(peerId);
  }

  remove(peerId) {
    this.list = this.list.filter((id) => id !== peerId);
  }

  handleHostLost(previousList) {
    const localId = this.manager.localPeerId;
    const localIndex = previousList.indexOf(localId);
    const newHostId = previousList[1];
    if (localIndex === 1) {
      this.manager.promoteToHost(previousList);
      return;
    }
    if (localIndex > 1 && newHostId) {
      this.manager.reconnectTarget = newHostId;
      this.manager.reconnectAttempts = 0;
      this.manager.setStatus(`Host migrated. Connecting to successor ${newHostId}...`, "warn");
      this.manager.joinSession(newHostId, { reconnect: true, previousHostId: previousList[0] || "" });
      return;
    }
    this.manager.role = "offline";
    this.manager.migrationInProgress = false;
    this.manager.setStatus("Host disconnected and no successor was available.", "error");
    this.manager.updateUi();
  }
}

class ActionValidator {
  constructor(manager) {
    this.manager = manager;
  }

  getTemporaryIds(before, after) {
    const ids = { uids: {}, towerIds: {}, wallIds: {}, structureIds: {} };
    MULTIPLAYER_COLLECTIONS.forEach((config) => {
      const beforeMap = this.mapByUid(before?.[config.key] || []);
      (after?.[config.key] || []).forEach((item) => {
        if (beforeMap.has(item.uid)) return;
        ids.uids[item.uid] = null;
        if (config.type === "tower") ids.towerIds[item.id] = null;
        if (config.type === "wall") ids.wallIds[item.id] = null;
        if (config.type === "structure") ids.structureIds[item.id] = null;
      });
    });
    return ids;
  }

  applyActionRequest(currentState, payload) {
    if (!payload?.before || !payload?.after) return { valid: false, reason: "Action request is missing state snapshots." };
    if (!this.isStateLike(payload.before) || !this.isStateLike(payload.after)) return { valid: false, reason: "Action request contains invalid state shape." };
    const permanentIds = { uids: {}, towerIds: {}, wallIds: {}, structureIds: {} };
    const candidate = cloneState(currentState);
    const before = payload.before;
    const after = payload.after;
    if (Number(before.spawn_protection_size) !== Number(after.spawn_protection_size)) {
      candidate.spawn_protection_size = Number(after.spawn_protection_size);
    }

    this.applyDeletes(candidate, before, after);
    const updateError = this.applyUpdates(candidate, before, after);
    if (updateError) return { valid: false, reason: updateError };
    const createError = this.applyCreates(candidate, before, after, permanentIds);
    if (createError) return { valid: false, reason: createError };

    const validationError = this.validateCandidate(candidate, currentState);
    if (validationError) return { valid: false, reason: validationError };
    return { valid: true, state: candidate, permanentIds };
  }

  applyDeletes(candidate, before, after) {
    MULTIPLAYER_COLLECTIONS.forEach((config) => {
      const afterMap = this.mapByUid(after[config.key] || []);
      (before[config.key] || []).forEach((item) => {
        if (afterMap.has(item.uid)) return;
        if (config.type === "tower") {
          const tower = candidate.towers.find((existing) => existing.uid === item.uid);
          if (tower) {
            candidate.towers = candidate.towers.filter((existing) => existing.uid !== item.uid);
            candidate.walls = candidate.walls.filter((wall) => wall.t1 !== tower.id && wall.t2 !== tower.id);
          }
        } else {
          candidate[config.key] = candidate[config.key].filter((existing) => existing.uid !== item.uid);
        }
      });
    });
  }

  applyUpdates(candidate, before, after) {
    for (const config of MULTIPLAYER_COLLECTIONS) {
      const beforeMap = this.mapByUid(before[config.key] || []);
      const candidateMap = this.mapByUid(candidate[config.key] || []);
      for (const item of after[config.key] || []) {
        const previous = beforeMap.get(item.uid);
        if (!previous || this.same(previous, item)) continue;
        const current = candidateMap.get(item.uid);
        if (!current) return `${config.type} was changed concurrently and no longer exists.`;
        const next = this.sanitizeUpdatedItem(config.type, current, item);
        const index = candidate[config.key].findIndex((entry) => entry.uid === item.uid);
        candidate[config.key][index] = next;
      }
    }
    return "";
  }

  applyCreates(candidate, before, after, permanentIds) {
    const towerIdMap = new Map();
    const createByType = (type) => {
      const config = MULTIPLAYER_COLLECTIONS.find((item) => item.type === type);
      const beforeMap = this.mapByUid(before[config.key] || []);
      return (after[config.key] || []).filter((item) => !beforeMap.has(item.uid));
    };

    createByType("boundary").forEach((item) => {
      const uid = createUid("boundary");
      permanentIds.uids[item.uid] = uid;
      candidate.map_boundaries.push({ uid, x: Number(item.x), y: Number(item.y) });
    });
    createByType("hole").forEach((item) => {
      const uid = createUid("hole");
      permanentIds.uids[item.uid] = uid;
      candidate.map_holes.push({
        uid,
        points: (item.points || []).map((point) => ({
          uid: createUid("hole_vertex"),
          x: Number(point.x),
          y: Number(point.y),
        })),
      });
    });
    createByType("spawn").forEach((item) => {
      const uid = createUid("spawn");
      permanentIds.uids[item.uid] = uid;
      candidate.spawn_points.push({ uid, team_id: Number(item.team_id), x: Number(item.x), y: Number(item.y) });
    });
    createByType("bomb").forEach((item) => {
      const uid = createUid("bomb");
      permanentIds.uids[item.uid] = uid;
      candidate.bomb_sites.push({ uid, site_letter: String(item.site_letter || "A").toUpperCase(), x: Number(item.x), y: Number(item.y) });
    });
    createByType("tower").forEach((item) => {
      const uid = createUid("tower");
      const id = nextTowerId();
      towerIdMap.set(item.id, id);
      permanentIds.uids[item.uid] = uid;
      permanentIds.towerIds[item.id] = id;
      candidate.towers.push({
        uid,
        id,
        team_id: Number(item.team_id),
        x: Number(item.x),
        y: Number(item.y),
        health: clamp(1, Math.round(Number(item.health) || GAME.TOWER_MAX_HEALTH), GAME.TOWER_MAX_HEALTH),
        is_invincible: Boolean(item.is_invincible),
      });
    });
    createByType("structure").forEach((item) => {
      const uid = createUid("structure");
      const id = nextStructureId();
      permanentIds.uids[item.uid] = uid;
      permanentIds.structureIds[item.id] = id;
      candidate.structures.push({
        uid,
        id,
        x: Number(item.x),
        y: Number(item.y),
        size: Math.max(20, Math.round(Number(item.size) || 130)),
        label: typeof item.label === "string" ? item.label : "BLOCK",
        color: typeof item.color === "string" ? item.color : COLORS.red,
        team_id: Number.isInteger(Number(item.team_id)) ? Number(item.team_id) : 1,
      });
    });
    for (const item of createByType("wall")) {
      const uid = createUid("wall");
      const id = nextWallLocalId();
      const t1 = towerIdMap.get(item.t1) || item.t1;
      const t2 = towerIdMap.get(item.t2) || item.t2;
      if (!candidate.towers.some((tower) => tower.id === t1) || !candidate.towers.some((tower) => tower.id === t2)) {
        return "Created wall references a missing tower.";
      }
      permanentIds.uids[item.uid] = uid;
      permanentIds.wallIds[item.id] = id;
      candidate.walls.push({ uid, id, t1, t2, team_id: Number(item.team_id) });
    }
    return "";
  }

  sanitizeUpdatedItem(type, current, item) {
    if (type === "tower") {
      return {
        ...current,
        team_id: Number(item.team_id),
        x: Number(item.x),
        y: Number(item.y),
        health: clamp(1, Math.round(Number(item.health) || current.health || GAME.TOWER_MAX_HEALTH), GAME.TOWER_MAX_HEALTH),
        is_invincible: Boolean(item.is_invincible),
      };
    }
    if (type === "wall") {
      return { ...current, t1: Number(item.t1), t2: Number(item.t2), team_id: Number(item.team_id) };
    }
    if (type === "spawn") return { ...current, team_id: Number(item.team_id), x: Number(item.x), y: Number(item.y) };
    if (type === "bomb") return { ...current, site_letter: String(item.site_letter || "A").toUpperCase(), x: Number(item.x), y: Number(item.y) };
    if (type === "boundary") return { ...current, x: Number(item.x), y: Number(item.y) };
    if (type === "hole") {
      return {
        ...current,
        points: (item.points || []).map((point, index) => ({
          uid: point.uid || current.points?.[index]?.uid || createUid("hole_vertex"),
          x: Number(point.x),
          y: Number(point.y),
        })),
      };
    }
    if (type === "structure") {
      return {
        ...current,
        x: Number(item.x),
        y: Number(item.y),
        size: Math.max(20, Math.round(Number(item.size) || current.size || 130)),
        label: typeof item.label === "string" ? item.label : current.label,
        color: typeof item.color === "string" ? item.color : current.color,
        team_id: Number.isInteger(Number(item.team_id)) ? Number(item.team_id) : current.team_id,
      };
    }
    return { ...current, ...item, uid: current.uid };
  }

  validateCandidate(candidate, previousState = null) {
    if (!this.isStateLike(candidate)) return "Candidate state is malformed.";
    const spawnTeams = new Map();
    for (const spawn of candidate.spawn_points) {
      if (spawn.team_id !== 0 && spawn.team_id !== 1) return "Spawn team must be Team Blue or Team Red.";
      spawnTeams.set(spawn.team_id, (spawnTeams.get(spawn.team_id) || 0) + 1);
      if (spawnTeams.get(spawn.team_id) > 1) return "Only one spawn per team is allowed.";
    }
    const towerIds = new Set();
    for (const tower of candidate.towers) {
      if (!Number.isInteger(tower.id) || towerIds.has(tower.id)) return "Tower IDs must be unique integers.";
      towerIds.add(tower.id);
    }
    const seenWalls = new Set();
    for (const wall of candidate.walls) {
      if (wall.t1 === wall.t2) return "A wall cannot connect a tower to itself.";
      const a = candidate.towers.find((tower) => tower.id === wall.t1);
      const b = candidate.towers.find((tower) => tower.id === wall.t2);
      if (!a || !b) return "A wall references a missing tower.";
      if (a.team_id !== b.team_id || wall.team_id !== a.team_id) return "Wall color must match both connected towers.";
      const key = `${Math.min(wall.t1, wall.t2)}:${Math.max(wall.t1, wall.t2)}`;
      if (seenWalls.has(key)) return "Duplicate walls are not allowed.";
      seenWalls.add(key);
    }
    const previousTowerOverlaps = previousState ? getTowerOverlapSignatures(null, previousState) : new Set();
    const previousTowerWallConflicts = previousState ? getTowerWallConflictSignatures(null, previousState) : new Set();
    const previousWallOverlaps = previousState ? getWallOverlapSignatures(null, previousState) : new Set();
    if (hasNewConflict(getTowerOverlapSignatures(null, candidate), previousTowerOverlaps)) return "A tower overlaps another tower.";
    if (hasNewConflict(getTowerWallConflictSignatures(null, candidate), previousTowerWallConflicts)) return "A tower overlaps an existing wall.";
    if (hasNewConflict(getWallOverlapSignatures(null, candidate), previousWallOverlaps)) return "Walls overlap or intersect.";
    const holeIssue = HOLE_GEOMETRY.validateMapHoles(candidate)[0];
    if (holeIssue) return holeIssue.message;
    return "";
  }

  isStateLike(value) {
    return Boolean(value)
      && typeof value === "object"
      && Array.isArray(value.map_boundaries)
      && (value.map_holes === undefined || Array.isArray(value.map_holes))
      && Array.isArray(value.spawn_points)
      && Array.isArray(value.bomb_sites)
      && Array.isArray(value.towers)
      && Array.isArray(value.walls)
      && Array.isArray(value.structures);
  }

  mapByUid(items) {
    const map = new Map();
    items.forEach((item) => { if (item?.uid) map.set(item.uid, item); });
    return map;
  }

  same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

class RollbackHandler {
  constructor(manager) {
    this.manager = manager;
    this.pending = new Map();
  }

  track(payload) {
    this.pending.set(payload.actionId, {
      before: cloneState(payload.before),
      after: cloneState(payload.after),
      temporaryIds: payload.temporaryIds || {},
    });
  }

  resolve(actionId) {
    if (actionId) this.pending.delete(actionId);
  }

  reject(payload) {
    const pending = this.pending.get(payload.actionId);
    if (pending) this.pending.delete(payload.actionId);
    this.manager.removeHistoryAction(payload.actionId);
    this.manager.runWithoutNetwork(() => {
      if (payload.state) {
        state = cloneState(payload.state);
      } else if (pending) {
        state = cloneState(pending.before);
      } else {
        this.removeTemporaryIds(payload.temporaryIds || {});
      }
      onStateReplaced();
    });
    queueRedraw();
    setActionState(payload.reason ? `Action rejected: ${payload.reason}` : "Action rejected by host.", "warn", true);
    this.manager.setStatus(payload.reason ? `Action rejected: ${payload.reason}` : "Action rejected by host.", "warn");
  }

  removeTemporaryIds(temporaryIds) {
    const uidSet = new Set(Object.keys(temporaryIds.uids || {}));
    if (!uidSet.size) return;
    state.map_boundaries = state.map_boundaries.filter((item) => !uidSet.has(item.uid));
    state.map_holes = state.map_holes.filter((item) => !uidSet.has(item.uid));
    state.spawn_points = state.spawn_points.filter((item) => !uidSet.has(item.uid));
    state.bomb_sites = state.bomb_sites.filter((item) => !uidSet.has(item.uid));
    state.structures = state.structures.filter((item) => !uidSet.has(item.uid));
    const deletedTowerIds = new Set(state.towers.filter((item) => uidSet.has(item.uid)).map((tower) => tower.id));
    state.towers = state.towers.filter((item) => !uidSet.has(item.uid));
    state.walls = state.walls.filter((item) => !uidSet.has(item.uid) && !deletedTowerIds.has(item.t1) && !deletedTowerIds.has(item.t2));
  }
}

if (!globalThis.__COSMOWAR_EDITOR_TEST__) {
  restoreSavedSession();
  ensureDefaultBoundary();
  setup();
}

function setup() {
  hydrateCountersFromState();
  restoreCustomShapes();
  bindUI();
  setupPanelResizers();
  setupMultiplayer();
  updateTeamSwatches();
  interaction.snapEnabled = editorSettings.objectSnapEnabled;
  el.snapStrengthInput.value = String(editorSettings.snapStrength);
  el.objectSnapEnabledInput.checked = editorSettings.objectSnapEnabled;
  el.buildSnapEnabledInput.checked = editorSettings.buildModeSnapEnabled;
  el.gridSnapEnabledInput.checked = editorSettings.gridSnapEnabled;
  el.gridSizeInput.value = String(editorSettings.gridSize);
  el.gridLineWidthInput.value = String(editorSettings.gridLineWidth);
  el.gridMajorVisibleInput.checked = editorSettings.gridMajorVisible;
  el.originAxesVisibleInput.checked = editorSettings.originAxesVisible;
  el.mirrorLiveInput.checked = mirrorState.liveEnabled;
  updateMirrorStatus();
  el.towerHealthInput.max = String(GAME.TOWER_MAX_HEALTH);
  el.towerHealthInput.value = String(defaults.towerHealth);
  el.towerInvincibleInput.checked = defaults.towerInvincible;
  resizeCanvas();
  if (!restoredViewFromSession) fitBoundaryInView();
  setMode("select");
  renderSelectionPanel();
  renderCustomShapes();
  if (!updateInvalidObjectWarning()) setActionState("Idle", "idle");
  requestRender();
  window.addEventListener("resize", onWindowResize);
  requestAnimationFrame(frame);
}

function frame(timestamp) {
  updateKeyboardPan(timestamp);
  if (needsRender) {
    draw();
    needsRender = false;
  }
  requestAnimationFrame(frame);
}

function updateKeyboardPan(timestamp) {
  if (lastFrameTime == null) {
    lastFrameTime = timestamp;
    return;
  }
  const elapsedSeconds = Math.min(0.05, Math.max(0, timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;
  if (!keyboardPanKeys.size || elapsedSeconds === 0) return;

  let x = 0;
  let y = 0;
  if (keyboardPanKeys.has("a") || keyboardPanKeys.has("arrowleft")) x += 1;
  if (keyboardPanKeys.has("d") || keyboardPanKeys.has("arrowright")) x -= 1;
  if (keyboardPanKeys.has("w") || keyboardPanKeys.has("arrowup")) y += 1;
  if (keyboardPanKeys.has("s") || keyboardPanKeys.has("arrowdown")) y -= 1;
  if (x === 0 && y === 0) return;

  const magnitude = Math.hypot(x, y) || 1;
  const movement = GAME.KEYBOARD_PAN_SPEED * elapsedSeconds;
  view.offsetX += (x / magnitude) * movement;
  view.offsetY += (y / magnitude) * movement;
  interaction.mouseWorld = screenToWorld(interaction.mouseScreen.x, interaction.mouseScreen.y);
  updateCursorCoordinates();
  if (["build", "boundary", "hole", "spawn", "bomb"].includes(interaction.mode)) refreshPlacementPreviewFromMouse();
  requestRender();
}

function requestRender() {
  needsRender = true;
}

function queueRedraw() {
  requestRender();
}

function setupMultiplayer() {
  multiplayerManager = new MultiplayerManager();
  multiplayerManager.bindUI();
}

function setupPanelResizers() {
  restorePanelLayout();
  el.leftResizeHandle?.addEventListener("pointerdown", (event) => startPanelResize("left", event));
  el.rightResizeHandle?.addEventListener("pointerdown", (event) => startPanelResize("right", event));
}

function startPanelResize(side, event) {
  if (window.matchMedia("(max-width: 980px)").matches) return;
  event.preventDefault();
  const handle = side === "left" ? el.leftResizeHandle : el.rightResizeHandle;
  panelResize = {
    side,
    handle,
    startX: event.clientX,
    startWidth: getPanelWidth(side),
  };
  handle?.classList.add("active");
  document.body.classList.add("resizing-panels");
  window.addEventListener("pointermove", onPanelResizeMove);
  window.addEventListener("pointerup", finishPanelResize, { once: true });
}

function onPanelResizeMove(event) {
  if (!panelResize) return;
  const dx = event.clientX - panelResize.startX;
  const nextWidth = panelResize.side === "left"
    ? panelResize.startWidth + dx
    : panelResize.startWidth - dx;
  setPanelWidth(panelResize.side, nextWidth);
  resizeCanvas();
}

function finishPanelResize() {
  if (!panelResize) return;
  panelResize.handle?.classList.remove("active");
  panelResize = null;
  document.body.classList.remove("resizing-panels");
  window.removeEventListener("pointermove", onPanelResizeMove);
  savePanelLayout();
  resizeCanvas();
}

function onWindowResize() {
  if (!window.matchMedia("(max-width: 980px)").matches) {
    setPanelWidth("left", getPanelWidth("left"));
    setPanelWidth("right", getPanelWidth("right"));
  }
  resizeCanvas();
}

function restorePanelLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY) || "{}");
    if (Number.isFinite(saved.left)) setPanelWidth("left", saved.left);
    if (Number.isFinite(saved.right)) setPanelWidth("right", saved.right);
  } catch (error) {
    console.warn("Could not restore panel layout.", error);
  }
}

function savePanelLayout() {
  try {
    localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify({
      left: Math.round(getPanelWidth("left")),
      right: Math.round(getPanelWidth("right")),
    }));
  } catch (error) {
    console.warn("Could not save panel layout.", error);
  }
}

function setPanelWidth(side, width) {
  if (!el.appShell) return width;
  const otherWidth = getPanelWidth(side === "left" ? "right" : "left");
  const shellWidth = el.appShell.getBoundingClientRect().width || window.innerWidth;
  const minWidth = 210;
  const maxWidth = Math.min(620, Math.max(minWidth, shellWidth - otherWidth - 430));
  const nextWidth = clamp(minWidth, Math.round(width), maxWidth);
  el.appShell.style.setProperty(`--${side}-sidebar-width`, `${nextWidth}px`);
  return nextWidth;
}

function getPanelWidth(side) {
  const node = side === "left" ? el.leftSidebar : el.rightSidebar;
  const fallback = side === "left" ? 280 : 330;
  return node?.getBoundingClientRect().width || fallback;
}

function bindUI() {
  el.toolButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.tool)));
  el.spawnProtectionInput.addEventListener("change", onGlobalSpawnProtectionChange);

  el.teamSwatches.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      defaults.defaultTeam = parseInt(swatch.dataset.team, 10);
      updateTeamSwatches();
      saveSession();
      setActionState(`Default color: ${TEAM_LABELS[String(defaults.defaultTeam)]}`, "success", true);
    });
  });

  el.towerHealthInput.addEventListener("change", () => {
    const v = Math.round(Number(el.towerHealthInput.value));
    if (Number.isFinite(v)) {
      defaults.towerHealth = clamp(1, v, GAME.TOWER_MAX_HEALTH);
      el.towerHealthInput.value = String(defaults.towerHealth);
      saveSession();
    }
  });
  el.towerInvincibleInput.addEventListener("change", () => {
    defaults.towerInvincible = el.towerInvincibleInput.checked;
    saveSession();
  });
  el.makeAllTowersInvincibleBtn?.addEventListener("click", () => {
    if (!state.towers.length) {
      setActionState("There are no towers to update", "warn", true);
      return;
    }
    const changed = withAction("MAKE_ALL_TOWERS_INVINCIBLE", () => {
      let updated = false;
      state.towers.forEach((tower) => {
        if (tower.is_invincible) return;
        tower.is_invincible = true;
        updated = true;
      });
      return updated;
    });
    setActionState(changed ? `Made all ${state.towers.length} towers invincible` : "All towers are already invincible", changed ? "success" : "idle", true);
    renderSelectionPanel();
  });

  el.snapStrengthInput.addEventListener("change", () => {
    const v = Math.round(Number(el.snapStrengthInput.value));
    if (!Number.isFinite(v)) {
      el.snapStrengthInput.value = String(editorSettings.snapStrength);
      return;
    }
    editorSettings.snapStrength = clamp(1, v, 500);
    el.snapStrengthInput.value = String(editorSettings.snapStrength);
    saveSession();
    setActionState(`Object snapping strength: ${editorSettings.snapStrength}`, "success", true);
  });
  el.buildSnapEnabledInput.addEventListener("change", () => {
    editorSettings.buildModeSnapEnabled = el.buildSnapEnabledInput.checked;
    saveSession();
    setActionState(`Build mode object snapping ${editorSettings.buildModeSnapEnabled ? "enabled" : "disabled"}`, "success", true);
  });
  el.objectSnapEnabledInput.addEventListener("change", () => {
    editorSettings.objectSnapEnabled = el.objectSnapEnabledInput.checked;
    interaction.snapEnabled = editorSettings.objectSnapEnabled;
    saveSession();
    refreshPlacementPreviewFromMouse();
    setActionState(`Object snapping ${editorSettings.objectSnapEnabled ? "enabled" : "disabled"}`, "success", true);
    requestRender();
  });
  el.gridSnapEnabledInput.addEventListener("change", () => {
    editorSettings.gridSnapEnabled = el.gridSnapEnabledInput.checked;
    saveSession();
    refreshPlacementPreviewFromMouse();
    setActionState(`Snap to grid ${editorSettings.gridSnapEnabled ? "enabled" : "disabled"}`, "success", true);
    requestRender();
  });
  el.gridSizeInput.addEventListener("change", () => {
    const value = Number(el.gridSizeInput.value);
    if (!Number.isFinite(value)) {
      el.gridSizeInput.value = String(editorSettings.gridSize);
      return;
    }
    editorSettings.gridSize = clamp(4, roundTo(value, 2), 1000);
    el.gridSizeInput.value = String(editorSettings.gridSize);
    saveSession();
    refreshPlacementPreviewFromMouse();
    setActionState(`Grid size: ${editorSettings.gridSize}`, "success", true);
    requestRender();
  });
  el.gridLineWidthInput.addEventListener("change", () => {
    const value = Number(el.gridLineWidthInput.value);
    if (!Number.isFinite(value)) {
      el.gridLineWidthInput.value = String(editorSettings.gridLineWidth);
      return;
    }
    editorSettings.gridLineWidth = clamp(0.25, roundTo(value, 2), 8);
    el.gridLineWidthInput.value = String(editorSettings.gridLineWidth);
    saveSession();
    setActionState(`Grid line thickness: ${editorSettings.gridLineWidth}`, "success", true);
    requestRender();
  });
  el.gridMajorVisibleInput.addEventListener("change", () => {
    editorSettings.gridMajorVisible = el.gridMajorVisibleInput.checked;
    saveSession();
    setActionState(`Every 5th grid line ${editorSettings.gridMajorVisible ? "shown" : "hidden"}`, "success", true);
    requestRender();
  });
  el.originAxesVisibleInput.addEventListener("change", () => {
    editorSettings.originAxesVisible = el.originAxesVisibleInput.checked;
    saveSession();
    setActionState(`0,0 axis lines ${editorSettings.originAxesVisible ? "shown" : "hidden"}`, "success", true);
    requestRender();
  });
  el.centerMapOriginBtn.addEventListener("click", centerMapOnOrigin);

  el.mirrorLiveInput.addEventListener("change", () => {
    mirrorState.liveEnabled = el.mirrorLiveInput.checked;
    saveSession();
    updateMirrorStatus();
    setActionState(`Live mirroring ${mirrorState.liveEnabled ? "enabled" : "disabled"}`, "success", true);
    requestRender();
  });
  el.applyMirrorSelectionBtn.addEventListener("click", mirrorSelectionOnce);
  el.removeLastMirrorBtn.addEventListener("click", () => {
    commitMirrorAxesChange("REMOVE_MIRROR_AXIS", () => mirrorState.axes.pop(), "Last mirror axis removed");
  });
  el.clearMirrorAxesBtn.addEventListener("click", () => {
    interaction.mirrorDraft = null;
    commitMirrorAxesChange("CLEAR_MIRROR_AXES", () => { mirrorState.axes = []; }, "Mirror axes cleared");
  });
  el.applyMapPresetBtn.addEventListener("click", applySelectedMapPreset);
  el.saveCustomShapeBtn?.addEventListener("click", saveSelectionAsCustomShape);
  el.customShapeNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveSelectionAsCustomShape();
  });
  el.exportCustomShapesBtn?.addEventListener("click", exportCustomShapes);
  el.importCustomShapesBtn?.addEventListener("click", () => el.customShapesFileInput.click());
  el.customShapesFileInput?.addEventListener("change", importCustomShapes);

  const conversionInputs = [
    el.deflySpacingInput,
    el.deflyUnitSizeInput,
    el.deflySpawnSizeInput,
    el.deflyTowerClearanceInput,
    el.deflyBombClearanceInput,
    el.deflyBoundaryPaddingInput,
  ];
  conversionInputs.forEach((input) => input?.addEventListener("input", updateDeflyConversionPreview));
  el.finishDeflyConversionBtn?.addEventListener("click", finishDeflyConversion);
  el.cancelDeflyConversionBtn?.addEventListener("click", cancelDeflyConversion);

  el.settingsToggleBtn.addEventListener("click", () => {
    setSettingsOpen(el.settingsPanel.classList.contains("hidden"));
  });
  el.settingsCloseBtn.addEventListener("click", () => setSettingsOpen(false));

  el.exportBtn.addEventListener("click", exportJSON);
  el.importBtn.addEventListener("click", () => el.importFileInput.click());
  el.importFileInput.addEventListener("change", importMap);

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => keyboardPanKeys.clear());
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
  if (mode !== "hole") interaction.holeDraft = null;
  cancelMirrorAxisDrag();
  if (mode !== "select") interaction.selectedMirrorAxisIndex = null;
  interaction.mode = mode;
  interaction.drag = null;
  interaction.rotate = null;
  interaction.resize = null;
  interaction.boxSelect = null;
  interaction.mirrorDraft = null;
  interaction.buildGhost = null;
  interaction.placementGhost = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  interaction.towerDraftWarnActive = false;
  interaction.wallDraftWarnActive = false;
  if (mode !== "wall") {
    interaction.wallDraft = null;
    interaction.hoverTowerId = null;
  }
  updateToolButtons();
  updateCursor();
  updateCursorCoordinates();
  setActionState(`Tool: ${toolLabel(mode)}`, "idle", true);
  requestRender();
}

function toolLabel(mode) {
  if (mode === "select") return "Select / Move";
  if (mode === "boundary") return "Draw Boundary";
  if (mode === "hole") return "Draw Hole";
  if (mode === "spawn") return "Place Spawn";
  if (mode === "bomb") return "Place Bomb Site";
  if (mode === "build") return "Build";
  if (mode === "mirror") return "Draw Mirror Axis";
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
    if (interaction.drag || interaction.rotate || interaction.resize || interaction.mirrorAxisDrag) {
      canvas.style.cursor = "grabbing";
      return;
    }
    if (hitMirrorAxisIndex(interaction.mouseScreen) >= 0) {
      canvas.style.cursor = "move";
      return;
    }
    const control = hitSelectionTransformControl(interaction.mouseScreen);
    if (control?.type === "move") canvas.style.cursor = "move";
    else if (control?.type === "rotate") canvas.style.cursor = "grab";
    else if (control?.type === "resize") {
      const cursors = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
      canvas.style.cursor = cursors[control.handle] || "default";
    } else {
      const hit = hitTest(interaction.mouseWorld);
      const selectedHit = hit && isKeyRepresentedBySelection(hit.key);
      canvas.style.cursor = selectedHit && getTransformableSelectionKeys().length ? "move" : "default";
    }
    return;
  }
  canvas.style.cursor = "crosshair";
}

function onMouseDown(event) {
  updateMousePosition(event);

  if (event.button === 2 && unlinkBuildTower()) {
    event.preventDefault();
    return;
  }

  if (isPanTrigger(event)) {
    interaction.isPanning = true;
    interaction.panStartMouse = { ...interaction.mouseScreen };
    interaction.panStartOffset = { x: view.offsetX, y: view.offsetY };
    updateCursor();
    return;
  }
  if (event.button !== 0) return;

  if (conversionSession) {
    setActionState("Finish or cancel the map conversion before editing", "warn", true);
    return;
  }

  const world = interaction.mouseWorld;
  if (interaction.pasteDraft) {
    commitPasteDraft();
    return;
  }
  if (interaction.mode === "select") {
    handleSelectDown(event, world);
    return;
  }
  if (interaction.mode === "mirror") {
    const start = getGridSnappedPoint(world);
    interaction.mirrorDraft = { start, end: { ...start }, type: el.mirrorTransformType.value === "rotate" ? "rotate" : "reflect" };
    setActionState("Drag to draw a mirror axis", "idle");
    requestRender();
    return;
  }
  if (interaction.mode === "boundary") {
    const target = interaction.placementGhost && interaction.placementGhost.type === "boundary"
      ? interaction.placementGhost
      : getBoundaryPlacementPreview(world);
    withAction("ADD_BOUNDARY_POINT", () => {
      state.map_boundaries.push({ uid: createUid("boundary"), x: roundTo(target.x, 3), y: roundTo(target.y, 3) });
      return true;
    });
    setActionState("Boundary vertex added", "success", true);
    return;
  }
  if (interaction.mode === "hole") {
    handleHoleAuthorClick(world);
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
  if (interaction.mode === "build") {
    placeTower(world);
    return;
  }
}

function onMouseMove(event) {
  updateMousePosition(event);
  updateCursor();
  const world = interaction.mouseWorld;
  multiplayerManager?.sendCursorMove(world);

  if (interaction.isPanning && interaction.panStartMouse && interaction.panStartOffset) {
    const dx = interaction.mouseScreen.x - interaction.panStartMouse.x;
    const dy = interaction.mouseScreen.y - interaction.panStartMouse.y;
    view.offsetX = interaction.panStartOffset.x + dx;
    view.offsetY = interaction.panStartOffset.y + dy;
    requestRender();
    return;
  }
  if (interaction.pasteDraft) {
    updatePasteDraft(world);
    requestRender();
    return;
  }
  if (interaction.mirrorAxisDrag) {
    applyMirrorAxisDrag(world);
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
  if (interaction.rotate) {
    applyRotate(world);
    requestRender();
  }
  if (interaction.resize) {
    applyResize(world);
    requestRender();
  }
  if (interaction.mirrorDraft) {
    interaction.mirrorDraft.end = getGridSnappedPoint(world);
    requestRender();
    return;
  }
  if (interaction.wallDraft) {
    interaction.wallDraft.mouse = { ...world };
    const hover = hitTower(world);
    interaction.hoverTowerId = hover ? hover.id : null;
    requestRender();
  }
  if (interaction.mode === "build") {
    const hover = hitTower(world);
    interaction.hoverTowerId = hover ? hover.id : null;
    const startTower = getAutoWallStartTower();
    const preview = getBuildPlacementPreview(world, startTower);
    interaction.buildGhost = { x: preview.x, y: preview.y, invalid: !isPlacementInsideBoundary("tower", preview.x, preview.y) };
    interaction.placementGhost = null;
    interaction.guides = {
      x: preview.guideX,
      y: preview.guideY,
      xPoints: preview.xPoints,
      yPoints: preview.yPoints,
    };
    requestRender();
  } else if (interaction.mode === "spawn") {
    const target = getPlacementSnapPreview(world);
    interaction.buildGhost = null;
    interaction.placementGhost = {
      type: "spawn",
      x: target.x,
      y: target.y,
      invalid: !isPlacementInsideBoundary("spawn", target.x, target.y),
    };
    interaction.guides = { x: target.guideX, y: target.guideY, xPoints: target.xPoints, yPoints: target.yPoints };
    requestRender();
  } else if (interaction.mode === "bomb") {
    const target = getPlacementSnapPreview(world);
    interaction.buildGhost = null;
    interaction.placementGhost = {
      type: "bomb",
      x: target.x,
      y: target.y,
      invalid: !isPlacementInsideBoundary("bomb", target.x, target.y),
    };
    interaction.guides = { x: target.guideX, y: target.guideY, xPoints: target.xPoints, yPoints: target.yPoints };
    requestRender();
  } else if (interaction.mode === "boundary") {
    interaction.buildGhost = null;
    const preview = getBoundaryPlacementPreview(world);
    interaction.placementGhost = { type: "boundary", x: preview.x, y: preview.y, invalid: false };
    interaction.guides = {
      x: preview.guideX,
      y: preview.guideY,
      xPoints: preview.xPoints,
      yPoints: preview.yPoints,
    };
    requestRender();
  } else if (interaction.mode === "hole") {
    interaction.buildGhost = null;
    const preview = getHolePlacementPreview(world);
    interaction.placementGhost = { type: "hole", ...preview };
    interaction.guides = { x: preview.guideX, y: preview.guideY, xPoints: preview.xPoints, yPoints: preview.yPoints };
    requestRender();
  } else if (!interaction.drag) {
    interaction.buildGhost = null;
    interaction.placementGhost = null;
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  }
  if (interaction.mode === "build") requestRender();
}

function refreshPlacementPreviewFromMouse() {
  const world = interaction.mouseWorld;
  if (interaction.mode === "build") {
    const hover = hitTower(world);
    interaction.hoverTowerId = hover ? hover.id : null;
    const startTower = getAutoWallStartTower();
    const preview = getBuildPlacementPreview(world, startTower);
    interaction.buildGhost = { x: preview.x, y: preview.y, invalid: !isPlacementInsideBoundary("tower", preview.x, preview.y) };
    interaction.placementGhost = null;
    interaction.guides = {
      x: preview.guideX,
      y: preview.guideY,
      xPoints: preview.xPoints,
      yPoints: preview.yPoints,
    };
  } else if (interaction.mode === "boundary") {
    interaction.buildGhost = null;
    const preview = getBoundaryPlacementPreview(world);
    interaction.placementGhost = { type: "boundary", x: preview.x, y: preview.y, invalid: false };
    interaction.guides = {
      x: preview.guideX,
      y: preview.guideY,
      xPoints: preview.xPoints,
      yPoints: preview.yPoints,
    };
  } else if (interaction.mode === "hole") {
    interaction.buildGhost = null;
    const preview = getHolePlacementPreview(world);
    interaction.placementGhost = { type: "hole", ...preview };
    interaction.guides = { x: preview.guideX, y: preview.guideY, xPoints: preview.xPoints, yPoints: preview.yPoints };
  } else if (interaction.mode === "spawn" || interaction.mode === "bomb") {
    const preview = getPlacementSnapPreview(world);
    const type = interaction.mode;
    interaction.buildGhost = null;
    interaction.placementGhost = { type, x: preview.x, y: preview.y, invalid: !isPlacementInsideBoundary(type, preview.x, preview.y) };
    interaction.guides = { x: preview.guideX, y: preview.guideY, xPoints: preview.xPoints, yPoints: preview.yPoints };
  }
}

function onMouseUp() {
  const viewChanged = interaction.isPanning;
  interaction.isPanning = false;
  interaction.panStartMouse = null;
  interaction.panStartOffset = null;

  if (interaction.boxSelect) finishBoxSelection();
  if (interaction.drag) finishDrag();
  if (interaction.rotate) finishRotate();
  if (interaction.resize) finishResize();
  if (interaction.mirrorDraft) finishMirrorAxis();
  if (interaction.mirrorAxisDrag) finishMirrorAxisDrag();
  if (viewChanged) saveSession();

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
  saveSession();
  requestRender();
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (conversionSession && key === "escape" && !isTypingInFormControl()) {
    event.preventDefault();
    cancelDeflyConversion();
    return;
  }
  if (conversionSession && !isTypingInFormControl() && (mod || key === "delete" || key === "backspace")) {
    event.preventDefault();
    setActionState("Finish or cancel the map conversion before editing", "warn", true);
    return;
  }
  interaction.snapTemporarilyDisabled = event.ctrlKey;
  if (["build", "boundary", "hole", "spawn", "bomb"].includes(interaction.mode)) {
    refreshPlacementPreviewFromMouse();
    requestRender();
  }

  if (!mod && !event.altKey && !isTypingInFormControl() && isKeyboardPanKey(key)) {
    event.preventDefault();
    keyboardPanKeys.add(key);
    return;
  }

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
    event.preventDefault();
    if (unlinkBuildTower()) return;
    const cancelledHoleDraft = Boolean(interaction.holeDraft);
    interaction.wallDraft = null;
    interaction.holeDraft = null;
    interaction.hoverTowerId = null;
    interaction.towerDraftWarnActive = false;
    interaction.wallDraftWarnActive = false;
    interaction.boxSelect = null;
    interaction.drag = null;
    interaction.rotate = null;
    interaction.resize = null;
    interaction.mirrorDraft = null;
    cancelMirrorAxisDrag();
    interaction.selectedMirrorAxisIndex = null;
    interaction.pasteDraft = null;
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
    setActionState(cancelledHoleDraft ? "Incomplete hole cancelled" : "Draft actions cancelled", "idle", true);
    requestRender();
    return;
  }
  if (mod && key === "c" && !isTypingInFormControl()) {
    event.preventDefault();
    copySelectionToClipboard();
    return;
  }
  if (mod && key === "v" && !isTypingInFormControl()) {
    event.preventDefault();
    startPasteDraft();
    return;
  }
  if (!mod && key === "enter" && interaction.mode === "hole" && interaction.holeDraft && !isTypingInFormControl()) {
    event.preventDefault();
    finishHoleDraft();
    return;
  }
  if (key === "backspace" && interaction.mode === "hole" && interaction.holeDraft && !isTypingInFormControl()) {
    event.preventDefault();
    interaction.holeDraft.points.pop();
    if (!interaction.holeDraft.points.length) interaction.holeDraft = null;
    refreshPlacementPreviewFromMouse();
    setActionState(interaction.holeDraft ? "Removed last hole vertex" : "Incomplete hole cancelled", "idle", true);
    requestRender();
    return;
  }
  if ((key === "delete" || key === "backspace") && !isTypingInFormControl()) {
    event.preventDefault();
    if (deleteSelectedMirrorAxis()) return;
    deleteSelected();
  }
}

function onKeyUp(event) {
  keyboardPanKeys.delete(event.key.toLowerCase());
  interaction.snapTemporarilyDisabled = event.ctrlKey;
  if (["build", "boundary", "hole", "spawn", "bomb"].includes(interaction.mode)) {
    refreshPlacementPreviewFromMouse();
    requestRender();
  }
}

function isKeyboardPanKey(key) {
  return key === "w" || key === "a" || key === "s" || key === "d"
    || key === "arrowup" || key === "arrowleft" || key === "arrowdown" || key === "arrowright";
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
  interaction.snapTemporarilyDisabled = Boolean(event.ctrlKey);
  updateCursorCoordinates();
}

function updateCursorCoordinates() {
  if (!el.cursorCoordinates) return;
  const x = roundTo(interaction.mouseWorld.x, 1);
  const y = roundTo(interaction.mouseWorld.y, 1);
  el.cursorCoordinates.textContent = `X ${x}  Y ${y}`;
  el.cursorCoordinates.classList.toggle("hidden", interaction.mode !== "build");
}

function screenToWorld(screenX, screenY) {
  return { x: (screenX - view.offsetX) / view.scale, y: (screenY - view.offsetY) / view.scale };
}

function worldToScreen(worldX, worldY) {
  return { x: worldX * view.scale + view.offsetX, y: worldY * view.scale + view.offsetY };
}

function handleSelectDown(event, world) {
  const mirrorAxisIndex = hitMirrorAxisIndex(interaction.mouseScreen);
  if (mirrorAxisIndex >= 0) {
    startMirrorAxisDrag(mirrorAxisIndex, world);
    event.preventDefault();
    return;
  }
  interaction.selectedMirrorAxisIndex = null;
  const control = hitSelectionTransformControl(interaction.mouseScreen);
  if (control) {
    const transformable = getTransformableSelectionKeys();
    if (control.type === "rotate") startRotate(transformable, world);
    else if (control.type === "resize") startResize(transformable, world, control.handle);
    else if (control.type === "move") startDrag(transformable, transformable[0], world);
    event.preventDefault();
    return;
  }
  const hit = hitTest(world);
  const transformGesture = event.altKey;
  const multiModifier = !transformGesture && (event.shiftKey || event.ctrlKey || event.metaKey);
  if (!hit) {
    interaction.boxSelect = {
      start: { ...world },
      end: { ...world },
      additive: multiModifier,
      baseSelection: multiModifier ? Array.from(selection) : [],
    };
    if (!multiModifier) {
      selection.clear();
      renderSelectionPanel();
    }
    setActionState("Drag to create selection box", "idle");
    requestRender();
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
  if (!isKeyRepresentedBySelection(key)) {
    selection.clear();
    selection.add(key);
    renderSelectionPanel();
  }
  const transformable = getTransformableSelectionKeys();
  if (event.altKey && event.shiftKey) {
    if (transformable.length > 1 || canResizeSingleSelection(transformable)) startResize(transformable, world);
    else setActionState("Select a group, connected wall, or structure to resize", "warn", true);
    return;
  }
  if (event.altKey && transformable.length > 1) {
    startRotate(transformable, world);
    return;
  }
  const movable = getMovableSelectionKeys();
  const dragKeys = movable.length ? movable : transformable;
  const primaryKey = dragKeys.includes(key) ? key : dragKeys[0];
  if (!primaryKey) {
    requestRender();
    return;
  }
  startDrag(dragKeys, primaryKey, world);
}

function hitMirrorAxisIndex(screen) {
  let bestIndex = -1;
  let bestDistance = 9;
  mirrorState.axes.forEach((axis, index) => {
    if (!isUsableMirrorAxis(axis)) return;
    const a = worldToScreen(axis.a.x, axis.a.y);
    const b = worldToScreen(axis.b.x, axis.b.y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) return;
    const lineDistance = Math.abs((screen.x - a.x) * dy - (screen.y - a.y) * dx) / length;
    if (lineDistance <= bestDistance) {
      bestDistance = lineDistance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function startMirrorAxisDrag(index, world) {
  const axis = mirrorState.axes[index];
  if (!axis) return;
  interaction.selectedMirrorAxisIndex = index;
  interaction.mirrorAxisDrag = {
    index,
    startMouse: { ...world },
    beforeAxis: cloneState(axis),
    beforeAxes: cloneState(mirrorState.axes),
    moved: false,
  };
  setActionState("Moving mirror axis", "idle");
  updateCursor();
}

function applyMirrorAxisDrag(world) {
  const drag = interaction.mirrorAxisDrag;
  const axis = drag ? mirrorState.axes[drag.index] : null;
  if (!drag || !axis) return;
  let dx = world.x - drag.startMouse.x;
  let dy = world.y - drag.startMouse.y;
  if (editorSettings.gridSnapEnabled && !interaction.snapTemporarilyDisabled) {
    const grid = Math.max(4, Number(editorSettings.gridSize) || 48);
    dx = Math.round(dx / grid) * grid;
    dy = Math.round(dy / grid) * grid;
  }
  axis.a.x = roundTo(drag.beforeAxis.a.x + dx, 3);
  axis.a.y = roundTo(drag.beforeAxis.a.y + dy, 3);
  axis.b.x = roundTo(drag.beforeAxis.b.x + dx, 3);
  axis.b.y = roundTo(drag.beforeAxis.b.y + dy, 3);
  drag.moved = Math.hypot(dx, dy) > 0.001;
  setActionState(`Mirror axis offset: ${roundTo(dx, 1)}, ${roundTo(dy, 1)}`, "idle");
}

function finishMirrorAxisDrag() {
  const drag = interaction.mirrorAxisDrag;
  interaction.mirrorAxisDrag = null;
  if (!drag?.moved) {
    setActionState("Mirror axis selected — press Delete to remove it", "idle", true);
    updateCursor();
    requestRender();
    return;
  }
  pushMirrorAxesHistory("MOVE_MIRROR_AXIS", drag.beforeAxes, cloneState(mirrorState.axes));
  saveSession();
  updateMirrorStatus();
  setActionState("Mirror axis moved", "success", true);
  updateCursor();
  requestRender();
}

function cancelMirrorAxisDrag() {
  const drag = interaction.mirrorAxisDrag;
  if (!drag) return;
  mirrorState.axes = cloneState(drag.beforeAxes);
  interaction.mirrorAxisDrag = null;
  updateMirrorStatus();
  requestRender();
}

function deleteSelectedMirrorAxis() {
  const index = interaction.selectedMirrorAxisIndex;
  if (!Number.isInteger(index) || !mirrorState.axes[index]) {
    interaction.selectedMirrorAxisIndex = null;
    return false;
  }
  interaction.selectedMirrorAxisIndex = null;
  return commitMirrorAxesChange(
    "DELETE_MIRROR_AXIS",
    () => mirrorState.axes.splice(index, 1),
    "Mirror axis deleted",
  );
}

function isKeyRepresentedBySelection(key) {
  if (selection.has(key)) return true;
  const entry = resolveKey(key);
  return entry?.type === "hole"
    && entry.item.points.length > 0
    && entry.item.points.every((point) => selection.has(makeKey("holeVertex", point.uid)));
}

function onDoubleClick(event) {
  if (interaction.mode !== "select" || event.button !== 0) return;
  updateMousePosition(event);
  const hit = hitTest(interaction.mouseWorld);
  if (!hit) return;
  const source = resolveKey(hit.key);
  if (!source) return;
  const candidates = source.type === "hole"
    ? state.map_holes.map((item) => ({ type: "hole", item, key: makeKey("hole", item.uid) }))
    : getSelectableEntries().filter((entry) => entry.type === source.type);
  const matching = candidates.filter((entry) => objectsMatchForBatchSelection(source, entry));
  selection.clear();
  matching.forEach((entry) => selection.add(entry.key));
  renderSelectionPanel();
  setActionState(`Selected ${matching.length} matching ${matching.length === 1 ? "object" : "objects"}`, "success", true);
  requestRender();
  event.preventDefault();
}

function objectsMatchForBatchSelection(source, candidate) {
  if (source.type !== candidate.type) return false;
  if (["tower", "spawn", "wall", "structure"].includes(source.type)) {
    const sourceColour = source.item.team_id ?? source.item.color ?? null;
    const candidateColour = candidate.item.team_id ?? candidate.item.color ?? null;
    if (sourceColour !== candidateColour) return false;
  }
  if (source.type === "tower") {
    return Number(source.item.health) === Number(candidate.item.health)
      && Boolean(source.item.is_invincible) === Boolean(candidate.item.is_invincible);
  }
  return true;
}

function getMovableSelectionKeys() {
  const entries = getSelectionEntries().filter((entry) => entry.movable);
  const selectedHoleUids = new Set(entries.filter((entry) => entry.type === "hole").map((entry) => entry.item.uid));
  return entries
    .filter((entry) => entry.type !== "holeVertex" || !selectedHoleUids.has(entry.hole.uid))
    .map((entry) => entry.key);
}

function getTransformableSelectionKeys() {
  const keys = new Set();
  getMovableSelectionKeys().forEach((key) => {
    const entry = resolveKey(key);
    if (!entry) return;
    if (entry.type === "hole") {
      entry.item.points.forEach((point) => keys.add(makeKey("holeVertex", point.uid)));
      return;
    }
    keys.add(key);
  });
  getSelectionEntries().forEach((entry) => {
    if (entry.type !== "wall") return;
    const a = getTowerById(entry.item.t1);
    const b = getTowerById(entry.item.t2);
    if (a) keys.add(makeKey("tower", a.uid));
    if (b) keys.add(makeKey("tower", b.uid));
  });
  return Array.from(keys);
}

function canResizeSingleSelection(keys) {
  if (keys.length !== 1) return false;
  return resolveKey(keys[0])?.type === "structure";
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
    initialTowerOverlaps: getTowerOverlapSignatures(),
    initialTowerWallConflicts: getTowerWallConflictSignatures(),
    initialWallOverlaps: getWallOverlapSignatures(),
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
  const snap = isAnySnappingEnabled() && !interaction.snapTemporarilyDisabled
    ? getDragSnapResult(drag, targetX, targetY, rawDx, rawDy)
    : { x: targetX, y: targetY, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  const candidates = [snap];
  if (editorSettings.gridSnapEnabled && !interaction.snapTemporarilyDisabled) {
    const grid = Math.max(4, Number(editorSettings.gridSize) || 48);
    const isGroup = drag.startPositions.size > 1;
    candidates.push({
      x: isGroup ? anchorStart.x + Math.round(rawDx / grid) * grid : Math.round(targetX / grid) * grid,
      y: isGroup ? anchorStart.y + Math.round(rawDy / grid) * grid : Math.round(targetY / grid) * grid,
      guideX: null, guideY: null, xPoints: [], yPoints: [],
    });
  }
  candidates.push({ x: targetX, y: targetY, guideX: null, guideY: null, xPoints: [], yPoints: [] });
  const uniqueCandidates = candidates.filter((candidate, index, list) => list.findIndex((other) => (
    Math.abs(other.x - candidate.x) < 0.001 && Math.abs(other.y - candidate.y) < 0.001
  )) === index);
  let chosen = null;
  let invalidReason = "";
  for (const candidate of uniqueCandidates) {
    const dx = candidate.x - anchorStart.x;
    const dy = candidate.y - anchorStart.y;
    const reason = getDragInvalidReason(drag, dx, dy);
    if (!reason) {
      chosen = { snap: candidate, dx, dy };
      break;
    }
    invalidReason = reason;
  }
  if (!chosen) {
    setActionState(invalidReason || "Cannot move selection there.", "warn");
    return;
  }
  const { snap: chosenSnap, dx, dy } = chosen;

  drag.startPositions.forEach((pos, key) => setKeyPosition(key, roundTo(pos.x + dx, 3), roundTo(pos.y + dy, 3)));
  interaction.guides = { x: chosenSnap.guideX, y: chosenSnap.guideY, xPoints: chosenSnap.xPoints, yPoints: chosenSnap.yPoints };
  drag.moved = Math.hypot(dx, dy) > 0.001;
  updateLiveSelectionCoordinates();
}

function getDragSnapResult(drag, targetX, targetY, rawDx, rawDy) {
  if (drag.startPositions.size <= 1) return getSnapResult(targetX, targetY, new Set(drag.keys));
  const objectSnap = getSnapResult(targetX, targetY, new Set(drag.keys), { grid: false });
  if (!editorSettings.gridSnapEnabled) return objectSnap;
  const anchorStart = drag.startPositions.get(drag.primaryKey);
  const grid = Math.max(4, Number(editorSettings.gridSize) || 48);
  const gridX = anchorStart.x + Math.round(rawDx / grid) * grid;
  const gridY = anchorStart.y + Math.round(rawDy / grid) * grid;
  const useObjectX = objectSnap.guideX != null && Math.abs(objectSnap.x - targetX) <= Math.abs(gridX - targetX);
  const useObjectY = objectSnap.guideY != null && Math.abs(objectSnap.y - targetY) <= Math.abs(gridY - targetY);
  return {
    x: useObjectX ? objectSnap.x : gridX,
    y: useObjectY ? objectSnap.y : gridY,
    guideX: useObjectX ? objectSnap.guideX : gridX,
    guideY: useObjectY ? objectSnap.guideY : gridY,
    xPoints: useObjectX ? objectSnap.xPoints : [],
    yPoints: useObjectY ? objectSnap.yPoints : [],
  };
}

function getDragInvalidReason(drag, dx, dy) {
  const projectedMapState = getProjectedDragMapState(drag, dx, dy);
  const willExitBoundary = Array.from(drag.startPositions.entries()).some(([key, pos]) => {
    const entry = resolveKey(key);
    if (!entry) return false;
    if (entry.type === "boundary") return false;
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (entry.type === "hole") {
      const projectedHole = projectedMapState.map_holes.find((hole) => hole.uid === entry.item.uid);
      return !projectedHole || !HOLE_GEOMETRY.polygonStrictlyInsideBoundary(projectedHole.points, projectedMapState.map_boundaries);
    }
    return !isPlacementInsideBoundary(entry.type, nx, ny, entry.item, projectedMapState);
  });

  if (willExitBoundary) {
    return "Cannot move objects outside the boundary or into a map hole.";
  }

  const movedTowerTargets = getMovedTowerTargets(drag, dx, dy);
  if (movedTowerTargets.size > 0) {
    if (hasNewConflict(getTowerOverlapSignatures(movedTowerTargets), drag.initialTowerOverlaps)) {
      return "A tower cannot overlap another tower.";
    }
    if (hasNewConflict(getTowerWallConflictSignatures(movedTowerTargets), drag.initialTowerWallConflicts)) {
      return "A tower cannot overlap an existing wall.";
    }
    if (hasNewConflict(getWallOverlapSignatures(movedTowerTargets), drag.initialWallOverlaps)) {
      return "Walls cannot overlap or intersect.";
    }
  }
  return "";
}

function getProjectedDragMapState(drag, dx, dy) {
  const baseState = drag.beforeState;
  const targetFor = (key, fallback) => {
    const start = drag.startPositions.get(key);
    return start ? { x: roundTo(start.x + dx, 3), y: roundTo(start.y + dy, 3) } : fallback;
  };
  const mapBoundaries = baseState.map_boundaries.map((point) => ({
    ...point,
    ...targetFor(makeKey("boundary", point.uid), { x: point.x, y: point.y }),
  }));
  const mapHoles = baseState.map_holes.map((hole) => {
    const wholeHoleKey = makeKey("hole", hole.uid);
    if (drag.startPositions.has(wholeHoleKey)) {
      return {
        ...hole,
        points: hole.points.map((point) => ({ ...point, x: roundTo(point.x + dx, 3), y: roundTo(point.y + dy, 3) })),
      };
    }
    return {
      ...hole,
      points: hole.points.map((point) => ({
        ...point,
        ...targetFor(makeKey("holeVertex", point.uid), { x: point.x, y: point.y }),
      })),
    };
  });
  return { ...baseState, map_boundaries: mapBoundaries, map_holes: mapHoles };
}

function getMovedTowerTargets(drag, dx, dy) {
  const overrides = new Map();
  drag.keys.forEach((key) => {
    const entry = resolveKey(key);
    if (!entry || entry.type !== "tower") return;
    const start = drag.startPositions.get(key);
    if (!start) return;
    overrides.set(entry.item.id, { x: roundTo(start.x + dx, 3), y: roundTo(start.y + dy, 3) });
  });
  return overrides;
}

function finishDrag() {
  const drag = interaction.drag;
  interaction.drag = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  updateCursor();
  if (!drag || !drag.moved) return;
  applyLiveMirroring(drag.beforeState);
  pushHistory("MOVE_MULTI", drag.beforeState, cloneState(state));
  onStateChanged();
}

function startRotate(keysToRotate, world) {
  const startPositions = new Map();
  keysToRotate.forEach((key) => {
    const p = getKeyPosition(key);
    if (p) startPositions.set(key, p);
  });
  if (startPositions.size < 2) return;
  const center = getPositionMapCenter(startPositions);
  interaction.rotate = {
    keys: Array.from(startPositions.keys()),
    keySet: new Set(startPositions.keys()),
    center,
    startAngle: Math.atan2(world.y - center.y, world.x - center.x),
    startPositions,
    beforeState: cloneState(state),
    moved: false,
    invalid: false,
    invalidReason: "",
    wallSnapGuide: null,
  };
  setActionState("Rotating selection", "idle");
}

function applyRotate(world) {
  const rotate = interaction.rotate;
  if (!rotate) return;
  const rawAngle = Math.atan2(world.y - rotate.center.y, world.x - rotate.center.x) - rotate.startAngle;
  const snap = interaction.snapTemporarilyDisabled
    ? { angle: rawAngle, guide: null }
    : getRotationSnap(rawAngle, rotate);
  const angle = snap.angle;
  const nextPositions = new Map();

  rotate.startPositions.forEach((pos, key) => {
    const rotated = rotatePoint(pos.x, pos.y, rotate.center.x, rotate.center.y, angle);
    nextPositions.set(key, { x: roundTo(rotated.x, 3), y: roundTo(rotated.y, 3) });
  });

  let invalidReason = "";
  const willExitBoundary = Array.from(nextPositions.entries()).some(([key, pos]) => {
    const entry = resolveKey(key);
    if (!entry || entry.type === "boundary") return false;
    return !isPlacementInsideBoundary(entry.type, pos.x, pos.y, entry.item);
  });
  if (willExitBoundary) {
    invalidReason = "Selection is outside map boundary.";
  }

  const movedTowerTargets = getTowerTargetsFromPositionMap(nextPositions);
  if (movedTowerTargets.size > 0) {
    if (!invalidReason && hasTowerOverlapConflict(movedTowerTargets)) invalidReason = "A tower overlaps another tower.";
    if (!invalidReason && hasTowerOnWallConflict(movedTowerTargets)) invalidReason = "A tower overlaps an existing wall.";
    if (!invalidReason && findWallOverlap(movedTowerTargets)) invalidReason = "Walls overlap or intersect.";
  }

  rotate.invalid = Boolean(invalidReason);
  rotate.invalidReason = invalidReason;
  rotate.wallSnapGuide = snap.guide;
  nextPositions.forEach((pos, key) => setKeyPosition(key, pos.x, pos.y));
  rotate.moved = Math.abs(angle) > 0.001;
  updateLiveSelectionCoordinates();
  setActionState(invalidReason || "Rotating selection", invalidReason ? "warn" : "idle");
}

function finishRotate() {
  const rotate = interaction.rotate;
  const invalidReason = rotate && rotate.invalidReason;
  interaction.rotate = null;
  if (!rotate || !rotate.moved) return;
  applyLiveMirroring(rotate.beforeState);
  pushHistory("ROTATE_MULTI", rotate.beforeState, cloneState(state));
  onStateChanged();
  if (invalidReason) setActionState(`${invalidReason} Export validation may fail.`, "warn");
}

function getPositionMapCenter(positionMap) {
  const points = Array.from(positionMap.values());
  const total = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function getTowerTargetsFromPositionMap(positionMap) {
  const overrides = new Map();
  positionMap.forEach((pos, key) => {
    const entry = resolveKey(key);
    if (entry && entry.type === "tower") overrides.set(entry.item.id, { x: pos.x, y: pos.y });
  });
  return overrides;
}

function getRotationSnap(rawAngle, rotate) {
  const threshold = degreesToRadians(GAME.ROTATION_SNAP_THRESHOLD_DEGREES);
  const step = degreesToRadians(GAME.ROTATION_SNAP_DEGREES);
  const baseAngle = Math.round(rawAngle / step) * step;
  const candidates = [];
  const baseDelta = angleDistance(rawAngle, baseAngle);
  if (baseDelta <= threshold) candidates.push({ angle: baseAngle, delta: baseDelta, guide: null });
  candidates.push(...getWallRotationSnapCandidates(rawAngle, rotate, threshold));
  if (!candidates.length) return { angle: rawAngle, guide: null };
  candidates.sort((a, b) => a.delta - b.delta || (a.guide ? -1 : 1));
  return { angle: candidates[0].angle, guide: candidates[0].guide || null };
}

function getWallRotationSnapCandidates(rawAngle, rotate, angleThreshold) {
  const selectedWalls = getRotatingWallSources(rotate);
  if (!selectedWalls.length) return [];
  const targets = getExternalWallTargets(rotate);
  if (!targets.length) return [];
  const lineThreshold = editorSettings.snapStrength / Math.max(view.scale, 0.0001);
  const candidates = [];

  selectedWalls.forEach((source) => {
    targets.forEach((target) => {
      const candidateAngle = nearestEquivalentAngle(target.angle - source.startAngle, rawAngle, Math.PI);
      const delta = angleDistance(rawAngle, candidateAngle);
      if (delta > angleThreshold) return;
      const a = rotatePoint(source.startA.x, source.startA.y, rotate.center.x, rotate.center.y, candidateAngle);
      const b = rotatePoint(source.startB.x, source.startB.y, rotate.center.x, rotate.center.y, candidateAngle);
      const lineDistance = Math.max(
        pointToInfiniteLineDistance(a, target.a, target.b),
        pointToInfiniteLineDistance(b, target.a, target.b),
      );
      if (lineDistance > lineThreshold) return;
      candidates.push({
        angle: candidateAngle,
        delta,
        guide: {
          source: { a, b },
          target: { a: target.a, b: target.b },
        },
      });
    });
  });
  return candidates;
}

function getRotatingWallSources(rotate) {
  const sources = [];
  state.walls.forEach((wall) => {
    const aTower = getTowerById(wall.t1);
    const bTower = getTowerById(wall.t2);
    if (!aTower || !bTower) return;
    const aKey = makeKey("tower", aTower.uid);
    const bKey = makeKey("tower", bTower.uid);
    if (!rotate.keySet.has(aKey) || !rotate.keySet.has(bKey)) return;
    const startA = rotate.startPositions.get(aKey);
    const startB = rotate.startPositions.get(bKey);
    if (!startA || !startB) return;
    sources.push({
      wall,
      startA,
      startB,
      startAngle: lineAngle(startA, startB),
    });
  });
  return sources;
}

function getExternalWallTargets(rotate) {
  const targets = [];
  state.walls.forEach((wall) => {
    const aTower = getTowerById(wall.t1);
    const bTower = getTowerById(wall.t2);
    if (!aTower || !bTower) return;
    if (rotate.keySet.has(makeKey("tower", aTower.uid)) || rotate.keySet.has(makeKey("tower", bTower.uid))) return;
    const a = { x: aTower.x, y: aTower.y };
    const b = { x: bTower.x, y: bTower.y };
    targets.push({ wall, a, b, angle: lineAngle(a, b) });
  });
  return targets;
}

function finishBoxSelection() {
  const box = interaction.boxSelect;
  interaction.boxSelect = null;
  if (!box) return;
  const minX = Math.min(box.start.x, box.end.x);
  const maxX = Math.max(box.start.x, box.end.x);
  const minY = Math.min(box.start.y, box.end.y);
  const maxY = Math.max(box.start.y, box.end.y);
  const nextSelection = new Set(box.additive ? (box.baseSelection || []) : []);
  getSelectableEntries().forEach((entry) => {
    const c = getEntryCenter(entry);
    if (!c) return;
    if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) nextSelection.add(entry.key);
  });
  selection.clear();
  nextSelection.forEach((key) => selection.add(key));
  renderSelectionPanel();
  setActionState(selection.size ? `Selected ${selection.size} item(s)` : "Selection box found no entities", selection.size ? "success" : "idle", true);
}

function getPlacementRestriction(type, x, y, item = null, mapState = state) {
  if (!isPlacementInsideOuterBoundary(type, x, y, item, mapState)) return "outside the map boundary";
  if (type === "tower" || type === "spawn") {
    const holeIndex = HOLE_GEOMETRY.findContainingHoleIndex({ x, y }, mapState.map_holes);
    if (holeIndex >= 0) return `inside or on hole ${holeIndex}`;
  }
  if (type === "bomb") {
    const holeIndex = HOLE_GEOMETRY.findCircleOverlappingHoleIndex({ x, y }, 250, mapState.map_holes);
    if (holeIndex >= 0) return `overlapping hole ${holeIndex}`;
  }
  return "";
}

function placeSpawn(world) {
  const target = interaction.placementGhost && interaction.placementGhost.type === "spawn"
    ? interaction.placementGhost
    : getPlacementSnapPreview(world);
  if (!isPlacementInsideBoundary("spawn", target.x, target.y)) {
    setActionState(`Cannot place spawn ${getPlacementRestriction("spawn", target.x, target.y)}.`, "warn", true);
    return;
  }
  if (defaults.defaultTeam !== 0 && defaults.defaultTeam !== 1) {
    setActionState("Spawn team 'None' is not exportable", "warn", true);
    return;
  }
  withAction("PLACE_SPAWN", () => {
    const existing = state.spawn_points.find((point) => point.team_id === defaults.defaultTeam);
    if (existing) {
      existing.x = roundTo(target.x, 3);
      existing.y = roundTo(target.y, 3);
      selection.clear();
      selection.add(makeKey("spawn", existing.uid));
      return true;
    }
    const spawn = { uid: createUid("spawn"), team_id: defaults.defaultTeam, x: roundTo(target.x, 3), y: roundTo(target.y, 3) };
    state.spawn_points.push(spawn);
    selection.clear();
    selection.add(makeKey("spawn", spawn.uid));
    return true;
  });
  renderSelectionPanel();
  setActionState(`Spawn for ${TEAM_LABELS[String(defaults.defaultTeam)]} set`, "success", true);
}

function placeBomb(world) {
  const target = interaction.placementGhost && interaction.placementGhost.type === "bomb"
    ? interaction.placementGhost
    : getPlacementSnapPreview(world);
  if (!isPlacementInsideBoundary("bomb", target.x, target.y)) {
    setActionState(`Cannot place bomb site ${getPlacementRestriction("bomb", target.x, target.y)}.`, "warn", true);
    return;
  }
  withAction("PLACE_BOMB", () => {
    const site = { uid: createUid("bomb"), site_letter: nextBombSiteLetter(), x: roundTo(target.x, 3), y: roundTo(target.y, 3) };
    state.bomb_sites.push(site);
    selection.clear();
    selection.add(makeKey("bomb", site.uid));
    return true;
  });
  renderSelectionPanel();
  setActionState("Bomb site placed", "success", true);
}

function placeTower(world) {
  const startTower = getAutoWallStartTower();
  const buildTarget = getBuildPlacementTarget(world, startTower);
  const targetTower = hitTower(world) || hitTower(buildTarget);

  if (startTower && targetTower) {
    if (!isPlacementInsideBoundary("tower", startTower.x, startTower.y) || !isPlacementInsideBoundary("tower", targetTower.x, targetTower.y)) {
      setActionState("Cannot build wall outside map boundary.", "warn", true);
      return;
    }
    if (targetTower.id === startTower.id) {
      setActionState("A tower cannot connect to itself.", "warn", true);
      return;
    }
    if (targetTower.team_id !== startTower.team_id) {
      setActionState("Cannot connect towers with different team colors.", "error", true);
      return;
    }
    if (hasDuplicateWall(startTower.id, targetTower.id)) {
      selection.clear();
      selection.add(makeKey("tower", targetTower.uid));
      renderSelectionPanel();
      setActionState("This wall already exists.", "warn", true);
      return;
    }
    const length = distance(startTower.x, startTower.y, targetTower.x, targetTower.y);
    if (findWallOverlapForSegment({ x: startTower.x, y: startTower.y }, { x: targetTower.x, y: targetTower.y }, startTower.id, targetTower.id)) {
      setActionState("Walls cannot overlap or intersect.", "error", true);
      return;
    }
    withAction("CREATE_WALL", () => {
      state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: startTower.id, t2: targetTower.id, team_id: startTower.team_id });
      selection.clear();
      selection.add(makeKey("tower", targetTower.uid));
      return true;
    });
    interaction.towerDraftWarnActive = false;
    renderSelectionPanel();
    setActionState(`Wall created (${Math.round(length)} units)`, "success", true);
    return;
  }

  if (targetTower) {
    selection.clear();
    selection.add(makeKey("tower", targetTower.uid));
    renderSelectionPanel();
    setActionState("Cannot place a tower on top of another tower.", "warn", true);
    return;
  }

  withAction("PLACE_TOWER", () => {
    const startTower = getAutoWallStartTower();
    let x = roundTo(buildTarget.x, 3);
    let y = roundTo(buildTarget.y, 3);
    const teamId = startTower ? startTower.team_id : defaults.defaultTeam;
    if (!isPlacementInsideBoundary("tower", x, y)) {
      setActionState(`Cannot place tower ${getPlacementRestriction("tower", x, y)}.`, "warn", true);
      return false;
    }
    if (hasTowerOverlapAt(x, y)) {
      setActionState("Cannot place a tower on top of another tower.", "warn", true);
      return false;
    }
    if (isTowerPositionOnWall(x, y)) {
      setActionState("Cannot place tower on top of an existing wall.", "warn", true);
      return false;
    }
    if (startTower) {
      const overlap = findWallOverlapForSegment({ x: startTower.x, y: startTower.y }, { x, y }, startTower.id, null);
      if (overlap) {
        setActionState("Walls cannot overlap or intersect.", "error", true);
        return false;
      }
    }
    const tower = {
      uid: createUid("tower"),
      id: nextTowerId(),
      team_id: teamId,
      x,
      y,
      health: clamp(1, Math.round(defaults.towerHealth), GAME.TOWER_MAX_HEALTH),
      is_invincible: defaults.towerInvincible,
    };
    state.towers.push(tower);
    if (startTower && !hasDuplicateWall(startTower.id, tower.id)) {
      state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: startTower.id, t2: tower.id, team_id: startTower.team_id });
    }
    interaction.towerDraftWarnActive = false;
    selection.clear();
    selection.add(makeKey("tower", tower.uid));
    setActionState("Tower placed", "success", true);
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
    interaction.wallDraftWarnActive = false;
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
    interaction.wallDraftWarnActive = false;
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
  if (a.team_id !== b.team_id) {
    setActionState("Connected towers must share the same team color.", "error", true);
    return;
  }
  const length = distance(a.x, a.y, b.x, b.y);
  if (findWallOverlapForSegment({ x: a.x, y: a.y }, { x: b.x, y: b.y }, a.id, b.id)) {
    setActionState("Walls cannot overlap or intersect.", "error", true);
    return;
  }
  withAction("CREATE_WALL", () => {
    state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: startId, t2: endId, team_id: a.team_id });
    selection.clear();
    selection.add(makeKey("wall", state.walls[state.walls.length - 1].uid));
    return true;
  });
  interaction.wallDraft = null;
  interaction.hoverTowerId = null;
  interaction.wallDraftWarnActive = false;
  renderSelectionPanel();
  setActionState(`Wall created (${Math.round(length)} units)`, "success", true);
}

function getAutoWallStartTower() {
  if (interaction.mode !== "build") return null;
  if (selection.size !== 1) return null;
  const [key] = Array.from(selection);
  const entry = resolveKey(key);
  if (!entry || entry.type !== "tower") return null;
  return entry.item;
}

function unlinkBuildTower() {
  const startTower = getAutoWallStartTower();
  if (!startTower) return false;
  selection.clear();
  interaction.hoverTowerId = null;
  interaction.towerDraftWarnActive = false;
  interaction.wallDraftWarnActive = false;
  renderSelectionPanel();
  refreshPlacementPreviewFromMouse();
  setActionState("Build link cleared", "idle", true);
  requestRender();
  return true;
}

function getBuildPlacementTarget(world, startTower = null) {
  const preview = getBuildPlacementPreview(world, startTower);
  return { x: preview.x, y: preview.y };
}

function getBuildPlacementPreview(world, startTower = null) {
  const objectEnabled = editorSettings.buildModeSnapEnabled && interaction.snapEnabled && editorSettings.objectSnapEnabled;
  if ((!objectEnabled && !editorSettings.gridSnapEnabled) || interaction.snapTemporarilyDisabled) {
    return { x: world.x, y: world.y, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  }
  const exclude = new Set();
  return getSnapResult(world.x, world.y, exclude, { object: objectEnabled, grid: true });
}

function getBoundaryPlacementPreview(world) {
  if (interaction.snapTemporarilyDisabled) {
    return { x: world.x, y: world.y, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  }
  const candidates = state.map_boundaries.map((point) => ({ x: point.x, y: point.y }));
  const threshold = editorSettings.snapStrength / Math.max(view.scale, 0.0001);
  let bestX = null;
  let bestY = null;
  candidates.forEach((candidate) => {
    const dx = Math.abs(candidate.x - world.x);
    const dy = Math.abs(candidate.y - world.y);
    if (dx <= threshold && (!bestX || dx < bestX.delta)) bestX = { value: candidate.x, delta: dx };
    if (dy <= threshold && (!bestY || dy < bestY.delta)) bestY = { value: candidate.y, delta: dy };
  });
  const grid = getSnapResult(world.x, world.y, new Set(), { object: false, grid: true });
  const gridDx = Math.abs(grid.x - world.x);
  const gridDy = Math.abs(grid.y - world.y);
  const useObjectX = bestX && (!editorSettings.gridSnapEnabled || bestX.delta <= gridDx);
  const useObjectY = bestY && (!editorSettings.gridSnapEnabled || bestY.delta <= gridDy);
  const x = useObjectX ? bestX.value : grid.x;
  const y = useObjectY ? bestY.value : grid.y;
  return {
    x,
    y,
    guideX: useObjectX ? x : grid.guideX,
    guideY: useObjectY ? y : grid.guideY,
    xPoints: useObjectX ? candidates.filter((candidate) => Math.abs(candidate.x - x) <= 0.001) : [],
    yPoints: useObjectY ? candidates.filter((candidate) => Math.abs(candidate.y - y) <= 0.001) : [],
  };
}

function getHolePlacementPreview(world) {
  const snapped = getPlacementSnapPreview(world);
  const draftPoints = interaction.holeDraft?.points || [];
  const first = draftPoints[0];
  const closeThreshold = 18 / Math.max(view.scale, 0.0001);
  const closing = Boolean(first && draftPoints.length >= 3 && distance(snapped.x, snapped.y, first.x, first.y) <= closeThreshold);
  const point = closing ? first : snapped;
  const invalid = closing
    ? getHoleDraftValidationIssue(draftPoints)?.message || ""
    : !isHoleAuthorPointAllowed(point);
  return { ...snapped, x: point.x, y: point.y, closing, invalid: Boolean(invalid), invalidReason: invalid || "" };
}

function isHoleAuthorPointAllowed(point) {
  if (!HOLE_GEOMETRY.pointInPolygon(point, state.map_boundaries, false)) return false;
  return HOLE_GEOMETRY.findContainingHoleIndex(point, state.map_holes) < 0;
}

function handleHoleAuthorClick(world) {
  const preview = interaction.placementGhost?.type === "hole"
    ? interaction.placementGhost
    : getHolePlacementPreview(world);
  if (preview.closing) {
    finishHoleDraft();
    return;
  }
  if (preview.invalid) {
    setActionState("Hole vertices must be strictly inside the boundary and outside other holes.", "warn", true);
    return;
  }
  if (!interaction.holeDraft) interaction.holeDraft = { points: [] };
  if (interaction.holeDraft.points.some((point) => HOLE_GEOMETRY.pointsEqual(point, preview))) {
    setActionState("Hole vertices must be distinct. Click the first vertex to close after adding at least three.", "warn", true);
    return;
  }
  interaction.holeDraft.points.push({ x: roundTo(preview.x, 3), y: roundTo(preview.y, 3) });
  setActionState(interaction.holeDraft.points.length < 3
    ? `Hole vertex ${interaction.holeDraft.points.length} added`
    : "Hole vertex added. Click the first vertex or press Enter to close.", "success", true);
  refreshPlacementPreviewFromMouse();
  requestRender();
}

function getHoleDraftValidationIssue(points) {
  const draftHole = {
    uid: "draft_hole",
    points: points.map((point, index) => ({ uid: `draft_vertex_${index}`, x: point.x, y: point.y })),
  };
  const candidate = { ...state, map_holes: [...state.map_holes, draftHole] };
  const draftIndex = candidate.map_holes.length - 1;
  return HOLE_GEOMETRY.validateMapHoles(candidate).find((issue) => issue.holeIndexes.includes(draftIndex)) || null;
}

function finishHoleDraft() {
  const points = interaction.holeDraft?.points || [];
  if (HOLE_GEOMETRY.distinctPointCount(points) < 3) {
    setActionState("A hole needs at least three distinct vertices before it can be closed.", "warn", true);
    return false;
  }
  const validationIssue = getHoleDraftValidationIssue(points);
  if (validationIssue) {
    setActionState(validationIssue.message, "warn");
    return false;
  }
  let createdHole = null;
  withAction("CREATE_HOLE", () => {
    createdHole = {
      uid: createUid("hole"),
      points: points.map((point) => ({ uid: createUid("hole_vertex"), x: point.x, y: point.y })),
    };
    state.map_holes.push(createdHole);
    selection.clear();
    selection.add(makeKey("hole", createdHole.uid));
    interaction.holeDraft = null;
    interaction.placementGhost = null;
    return true;
  });
  renderSelectionPanel();
  refreshPlacementPreviewFromMouse();
  setActionState(`Hole ${state.map_holes.indexOf(createdHole)} created`, "success", true);
  return true;
}

function getHoleCenter(hole) {
  const points = hole?.points || [];
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function moveHoleTo(hole, x, y) {
  const center = getHoleCenter(hole);
  const dx = x - center.x;
  const dy = y - center.y;
  hole.points.forEach((point) => {
    point.x = roundTo(point.x + dx, 3);
    point.y = roundTo(point.y + dy, 3);
  });
}

function copySelectionToClipboard() {
  const clipboard = buildSelectionClipboard();
  if (!clipboard) {
    setActionState("No copyable objects selected", "warn", true);
    return;
  }
  editorClipboard = clipboard;
  startPasteDraft();
  const count = getClipboardObjectCount(clipboard);
  setActionState(`Copied ${count} object${count === 1 ? "" : "s"}`, "success", true);
}

function buildSelectionClipboard() {
  const entries = getSelectionEntries();
  const towerIds = new Set();
  const wallsByUid = new Map();
  const holeUids = new Set();
  const spawns = [];
  const bombs = [];
  const structures = [];
  const boundaries = [];

  entries.forEach((entry) => {
    if (entry.type === "tower") towerIds.add(entry.item.id);
    else if (entry.type === "spawn") spawns.push(cloneState(entry.item));
    else if (entry.type === "bomb") bombs.push(cloneState(entry.item));
    else if (entry.type === "structure") structures.push(cloneState(entry.item));
    else if (entry.type === "boundary") boundaries.push(cloneState(entry.item));
    else if (entry.type === "hole") holeUids.add(entry.item.uid);
    else if (entry.type === "holeVertex") holeUids.add(entry.hole.uid);
    else if (entry.type === "wall") {
      wallsByUid.set(entry.item.uid, cloneState(entry.item));
      towerIds.add(entry.item.t1);
      towerIds.add(entry.item.t2);
    }
  });

  state.walls.forEach((wall) => {
    if (towerIds.has(wall.t1) && towerIds.has(wall.t2)) wallsByUid.set(wall.uid, cloneState(wall));
  });

  const towers = state.towers.filter((tower) => towerIds.has(tower.id)).map((tower) => cloneState(tower));
  const holes = state.map_holes.filter((hole) => holeUids.has(hole.uid)).map((hole) => cloneState(hole));
  const centers = [
    ...towers.map((item) => ({ x: item.x, y: item.y })),
    ...spawns.map((item) => ({ x: item.x, y: item.y })),
    ...bombs.map((item) => ({ x: item.x, y: item.y })),
    ...structures.map((item) => ({ x: item.x, y: item.y })),
    ...boundaries.map((item) => ({ x: item.x, y: item.y })),
    ...holes.flatMap((hole) => hole.points.map((point) => ({ x: point.x, y: point.y }))),
  ];

  if (!centers.length) {
    return null;
  }

  const origin = centers.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  origin.x /= centers.length;
  origin.y /= centers.length;

  const withOffset = (item) => ({ ...item, dx: item.x - origin.x, dy: item.y - origin.y });
  return {
    towers: towers.map(withOffset),
    spawns: spawns.map(withOffset),
    bombs: bombs.map(withOffset),
    structures: structures.map(withOffset),
    boundaries: boundaries.map(withOffset),
    holes: holes.map((hole) => ({ points: hole.points.map(withOffset) })),
    walls: Array.from(wallsByUid.values()).filter((wall) => towerIds.has(wall.t1) && towerIds.has(wall.t2)),
    origin,
  };
}

function getClipboardObjectCount(clipboard) {
  return ["towers", "spawns", "bombs", "structures", "walls", "boundaries", "holes"]
    .reduce((total, key) => total + (Array.isArray(clipboard?.[key]) ? clipboard[key].length : 0), 0);
}

function normalizeCustomShapeClipboard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Custom shape data must be an object.");
  const list = (key) => {
    if (value[key] === undefined) return [];
    if (!Array.isArray(value[key])) throw new Error(`Custom shape ${key} must be an array.`);
    return value[key];
  };
  const offset = (item, path) => ({
    dx: roundTo(expectNumber(item?.dx, `${path}.dx`), 3),
    dy: roundTo(expectNumber(item?.dy, `${path}.dy`), 3),
  });
  const sortObjects = (items) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sourceTowerIds = new Set();
  const towers = list("towers").map((tower, index) => {
    const id = expectInteger(tower?.id, `towers[${index}].id`);
    if (sourceTowerIds.has(id)) throw new Error(`Custom shape has duplicate tower ID ${id}.`);
    sourceTowerIds.add(id);
    return {
      sourceId: id,
      ...offset(tower, `towers[${index}]`),
      team_id: expectInteger(tower?.team_id, `towers[${index}].team_id`),
      health: clamp(1, Math.round(Number(tower?.health) || GAME.TOWER_MAX_HEALTH), GAME.TOWER_MAX_HEALTH),
      is_invincible: Boolean(tower?.is_invincible),
    };
  });
  towers.sort((a, b) => {
    const aKey = JSON.stringify({ dx: a.dx, dy: a.dy, team_id: a.team_id, health: a.health, is_invincible: a.is_invincible });
    const bKey = JSON.stringify({ dx: b.dx, dy: b.dy, team_id: b.team_id, health: b.health, is_invincible: b.is_invincible });
    return aKey.localeCompare(bKey) || a.sourceId - b.sourceId;
  });
  const towerIdMap = new Map(towers.map((tower, index) => [tower.sourceId, index + 1]));
  const normalizedTowers = towers.map((tower, index) => ({
    id: index + 1,
    dx: tower.dx,
    dy: tower.dy,
    team_id: tower.team_id,
    health: tower.health,
    is_invincible: tower.is_invincible,
  }));
  const spawns = sortObjects(list("spawns").map((spawn, index) => ({
    ...offset(spawn, `spawns[${index}]`),
    team_id: expectInteger(spawn?.team_id, `spawns[${index}].team_id`),
  })));
  const bombs = sortObjects(list("bombs").map((bomb, index) => ({
    ...offset(bomb, `bombs[${index}]`),
    site_letter: String(bomb?.site_letter || "A").slice(0, 4).toUpperCase(),
  })));
  const structures = sortObjects(list("structures").map((structure, index) => ({
    ...offset(structure, `structures[${index}]`),
    size: Math.max(1, expectNumber(structure?.size, `structures[${index}].size`)),
    label: String(structure?.label || ""),
    color: String(structure?.color || COLORS.concrete),
    team_id: expectInteger(structure?.team_id, `structures[${index}].team_id`),
  })));
  const boundaries = list("boundaries").map((boundary, index) => offset(boundary, `boundaries[${index}]`));
  const holes = sortObjects(list("holes").map((hole, holeIndex) => {
    if (!Array.isArray(hole?.points)) throw new Error(`holes[${holeIndex}].points must be an array.`);
    if (hole.points.length < 3) throw new Error(`holes[${holeIndex}] must contain at least 3 points.`);
    return { points: hole.points.map((point, pointIndex) => offset(point, `holes[${holeIndex}].points[${pointIndex}]`)) };
  }));
  const walls = sortObjects(list("walls").map((wall, index) => {
    const mappedA = towerIdMap.get(expectInteger(wall?.t1, `walls[${index}].t1`));
    const mappedB = towerIdMap.get(expectInteger(wall?.t2, `walls[${index}].t2`));
    if (!mappedA || !mappedB) throw new Error(`Custom shape wall ${index} references a missing tower.`);
    if (mappedA === mappedB) throw new Error(`Custom shape wall ${index} connects a tower to itself.`);
    return {
      t1: Math.min(mappedA, mappedB),
      t2: Math.max(mappedA, mappedB),
      team_id: expectInteger(wall?.team_id, `walls[${index}].team_id`),
    };
  }));
  if (!getClipboardObjectCount({ towers: normalizedTowers, spawns, bombs, structures, walls, boundaries, holes })) {
    throw new Error("Custom shape contains no supported objects.");
  }
  return { towers: normalizedTowers, spawns, bombs, structures, walls, boundaries, holes, origin: { x: 0, y: 0 } };
}

function getCustomShapeSignature(clipboard) {
  return JSON.stringify(normalizeCustomShapeClipboard(clipboard));
}

function normalizeCustomShape(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`custom_shapes[${index}] must be an object.`);
  const name = String(value.name || "").trim().slice(0, 60);
  if (!name) throw new Error(`custom_shapes[${index}].name is required.`);
  const clipboard = normalizeCustomShapeClipboard(value.clipboard || value.shape || value.data);
  return {
    id: String(value.id || createUid("custom_shape")),
    name,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now(),
    clipboard,
    signature: getCustomShapeSignature(clipboard),
  };
}

function saveSelectionAsCustomShape() {
  const name = String(el.customShapeNameInput?.value || "").trim().slice(0, 60);
  if (!name) {
    setActionState("Enter a name for the custom shape", "warn", true);
    el.customShapeNameInput?.focus?.();
    return false;
  }
  const source = buildSelectionClipboard();
  if (!source) {
    setActionState("Select at least one supported object first", "warn", true);
    return false;
  }
  const clipboard = normalizeCustomShapeClipboard(source);
  const signature = getCustomShapeSignature(clipboard);
  if (customShapes.some((shape) => shape.signature === signature)) {
    setActionState("That custom shape is already saved", "warn", true);
    return false;
  }
  customShapes.push({ id: createUid("custom_shape"), name, createdAt: Date.now(), clipboard, signature });
  persistCustomShapes();
  renderCustomShapes();
  el.customShapeNameInput.value = "";
  setActionState(`Saved custom shape “${name}”`, "success", true);
  return true;
}

function useCustomShape(id) {
  if (conversionSession) {
    setActionState("Finish or cancel the map conversion before placing a custom shape", "warn", true);
    return false;
  }
  const shape = customShapes.find((item) => item.id === id);
  if (!shape) return false;
  editorClipboard = cloneState(shape.clipboard);
  setMode("select");
  startPasteDraft();
  setActionState(`“${shape.name}” ready — left click to place`, "success", true);
  return true;
}

function deleteCustomShape(id) {
  const shape = customShapes.find((item) => item.id === id);
  if (!shape || !confirm(`Delete custom shape “${shape.name}”?`)) return false;
  customShapes = customShapes.filter((item) => item.id !== id);
  persistCustomShapes();
  renderCustomShapes();
  setActionState(`Deleted custom shape “${shape.name}”`, "success", true);
  return true;
}

function renderCustomShapes() {
  if (!el.customShapesList) return;
  el.customShapesList.innerHTML = "";
  if (!customShapes.length) {
    const empty = document.createElement("p");
    empty.className = "muted compact-note";
    empty.textContent = "No custom shapes saved yet.";
    el.customShapesList.appendChild(empty);
  }
  customShapes.forEach((shape) => {
    const card = document.createElement("div");
    card.className = "custom-shape-card";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "custom-shape-use";
    const title = document.createElement("strong");
    title.textContent = shape.name;
    const meta = document.createElement("span");
    const count = getClipboardObjectCount(shape.clipboard);
    meta.textContent = `${count} object${count === 1 ? "" : "s"} · click to place`;
    use.appendChild(title);
    use.appendChild(meta);
    use.addEventListener("click", () => useCustomShape(shape.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "custom-shape-delete";
    remove.title = `Delete ${shape.name}`;
    remove.setAttribute?.("aria-label", `Delete ${shape.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => deleteCustomShape(shape.id));
    card.appendChild(use);
    card.appendChild(remove);
    el.customShapesList.appendChild(card);
  });
  if (el.exportCustomShapesBtn) el.exportCustomShapesBtn.disabled = customShapes.length === 0;
}

function persistCustomShapes() {
  try {
    localStorage.setItem(CUSTOM_SHAPES_STORAGE_KEY, JSON.stringify({
      type: CUSTOM_SHAPES_FILE_TYPE,
      version: 1,
      custom_shapes: customShapes.map(({ id, name, createdAt, clipboard }) => ({ id, name, createdAt, clipboard })),
    }));
  } catch (error) {
    console.warn("Could not save custom shapes.", error);
    setActionState("Could not save custom shapes locally", "warn", true);
  }
}

function restoreCustomShapes() {
  try {
    const raw = localStorage.getItem(CUSTOM_SHAPES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : parsed?.custom_shapes;
    if (!Array.isArray(values)) return;
    const seen = new Set();
    customShapes = values.map(normalizeCustomShape).filter((shape) => {
      if (seen.has(shape.signature)) return false;
      seen.add(shape.signature);
      return true;
    });
  } catch (error) {
    console.warn("Could not restore custom shapes.", error);
    customShapes = [];
  }
}

function downloadJsonFile(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportCustomShapes() {
  if (!customShapes.length) {
    setActionState("There are no custom shapes to export", "warn", true);
    return;
  }
  downloadJsonFile({
    type: CUSTOM_SHAPES_FILE_TYPE,
    version: 1,
    custom_shapes: customShapes.map(({ id, name, createdAt, clipboard }) => ({ id, name, createdAt, clipboard })),
  }, "cosmowar-custom-shapes.json");
  setActionState(`Exported ${customShapes.length} custom shape${customShapes.length === 1 ? "" : "s"}`, "success", true);
}

function getUniqueCustomShapeName(name) {
  const existing = new Set(customShapes.map((shape) => shape.name.toLocaleLowerCase()));
  if (!existing.has(name.toLocaleLowerCase())) return name;
  let suffix = 2;
  while (existing.has(`${name} (${suffix})`.toLocaleLowerCase())) suffix += 1;
  return `${name} (${suffix})`;
}

function appendImportedCustomShapes(data) {
  if (!data || typeof data !== "object") throw new Error("Custom shapes file must contain a JSON object.");
  if (data.type && data.type !== CUSTOM_SHAPES_FILE_TYPE) throw new Error("This JSON file is not a Cosmowar custom-shapes export.");
  const values = Array.isArray(data) ? data : data.custom_shapes;
  if (!Array.isArray(values)) throw new Error("The file must contain a custom_shapes array.");
  const normalizedValues = values.map((value, index) => normalizeCustomShape(value, index));
  const signatures = new Set(customShapes.map((shape) => shape.signature));
  let added = 0;
  let duplicates = 0;
  normalizedValues.forEach((shape) => {
    if (signatures.has(shape.signature)) {
      duplicates += 1;
      return;
    }
    signatures.add(shape.signature);
    shape.id = createUid("custom_shape");
    shape.name = getUniqueCustomShapeName(shape.name);
    customShapes.push(shape);
    added += 1;
  });
  if (added) persistCustomShapes();
  renderCustomShapes();
  return { added, duplicates };
}

function importCustomShapes(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = appendImportedCustomShapes(JSON.parse(String(reader.result)));
      setActionState(`Imported ${result.added} custom shape${result.added === 1 ? "" : "s"}; skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}`, result.added ? "success" : "idle", true);
    } catch (error) {
      alert(`Custom shape import failed: ${error.message}`);
      setActionState("Custom shape import failed", "error", true);
    } finally {
      el.customShapesFileInput.value = "";
    }
  };
  reader.onerror = () => {
    alert("Custom shape import failed: could not read file.");
    el.customShapesFileInput.value = "";
  };
  reader.readAsText(file);
}

function startPasteDraft() {
  if (!editorClipboard) {
    setActionState("Clipboard is empty", "warn", true);
    return;
  }
  interaction.pasteDraft = {
    clipboard: cloneState(editorClipboard),
    center: { ...interaction.mouseWorld },
    angle: 0,
  };
  updatePasteDraft(interaction.mouseWorld);
  requestRender();
}

function updatePasteDraft(world) {
  if (!interaction.pasteDraft) return;
  interaction.pasteDraft.center = getGridSnappedPoint(world);
  interaction.pasteDraft.invalid = !validatePasteDraft(interaction.pasteDraft).valid;
}

function getPasteDraftEntities(draft) {
  const rotateItem = (item) => {
    const rotated = rotateVector(item.dx, item.dy, draft.angle || 0);
    return {
      ...item,
      x: roundTo(draft.center.x + rotated.x, 3),
      y: roundTo(draft.center.y + rotated.y, 3),
    };
  };
  const list = (key) => Array.isArray(draft.clipboard?.[key]) ? draft.clipboard[key] : [];
  return {
    towers: list("towers").map(rotateItem),
    spawns: list("spawns").map(rotateItem),
    bombs: list("bombs").map(rotateItem),
    structures: list("structures").map(rotateItem),
    boundaries: list("boundaries").map(rotateItem),
    holes: list("holes").map((hole) => ({ points: (hole.points || []).map(rotateItem) })),
    walls: list("walls").map((wall) => ({ ...wall })),
  };
}

function validatePasteDraft(draft) {
  const entities = getPasteDraftEntities(draft);
  const towerByOriginalId = new Map(entities.towers.map((tower) => [tower.id, tower]));
  if (entities.boundaries.length > 0 && entities.boundaries.length < 3) {
    return { valid: false, reason: "A custom shape boundary needs at least 3 vertices." };
  }
  const candidateBoundary = entities.boundaries.length ? entities.boundaries : state.map_boundaries;
  const candidateHoles = [
    ...state.map_holes,
    ...entities.holes.map((hole, index) => ({
      uid: `paste_hole_${index}`,
      points: hole.points.map((point, pointIndex) => ({ uid: `paste_hole_${index}_${pointIndex}`, x: point.x, y: point.y })),
    })),
  ];
  const placementState = { ...state, map_boundaries: candidateBoundary, map_holes: candidateHoles };
  const firstPastedHoleIndex = state.map_holes.length;
  const holeIssue = HOLE_GEOMETRY.validateMapHoles(placementState)
    .find((issue) => issue.holeIndexes.some((index) => index >= firstPastedHoleIndex));
  if (holeIssue) return { valid: false, reason: holeIssue.message };

  for (const spawn of entities.spawns) {
    if (!isPlacementInsideBoundary("spawn", spawn.x, spawn.y, spawn, placementState)) return { valid: false, reason: "Spawn would be outside map boundary." };
    if (state.spawn_points.some((existing) => existing.team_id === spawn.team_id)) return { valid: false, reason: "Pasted spawn would duplicate an existing team spawn." };
  }
  for (const bomb of entities.bombs) {
    if (!isPlacementInsideBoundary("bomb", bomb.x, bomb.y, bomb, placementState)) return { valid: false, reason: "Bomb site would be outside map boundary." };
  }
  for (const structure of entities.structures) {
    if (!isPlacementInsideBoundary("structure", structure.x, structure.y, structure, placementState)) return { valid: false, reason: "Structure would be outside map boundary." };
  }
  for (const tower of entities.towers) {
    if (!isPlacementInsideBoundary("tower", tower.x, tower.y, tower, placementState)) return { valid: false, reason: "Tower would be outside map boundary." };
    if (hasTowerOverlapAt(tower.x, tower.y)) return { valid: false, reason: "Tower would overlap an existing tower." };
    if (entities.towers.some((other) => other.id !== tower.id && distance(tower.x, tower.y, other.x, other.y) < GAME.TOWER_DIAMETER - 0.001)) {
      return { valid: false, reason: "Copied towers would overlap each other." };
    }
    if (isTowerPositionOnWall(tower.x, tower.y)) return { valid: false, reason: "Tower would overlap an existing wall." };
  }

  for (const wall of entities.walls) {
    const a = towerByOriginalId.get(wall.t1);
    const b = towerByOriginalId.get(wall.t2);
    if (!a || !b) return { valid: false, reason: "Copied wall is missing a copied tower." };
    if (a.team_id !== b.team_id || wall.team_id !== a.team_id) return { valid: false, reason: "Copied wall team does not match towers." };
    if (findWallOverlapForSegment({ x: a.x, y: a.y }, { x: b.x, y: b.y }, null, null)) return { valid: false, reason: "Copied wall would overlap an existing wall." };
    if (state.towers.some((tower) => pointToSegmentDistance(tower, a, b) <= (GAME.TOWER_DIAMETER / 2) - 0.001)) {
      return { valid: false, reason: "Copied wall would overlap an existing tower." };
    }
    if (entities.towers.some((tower) => tower.id !== wall.t1 && tower.id !== wall.t2 && pointToSegmentDistance(tower, a, b) <= (GAME.TOWER_DIAMETER / 2) - 0.001)) {
      return { valid: false, reason: "Copied wall would overlap a copied tower." };
    }
  }

  for (let i = 0; i < entities.walls.length; i += 1) {
    const wa = entities.walls[i];
    const a1 = towerByOriginalId.get(wa.t1);
    const a2 = towerByOriginalId.get(wa.t2);
    if (!a1 || !a2) continue;
    for (let j = i + 1; j < entities.walls.length; j += 1) {
      const wb = entities.walls[j];
      const b1 = towerByOriginalId.get(wb.t1);
      const b2 = towerByOriginalId.get(wb.t2);
      if (!b1 || !b2) continue;
      if (wallsConflict(a1, a2, wa.t1, wa.t2, b1, b2, wb.t1, wb.t2)) return { valid: false, reason: "Copied walls would overlap." };
    }
  }

  return { valid: true, reason: "" };
}

function commitPasteDraft() {
  const draft = interaction.pasteDraft;
  if (!draft) return;
  const validation = validatePasteDraft(draft);
  if (!validation.valid) {
    interaction.pasteDraft.invalid = true;
    setActionState(validation.reason, "warn", true);
    requestRender();
    return;
  }

  const entities = getPasteDraftEntities(draft);
  withAction("PASTE_GROUP", () => {
    const towerIdMap = new Map();
    const pastedKeys = [];

    if (entities.boundaries.length) {
      state.map_boundaries = entities.boundaries.map((boundary) => {
        const pasted = { uid: createUid("boundary"), x: boundary.x, y: boundary.y };
        pastedKeys.push(makeKey("boundary", pasted.uid));
        return pasted;
      });
    }

    entities.holes.forEach((hole) => {
      const pasted = {
        uid: createUid("hole"),
        points: hole.points.map((point) => ({ uid: createUid("hole_vertex"), x: point.x, y: point.y })),
      };
      state.map_holes.push(pasted);
      pastedKeys.push(makeKey("hole", pasted.uid));
    });

    entities.towers.forEach((tower) => {
      const pasted = {
        uid: createUid("tower"),
        id: nextTowerId(),
        team_id: tower.team_id,
        x: tower.x,
        y: tower.y,
        health: clamp(1, Math.round(tower.health), GAME.TOWER_MAX_HEALTH),
        is_invincible: Boolean(tower.is_invincible),
      };
      towerIdMap.set(tower.id, pasted.id);
      state.towers.push(pasted);
      pastedKeys.push(makeKey("tower", pasted.uid));
    });

    entities.spawns.forEach((spawn) => {
      const pasted = { uid: createUid("spawn"), team_id: spawn.team_id, x: spawn.x, y: spawn.y };
      state.spawn_points.push(pasted);
      pastedKeys.push(makeKey("spawn", pasted.uid));
    });

    entities.bombs.forEach((bomb) => {
      const pasted = { uid: createUid("bomb"), site_letter: String(bomb.site_letter || nextBombSiteLetter()).toUpperCase(), x: bomb.x, y: bomb.y };
      state.bomb_sites.push(pasted);
      pastedKeys.push(makeKey("bomb", pasted.uid));
    });

    entities.structures.forEach((structure) => {
      const pasted = {
        uid: createUid("structure"),
        id: nextStructureId(),
        x: structure.x,
        y: structure.y,
        size: structure.size,
        label: structure.label,
        color: structure.color,
        team_id: structure.team_id,
      };
      state.structures.push(pasted);
      pastedKeys.push(makeKey("structure", pasted.uid));
    });

    entities.walls.forEach((wall) => {
      const t1 = towerIdMap.get(wall.t1);
      const t2 = towerIdMap.get(wall.t2);
      if (!t1 || !t2) return;
      const pasted = { uid: createUid("wall"), id: nextWallLocalId(), t1, t2, team_id: wall.team_id };
      state.walls.push(pasted);
      pastedKeys.push(makeKey("wall", pasted.uid));
    });

    selection.clear();
    pastedKeys.forEach((key) => selection.add(key));
    return pastedKeys.length > 0;
  });

  interaction.pasteDraft = null;
  renderSelectionPanel();
  setActionState("Pasted selection", "success", true);
}

function getSnapResult(targetX, targetY, excludeKeys = new Set(), options = {}) {
  const allowObject = options.object !== false && interaction.snapEnabled && editorSettings.objectSnapEnabled;
  const allowGrid = options.grid !== false && editorSettings.gridSnapEnabled;
  const candidates = allowObject ? getGuideCandidates(excludeKeys) : [];
  const threshold = editorSettings.snapStrength / Math.max(view.scale, 0.0001);
  let bestX = null;
  let bestY = null;
  candidates.forEach((c) => {
    const dx = Math.abs(c.x - targetX);
    const dy = Math.abs(c.y - targetY);
    if (dx <= threshold && (!bestX || dx < bestX.delta)) bestX = { value: c.x, delta: dx };
    if (dy <= threshold && (!bestY || dy < bestY.delta)) bestY = { value: c.y, delta: dy };
  });
  const gridSize = Math.max(4, Number(editorSettings.gridSize) || 48);
  const gridX = Math.round(targetX / gridSize) * gridSize;
  const gridY = Math.round(targetY / gridSize) * gridSize;
  const useObjectX = bestX && (!allowGrid || bestX.delta <= Math.abs(gridX - targetX));
  const useObjectY = bestY && (!allowGrid || bestY.delta <= Math.abs(gridY - targetY));
  const x = useObjectX ? bestX.value : (allowGrid ? gridX : targetX);
  const y = useObjectY ? bestY.value : (allowGrid ? gridY : targetY);
  return {
    x,
    y,
    guideX: useObjectX || allowGrid ? x : null,
    guideY: useObjectY || allowGrid ? y : null,
    xPoints: useObjectX ? candidates.filter((c) => Math.abs(c.x - x) <= 0.001).slice(0, 30) : [],
    yPoints: useObjectY ? candidates.filter((c) => Math.abs(c.y - y) <= 0.001).slice(0, 30) : [],
  };
}

function isAnySnappingEnabled() {
  return editorSettings.gridSnapEnabled || (interaction.snapEnabled && editorSettings.objectSnapEnabled);
}

function getPlacementSnapPreview(world) {
  if (interaction.snapTemporarilyDisabled || !isAnySnappingEnabled()) {
    return { x: world.x, y: world.y, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  }
  return getSnapResult(world.x, world.y, new Set());
}

function getGridSnappedPoint(world) {
  if (!editorSettings.gridSnapEnabled || interaction.snapTemporarilyDisabled) return { x: world.x, y: world.y };
  const snapped = getSnapResult(world.x, world.y, new Set(), { object: false, grid: true });
  return { x: snapped.x, y: snapped.y };
}

function getGuideCandidates(excludeKeys = new Set()) {
  const list = [];
  state.map_boundaries.forEach((p) => { if (!excludeKeys.has(makeKey("boundary", p.uid))) list.push({ x: p.x, y: p.y }); });
  state.map_holes.forEach((hole) => {
    if (excludeKeys.has(makeKey("hole", hole.uid))) return;
    hole.points.forEach((point) => {
      if (!excludeKeys.has(makeKey("holeVertex", point.uid))) list.push({ x: point.x, y: point.y });
    });
  });
  state.walls.forEach((w) => {
    if (excludeKeys.has(makeKey("wall", w.uid))) return;
    const a = getTowerById(w.t1);
    const b = getTowerById(w.t2);
    if (!a || !b) return;
    if (excludeKeys.has(makeKey("tower", a.uid)) || excludeKeys.has(makeKey("tower", b.uid))) return;
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
      <input id="selSnapEnabled" type="checkbox" ${editorSettings.objectSnapEnabled ? "checked" : ""}>
      <span>Enable object snapping</span>
    </label>
  `;
}

function bindSnapToggle() {
  const toggle = document.getElementById("selSnapEnabled");
  if (!toggle) return;
  toggle.addEventListener("change", () => {
    interaction.snapEnabled = toggle.checked;
    editorSettings.objectSnapEnabled = toggle.checked;
    el.objectSnapEnabledInput.checked = toggle.checked;
    saveSession();
    setActionState(`Object snapping ${interaction.snapEnabled ? "enabled" : "disabled"}`, "success", true);
  });
}

function updateLiveSelectionCoordinates() {
  const entries = getSelectionEntries();
  if (entries.length !== 1) return;
  const entry = entries[0];
  if (!["tower", "spawn", "bomb", "boundary", "structure", "hole", "holeVertex"].includes(entry.type)) return;
  const position = entry.type === "hole" ? getHoleCenter(entry.item) : entry.item;
  const xInput = document.getElementById("selLiveX") || document.getElementById("selTowerX") || document.getElementById("selSpawnX") || document.getElementById("selBombX") || document.getElementById("selBoundaryX") || document.getElementById("selStructureX") || document.getElementById("selHoleX") || document.getElementById("selHoleVertexX");
  const yInput = document.getElementById("selLiveY") || document.getElementById("selTowerY") || document.getElementById("selSpawnY") || document.getElementById("selBombY") || document.getElementById("selBoundaryY") || document.getElementById("selStructureY") || document.getElementById("selHoleY") || document.getElementById("selHoleVertexY");
  if (xInput) xInput.value = String(roundTo(position.x, 3));
  if (yInput) yInput.value = String(roundTo(position.y, 3));
}

function renderSelectionPanel() {
  const entries = getSelectionEntries();
  if (el.saveCustomShapeBtn) el.saveCustomShapeBtn.disabled = entries.length === 0;
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
  else if (entry.type === "hole") renderHoleSelection(entry);
  else if (entry.type === "holeVertex") renderHoleVertexSelection(entry);
  else if (entry.type === "structure") renderStructureSelection(entry);
}

function renderMultiSelection(entries) {
  const towerEntries = entries.filter((entry) => entry.type === "tower");
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
    ${towerEntries.length ? `
      <label class="field">
        <span>Set health for ${towerEntries.length} selected tower${towerEntries.length === 1 ? "" : "s"}</span>
        <input id="multiTowerHealth" type="number" step="1" min="1" max="${GAME.TOWER_MAX_HEALTH}" value="${GAME.TOWER_MAX_HEALTH}">
      </label>
      <label class="checkbox-field">
        <input id="multiTowerInvincible" type="checkbox">
        <span>Set selected towers invincible</span>
      </label>
      ${towerEntries.length !== entries.length ? `<p class="muted" style="margin-bottom:8px;">Non-tower objects in this selection are left unchanged.</p>` : ""}
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
        const visitedTowerIds = new Set();
        entries.forEach((entry) => {
          changed = applyTeamToEntry(entry, selectedTeam, visitedTowerIds) || changed;
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
      const health = clamp(1, Math.round(Number(document.getElementById("multiTowerHealth").value)), GAME.TOWER_MAX_HEALTH);
      const inv = document.getElementById("multiTowerInvincible").checked;
      withAction("MASS_TOWER_EDIT", () => {
        let changed = false;
        towerEntries.forEach((entry) => {
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
    <label class="field"><span>health</span><input id="selTowerHealth" type="number" step="1" max="${GAME.TOWER_MAX_HEALTH}" min="1" value="${tower.health}"></label>
    <label class="checkbox-field"><input id="selTowerInv" type="checkbox" ${tower.is_invincible ? "checked" : ""}><span>is_invincible</span></label>
    ${snapToggleMarkup()}
    <button id="deleteTowerBtn" class="danger-button">Delete Tower</button>
  `;
  bindTeamSwatchGroup(el.selectionPanel, tower.team_id, (nextTeam) => withAction("EDIT_TOWER", () => setConnectedComponentTeam(tower.id, nextTeam)));
  bindNumericChange("selTowerX", (v) => withAction("MOVE_TOWER", () => { tower.x = roundTo(v, 3); return true; }));
  bindNumericChange("selTowerY", (v) => withAction("MOVE_TOWER", () => { tower.y = roundTo(v, 3); return true; }));
  bindNumericChange("selTowerHealth", (v) => withAction("EDIT_TOWER", () => { tower.health = clamp(1, Math.round(v), GAME.TOWER_MAX_HEALTH); return true; }));
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
  bindTeamSwatchGroup(el.selectionPanel, wall.team_id, (nextTeam) => withAction("EDIT_WALL", () => setConnectedComponentTeam(wall.t1, nextTeam)));
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

function renderHoleSelection(entry) {
  const hole = entry.item;
  const index = state.map_holes.indexOf(hole);
  const center = getHoleCenter(hole);
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow(`Map Hole ${index}`)}
    <label class="field"><span>Vertices</span><span class="readonly-tag">${hole.points.length}</span></label>
    <label class="field"><span>centre x</span><input id="selHoleX" type="number" step="0.1" value="${roundTo(center.x, 3)}"></label>
    <label class="field"><span>centre y</span><input id="selHoleY" type="number" step="0.1" value="${roundTo(center.y, 3)}"></label>
    ${snapToggleMarkup()}
    <button id="deleteHoleBtn" class="danger-button">Delete Hole</button>
  `;
  bindNumericChange("selHoleX", (value) => withAction("MOVE_HOLE", () => { moveHoleTo(hole, value, getHoleCenter(hole).y); return true; }));
  bindNumericChange("selHoleY", (value) => withAction("MOVE_HOLE", () => { moveHoleTo(hole, getHoleCenter(hole).x, value); return true; }));
  bindSnapToggle();
  document.getElementById("deleteHoleBtn").addEventListener("click", deleteSelected);
}

function renderHoleVertexSelection(entry) {
  const point = entry.item;
  const hole = entry.hole;
  const holeIndex = state.map_holes.indexOf(hole);
  const pointIndex = hole.points.indexOf(point);
  el.selectionPanel.innerHTML = `
    ${selectionTypeRow("Hole Vertex")}
    <label class="field"><span>Location</span><span class="readonly-tag">Hole ${holeIndex}, vertex ${pointIndex}</span></label>
    <label class="field"><span>x</span><input id="selHoleVertexX" type="number" step="0.1" value="${point.x}"></label>
    <label class="field"><span>y</span><input id="selHoleVertexY" type="number" step="0.1" value="${point.y}"></label>
    ${snapToggleMarkup()}
    <button id="deleteHoleVertexBtn" class="danger-button">Delete Vertex</button>
    <button id="deleteParentHoleBtn" class="danger-button">Delete Entire Hole</button>
  `;
  bindNumericChange("selHoleVertexX", (value) => withAction("EDIT_HOLE_VERTEX", () => { point.x = roundTo(value, 3); return true; }));
  bindNumericChange("selHoleVertexY", (value) => withAction("EDIT_HOLE_VERTEX", () => { point.y = roundTo(value, 3); return true; }));
  bindSnapToggle();
  document.getElementById("deleteHoleVertexBtn").addEventListener("click", deleteSelected);
  document.getElementById("deleteParentHoleBtn").addEventListener("click", () => {
    selection.clear();
    selection.add(makeKey("hole", hole.uid));
    deleteSelected();
  });
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

function applyTeamToEntry(entry, teamId, visitedTowerIds = new Set()) {
  if (entry.type === "tower") return setConnectedComponentTeam(entry.item.id, teamId, visitedTowerIds);
  if (entry.type === "wall") return setConnectedComponentTeam(entry.item.t1, teamId, visitedTowerIds);
  if (entry.type === "spawn" || entry.type === "structure") {
    if (entry.item.team_id === teamId) return false;
    entry.item.team_id = teamId;
    return true;
  }
  return false;
}

function setConnectedComponentTeam(startTowerId, teamId, visitedTowerIds = new Set()) {
  if (!Number.isInteger(startTowerId)) return false;
  const startTower = getTowerById(startTowerId);
  if (!startTower) return false;
  let changed = false;
  const queue = [startTowerId];
  while (queue.length) {
    const towerId = queue.shift();
    if (visitedTowerIds.has(towerId)) continue;
    visitedTowerIds.add(towerId);
    const tower = getTowerById(towerId);
    if (!tower) continue;
    if (tower.team_id !== teamId) {
      tower.team_id = teamId;
      changed = true;
    }
    state.walls.forEach((wall) => {
      if (wall.t1 !== towerId && wall.t2 !== towerId) return;
      if (wall.team_id !== teamId) {
        wall.team_id = teamId;
        changed = true;
      }
      const other = wall.t1 === towerId ? wall.t2 : wall.t1;
      if (!visitedTowerIds.has(other)) queue.push(other);
    });
  }
  return changed;
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
    const holesToDelete = new Set(entries.filter((entry) => entry.type === "hole").map((entry) => entry.item.uid));
    const verticesToDelete = new Set(entries.filter((entry) => entry.type === "holeVertex").map((entry) => entry.item.uid));
    state.towers = state.towers.filter((t) => !keys.has(makeKey("tower", t.uid)));
    const deletedTowerIds = new Set([...towersToDelete]);
    state.spawn_points = state.spawn_points.filter((s) => !keys.has(makeKey("spawn", s.uid)));
    state.bomb_sites = state.bomb_sites.filter((b) => !keys.has(makeKey("bomb", b.uid)));
    state.map_boundaries = state.map_boundaries.filter((p) => !keys.has(makeKey("boundary", p.uid)));
    state.map_holes = state.map_holes
      .filter((hole) => !holesToDelete.has(hole.uid))
      .map((hole) => ({ ...hole, points: hole.points.filter((point) => !verticesToDelete.has(point.uid)) }));
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
  if (type !== "MIRROR_SELECTION" && type !== "APPLY_MAP_PRESET" && type !== "CENTER_MAP_ON_ORIGIN") applyLiveMirroring(before);
  pushHistory(type, before, cloneState(state));
  onStateChanged();
  return true;
}

function pushHistory(type, before, after, metadata = {}) {
  const entry = { type, before, after, ...metadata };
  history.undo.push(entry);
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo = [];
  if (!entry.localOnly) multiplayerManager?.handleLocalAction(type, before, after, entry);
}

function pushMirrorAxesHistory(type, beforeAxes, afterAxes) {
  const snapshot = cloneState(state);
  pushHistory(type, snapshot, snapshot, {
    beforeMirrorAxes: cloneState(beforeAxes),
    afterMirrorAxes: cloneState(afterAxes),
    localOnly: true,
  });
}

function commitMirrorAxesChange(type, mutator, message) {
  const beforeAxes = cloneState(mirrorState.axes);
  mutator();
  if (!Number.isInteger(interaction.selectedMirrorAxisIndex)
    || !mirrorState.axes[interaction.selectedMirrorAxisIndex]) {
    interaction.selectedMirrorAxisIndex = null;
  }
  const afterAxes = cloneState(mirrorState.axes);
  if (JSON.stringify(beforeAxes) === JSON.stringify(afterAxes)) return false;
  pushMirrorAxesHistory(type, beforeAxes, afterAxes);
  saveSession();
  updateMirrorStatus();
  setActionState(message, "success", true);
  requestRender();
  return true;
}

function isLocalHistoryEntry(action) {
  return action && !String(action.type || "").startsWith("REMOTE_");
}

function undoAction() {
  if (!history.undo.length) {
    setActionState("Nothing to undo", "idle", true);
    return;
  }
  const before = cloneState(state);
  const action = history.undo.pop();
  history.redo.push(action);
  state = applyStateDelta(state, action.after, action.before);
  if (Array.isArray(action.beforeMirrorAxes)) mirrorState.axes = cloneState(action.beforeMirrorAxes);
  onStateReplaced();
  updateMirrorStatus();
  if (!action.localOnly) multiplayerManager?.handleLocalAction("UNDO", before, cloneState(state));
  setActionState(`Undo: ${action.type}`, "success", true);
}

function redoAction() {
  if (!history.redo.length) {
    setActionState("Nothing to redo", "idle", true);
    return;
  }
  const before = cloneState(state);
  const action = history.redo.pop();
  history.undo.push(action);
  state = applyStateDelta(state, action.before, action.after);
  if (Array.isArray(action.afterMirrorAxes)) mirrorState.axes = cloneState(action.afterMirrorAxes);
  onStateReplaced();
  updateMirrorStatus();
  if (!action.localOnly) multiplayerManager?.handleLocalAction("REDO", before, cloneState(state));
  setActionState(`Redo: ${action.type}`, "success", true);
}

function onStateChanged() {
  hydrateCountersFromState();
  sanitizeSelection();
  renderSelectionPanel();
  el.spawnProtectionInput.value = String(state.spawn_protection_size);
  updateInvalidObjectWarning();
  saveSession();
  requestRender();
}

function onStateReplaced() {
  normalizeMapHolesInState();
  normalizeTowerHealthInState();
  interaction.wallDraft = null;
  interaction.hoverTowerId = null;
  interaction.buildGhost = null;
  interaction.placementGhost = null;
  interaction.pasteDraft = null;
  interaction.towerDraftWarnActive = false;
  interaction.wallDraftWarnActive = false;
  interaction.drag = null;
  interaction.rotate = null;
  interaction.resize = null;
  interaction.boxSelect = null;
  interaction.mirrorDraft = null;
  interaction.mirrorAxisDrag = null;
  interaction.selectedMirrorAxisIndex = null;
  interaction.holeDraft = null;
  interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  hydrateCountersFromState();
  sanitizeSelection();
  renderSelectionPanel();
  el.spawnProtectionInput.value = String(state.spawn_protection_size);
  updateInvalidObjectWarning();
  saveSession();
  requestRender();
}

function restoreSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!isSessionStateShape(saved?.state)) return;
    state = saved.state;
    normalizeMapHolesInState();
    normalizeTowerHealthInState();
    if (Array.isArray(saved?.history?.undo)) history.undo = saved.history.undo.filter(isLocalHistoryEntry).slice(-history.limit);
    if (Array.isArray(saved?.history?.redo)) history.redo = saved.history.redo.filter(isLocalHistoryEntry).slice(-history.limit);
    if (Number.isFinite(saved?.editorSettings?.snapStrength)) {
      editorSettings.snapStrength = clamp(1, Math.round(saved.editorSettings.snapStrength), 500);
    }
    if (typeof saved?.editorSettings?.buildModeSnapEnabled === "boolean") {
      editorSettings.buildModeSnapEnabled = saved.editorSettings.buildModeSnapEnabled;
    }
    if (typeof saved?.editorSettings?.objectSnapEnabled === "boolean") {
      editorSettings.objectSnapEnabled = saved.editorSettings.objectSnapEnabled;
    }
    if (typeof saved?.editorSettings?.gridSnapEnabled === "boolean") {
      editorSettings.gridSnapEnabled = saved.editorSettings.gridSnapEnabled;
    }
    if (Number.isFinite(saved?.editorSettings?.gridSize)) {
      editorSettings.gridSize = clamp(4, Number(saved.editorSettings.gridSize), 1000);
    }
    if (Number.isFinite(saved?.editorSettings?.gridLineWidth)) {
      editorSettings.gridLineWidth = clamp(0.25, Number(saved.editorSettings.gridLineWidth), 8);
    }
    if (typeof saved?.editorSettings?.gridMajorVisible === "boolean") {
      editorSettings.gridMajorVisible = saved.editorSettings.gridMajorVisible;
    }
    if (typeof saved?.editorSettings?.originAxesVisible === "boolean") {
      editorSettings.originAxesVisible = saved.editorSettings.originAxesVisible;
    }
    if (Number.isFinite(saved?.view?.scale) && Number.isFinite(saved?.view?.offsetX) && Number.isFinite(saved?.view?.offsetY)) {
      view.scale = clamp(GAME.MIN_ZOOM, Number(saved.view.scale), GAME.MAX_ZOOM);
      view.offsetX = Number(saved.view.offsetX);
      view.offsetY = Number(saved.view.offsetY);
      restoredViewFromSession = true;
    }
    if (Array.isArray(saved?.mirrorState?.axes)) {
      mirrorState.axes = saved.mirrorState.axes.filter(isUsableMirrorAxis).slice(-8);
    }
    if (typeof saved?.mirrorState?.liveEnabled === "boolean") {
      mirrorState.liveEnabled = saved.mirrorState.liveEnabled;
    }
    if ([-1, 0, 1].includes(saved?.defaults?.defaultTeam)) {
      defaults.defaultTeam = saved.defaults.defaultTeam;
    }
    if (Number.isFinite(saved?.defaults?.towerHealth)) {
      defaults.towerHealth = clamp(1, Math.round(saved.defaults.towerHealth), GAME.TOWER_MAX_HEALTH);
    }
    if (typeof saved?.defaults?.towerInvincible === "boolean") {
      defaults.towerInvincible = saved.defaults.towerInvincible;
    }
  } catch (error) {
    console.warn("Could not restore saved map editor session.", error);
  }
}

function normalizeTowerHealthInState() {
  state.towers.forEach((tower) => {
    tower.health = clamp(1, Math.round(Number(tower.health) || GAME.TOWER_MAX_HEALTH), GAME.TOWER_MAX_HEALTH);
  });
}

function normalizeMapHolesInState() {
  if (!Array.isArray(state.map_holes)) state.map_holes = [];
  state.map_holes.forEach((hole) => {
    if (!hole.uid) hole.uid = createUid("hole");
    if (!Array.isArray(hole.points)) hole.points = [];
    hole.points.forEach((point) => {
      if (!point.uid) point.uid = createUid("hole_vertex");
    });
  });
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: conversionSession ? conversionSession.beforeState : state,
      history: {
        undo: history.undo.slice(-history.limit),
        redo: history.redo.slice(-history.limit),
      },
      editorSettings,
      mirrorState: { axes: mirrorState.axes, liveEnabled: mirrorState.liveEnabled },
      defaults,
      view: conversionSession ? conversionSession.beforeView : view,
    }));
  } catch (error) {
    console.warn("Could not save map editor session.", error);
  }
}

function isSessionStateShape(value) {
  return Boolean(value)
    && typeof value === "object"
    && Array.isArray(value.map_boundaries)
    && (value.map_holes === undefined || Array.isArray(value.map_holes))
    && Array.isArray(value.spawn_points)
    && Array.isArray(value.bomb_sites)
    && Array.isArray(value.towers)
    && Array.isArray(value.walls)
    && Array.isArray(value.structures)
    && Number.isFinite(Number(value.spawn_protection_size));
}

function sanitizeSelection() {
  Array.from(selection).forEach((key) => { if (!resolveKey(key)) selection.delete(key); });
}

function getInvalidObjects(mapState = state) {
  const report = getMapValidationReport(mapState);
  const invalid = [];
  const addInvalid = (type, items) => {
    items.forEach((item) => {
      const key = makeKey(type, item.uid);
      if (report.invalidKeys.has(key)) invalid.push({ type, item, key });
    });
  };
  addInvalid("boundary", mapState.map_boundaries);
  addInvalid("hole", mapState.map_holes);
  addInvalid("spawn", mapState.spawn_points);
  addInvalid("bomb", mapState.bomb_sites);
  addInvalid("tower", mapState.towers);
  addInvalid("wall", mapState.walls);
  addInvalid("structure", mapState.structures);
  return invalid;
}

function isObjectInvalid(type, item, mapState = state) {
  const report = mapState === state && activeValidationReport
    ? activeValidationReport
    : getMapValidationReport(mapState);
  return report.invalidKeys.has(makeKey(type, item.uid));
}

function isObjectOutsideBoundary(type, item, mapState = state) {
  return !isPlacementInsideOuterBoundary(type, item.x, item.y, item, mapState);
}

function getMapValidationReport(mapState = state) {
  const issues = [];
  const invalidKeys = new Set();
  const addIssue = (message, keys = []) => {
    keys.filter(Boolean).forEach((key) => invalidKeys.add(key));
    issues.push({ message, keys: keys.filter(Boolean) });
  };
  const keyFor = (type, item) => item?.uid ? makeKey(type, item.uid) : null;

  if (mapState.map_boundaries.length < 3) {
    addIssue(
      "Map boundary must contain at least 3 points.",
      mapState.map_boundaries.map((item) => keyFor("boundary", item)),
    );
  }

  const placementCollections = [
    ["tower", "Tower", mapState.towers],
    ["spawn", "Spawn", mapState.spawn_points],
    ["bomb", "Bomb site", mapState.bomb_sites],
    ["structure", "Structure", mapState.structures],
  ];
  placementCollections.forEach(([type, label, items]) => {
    items.forEach((item) => {
      if (!isObjectOutsideBoundary(type, item, mapState)) return;
      const identity = type === "tower" ? ` ${item.id}` : "";
      addIssue(`${label}${identity} is outside the map boundary.`, [keyFor(type, item)]);
    });
  });

  const team0Spawns = mapState.spawn_points.filter((item) => item.team_id === 0);
  const team1Spawns = mapState.spawn_points.filter((item) => item.team_id === 1);
  if (mapState.spawn_points.length !== 2 || team0Spawns.length !== 1 || team1Spawns.length !== 1) {
    addIssue(
      "Spawn points must include exactly one Team 0 spawn and one Team 1 spawn.",
      mapState.spawn_points.map((item) => keyFor("spawn", item)),
    );
  }

  const towersById = new Map();
  mapState.towers.forEach((tower) => {
    const matches = towersById.get(tower.id) || [];
    matches.push(tower);
    towersById.set(tower.id, matches);
  });
  towersById.forEach((matches, id) => {
    if (matches.length < 2) return;
    addIssue(`Tower id ${id} is duplicated.`, matches.map((item) => keyFor("tower", item)));
  });

  for (let i = 0; i < mapState.towers.length; i += 1) {
    const towerA = mapState.towers[i];
    for (let j = i + 1; j < mapState.towers.length; j += 1) {
      const towerB = mapState.towers[j];
      if (distance(towerA.x, towerA.y, towerB.x, towerB.y) >= GAME.TOWER_DIAMETER - 0.001) continue;
      addIssue(`Towers ${towerA.id} and ${towerB.id} overlap.`, [keyFor("tower", towerA), keyFor("tower", towerB)]);
    }
  }

  const wallPairs = new Map();
  mapState.walls.forEach((wall) => {
    const wallKey = keyFor("wall", wall);
    const towerA = getTowerByIdFrom(mapState, wall.t1);
    const towerB = getTowerByIdFrom(mapState, wall.t2);
    const connectedKeys = [wallKey, keyFor("tower", towerA), keyFor("tower", towerB)];
    if (wall.t1 === wall.t2) addIssue(`A wall connects tower ${wall.t1} to itself.`, connectedKeys);
    if (!towerA || !towerB) {
      addIssue(`A wall references missing tower ${!towerA ? wall.t1 : wall.t2}.`, connectedKeys);
      return;
    }
    if (towerA.team_id !== towerB.team_id || wall.team_id !== towerA.team_id) {
      addIssue(`Wall ${wall.t1}-${wall.t2} and its towers do not share the same team.`, connectedKeys);
    }
    const pairKey = `${Math.min(wall.t1, wall.t2)}:${Math.max(wall.t1, wall.t2)}`;
    const matchingWalls = wallPairs.get(pairKey) || [];
    matchingWalls.push(wall);
    wallPairs.set(pairKey, matchingWalls);
  });
  wallPairs.forEach((matches, pairKey) => {
    if (matches.length < 2) return;
    addIssue(`Duplicate walls connect towers ${pairKey.replace(":", " and ")}.`, matches.map((item) => keyFor("wall", item)));
  });

  for (let i = 0; i < mapState.walls.length; i += 1) {
    const wallA = mapState.walls[i];
    const a1 = getTowerByIdFrom(mapState, wallA.t1);
    const a2 = getTowerByIdFrom(mapState, wallA.t2);
    if (!a1 || !a2) continue;
    for (let j = i + 1; j < mapState.walls.length; j += 1) {
      const wallB = mapState.walls[j];
      const b1 = getTowerByIdFrom(mapState, wallB.t1);
      const b2 = getTowerByIdFrom(mapState, wallB.t2);
      if (!b1 || !b2 || !wallsConflict(a1, a2, wallA.t1, wallA.t2, b1, b2, wallB.t1, wallB.t2)) continue;
      addIssue(`Walls ${wallA.t1}-${wallA.t2} and ${wallB.t1}-${wallB.t2} overlap or intersect.`, [keyFor("wall", wallA), keyFor("wall", wallB)]);
    }
  }

  mapState.towers.forEach((tower) => {
    mapState.walls.forEach((wall) => {
      if (wall.t1 === tower.id || wall.t2 === tower.id) return;
      const towerA = getTowerByIdFrom(mapState, wall.t1);
      const towerB = getTowerByIdFrom(mapState, wall.t2);
      if (!towerA || !towerB) return;
      if (pointToSegmentDistance(tower, towerA, towerB) > (GAME.TOWER_DIAMETER / 2) - 0.001) return;
      addIssue(`Tower ${tower.id} overlaps wall ${wall.t1}-${wall.t2}.`, [keyFor("tower", tower), keyFor("wall", wall)]);
    });
  });

  HOLE_GEOMETRY.validateMapHoles(mapState).forEach((issue) => {
    const keys = [];
    issue.holeIndexes.forEach((holeIndex) => {
      const hole = mapState.map_holes[holeIndex];
      if (!hole) return;
      keys.push(keyFor("hole", hole));
      (hole.points || []).forEach((point) => keys.push(keyFor("holeVertex", point)));
    });
    if (issue.entity) {
      const collectionByType = { spawn: mapState.spawn_points, tower: mapState.towers, bomb: mapState.bomb_sites };
      const item = collectionByType[issue.entity.type]?.[issue.entity.index];
      keys.push(keyFor(issue.entity.type, item));
    }
    addIssue(issue.message, keys);
  });

  return { issues, invalidKeys };
}

function isActiveRotationInvalidKey(key) {
  return Boolean(interaction.rotate?.invalid && interaction.rotate.keySet?.has(key));
}

function isActiveRotationInvalidWall(wall) {
  if (!interaction.rotate?.invalid) return false;
  const a = getTowerById(wall.t1);
  const b = getTowerById(wall.t2);
  return Boolean(
    (a && interaction.rotate.keySet?.has(makeKey("tower", a.uid)))
    || (b && interaction.rotate.keySet?.has(makeKey("tower", b.uid))),
  );
}

function updateInvalidObjectWarning() {
  const report = getMapValidationReport();
  const count = report.invalidKeys.size;
  const previousCount = invalidObjectWarningCount;
  invalidObjectWarningCount = count;
  if (report.issues.length <= 0) {
    if (previousCount > 0 && el.actionState.classList.contains("warn")) {
      el.actionState.textContent = "Idle";
      el.actionState.className = "action-state idle";
    }
    return false;
  }
  const additional = report.issues.length > 1 ? ` (+${report.issues.length - 1} more)` : "";
  const objectSummary = count > 0 ? `${count} invalid object${count === 1 ? "" : "s"}: ` : "Map invalid: ";
  setActionState(`${objectSummary}${report.issues[0].message}${additional}`, "warn");
  return true;
}

function draw() {
  activeValidationReport = getMapValidationReport();
  activeLiveMirrorPreviewModel = buildActiveLiveMirrorPreviewModel();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  drawGrid();
  drawMirrorAxes();
  drawBoundaryFogMask();
  drawHoles();
  drawBoundary();
  drawBombSites();
  drawStructures();
  drawWalls();
  drawTowerChainGhostWall();
  drawSpawns();
  drawTowers();
  drawSelectionTransformBounds();
  drawBuildGhostTower();
  drawPlacementGhost();
  drawPasteDraft();
  drawLiveMirrorPreview();
  multiplayerManager?.drawCursors();
  drawGuides();
  drawWallDraft();
  drawBoxSelection();
  activeValidationReport = null;
  activeLiveMirrorPreviewModel = null;
}

function drawGrid() {
  const left = screenToWorld(0, 0).x;
  const right = screenToWorld(viewport.width, 0).x;
  const top = screenToWorld(0, 0).y;
  const bottom = screenToWorld(0, viewport.height).y;
  const cell = Math.max(4, Number(editorSettings.gridSize) || 48);
  const majorCell = cell * 5;
  const xStart = Math.floor(left / cell) * cell;
  const yStart = Math.floor(top / cell) * cell;

  ctx.strokeStyle = COLORS.gridMinor;
  ctx.lineWidth = Math.max(0.25, Number(editorSettings.gridLineWidth) || 1);

  for (let x = xStart; x <= right; x += cell) {
    if (editorSettings.gridMajorVisible && Math.abs(x % majorCell) < 0.001) continue;
    const sx = worldToScreen(x, 0).x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, viewport.height);
    ctx.stroke();
  }

  for (let y = yStart; y <= bottom; y += cell) {
    if (editorSettings.gridMajorVisible && Math.abs(y % majorCell) < 0.001) continue;
    const sy = worldToScreen(0, y).y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(viewport.width, sy);
    ctx.stroke();
  }

  if (editorSettings.gridMajorVisible) {
    const majorXStart = Math.floor(left / majorCell) * majorCell;
    const majorYStart = Math.floor(top / majorCell) * majorCell;
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.lineWidth = Math.max(0.25, Number(editorSettings.gridLineWidth) || 1) * 1.5;

    for (let x = majorXStart; x <= right; x += majorCell) {
      const sx = worldToScreen(x, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewport.height);
      ctx.stroke();
    }

    for (let y = majorYStart; y <= bottom; y += majorCell) {
      const sy = worldToScreen(0, y).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(viewport.width, sy);
      ctx.stroke();
    }
  }

  // Emphasize the world axes so the map's horizontal and vertical halves are easy to read.
  if (editorSettings.originAxesVisible) {
    ctx.strokeStyle = "#7C95AA";
    ctx.lineWidth = Math.max(0.25, Number(editorSettings.gridLineWidth) || 1) * 2.25;
    if (left <= 0 && right >= 0) {
      const sx = worldToScreen(0, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewport.height);
      ctx.stroke();
    }
    if (top <= 0 && bottom >= 0) {
      const sy = worldToScreen(0, 0).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(viewport.width, sy);
      ctx.stroke();
    }
  }
}

function drawBoundaryFogMask() {
  if (state.map_boundaries.length < 3) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, viewport.width, viewport.height);

  state.map_boundaries.forEach((point, i) => {
    const p = worldToScreen(point.x, point.y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();

  ctx.fillStyle = COLORS.boundaryFog;
  ctx.fill("evenodd");
  ctx.restore();
}

function drawBoundary() {
  if (!state.map_boundaries.length) return;
  const boundaryInvalid = state.map_boundaries.some((point) => isObjectInvalid("boundary", point));
  ctx.strokeStyle = boundaryInvalid ? COLORS.danger : COLORS.boundary;
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
    const invalid = isObjectInvalid("boundary", point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = invalid ? COLORS.danger : (selected ? "#FFFFFF" : "#AEBAC8");
    ctx.fill();
  });
}

function drawHoles() {
  state.map_holes.forEach((hole) => {
    if (!hole.points.length) return;
    const selected = selection.has(makeKey("hole", hole.uid));
    const invalid = isObjectInvalid("hole", hole);
    ctx.beginPath();
    hole.points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (hole.points.length >= 3) ctx.closePath();
    ctx.fillStyle = COLORS.boundaryFog;
    if (hole.points.length >= 3) ctx.fill();
    ctx.lineWidth = (selected ? 6 : 4) * view.scale;
    ctx.strokeStyle = invalid ? COLORS.danger : (selected ? "#FFFFFF" : COLORS.holeRim);
    ctx.stroke();

    hole.points.forEach((point) => {
      const screen = worldToScreen(point.x, point.y);
      const pointSelected = selection.has(makeKey("holeVertex", point.uid));
      const pointInvalid = isObjectInvalid("holeVertex", point);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, pointSelected ? 7 : selected ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = pointInvalid ? COLORS.danger : (pointSelected ? "#FFE08A" : selected ? "#FFFFFF" : "#AEBAC8");
      ctx.fill();
      if (pointSelected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#FFFFFF";
        ctx.stroke();
      }
    });
  });
}

function drawStructures() {
  state.structures.forEach((s) => {
    if (isSuppressedLiveMirrorItem("structure", s.uid)) return;
    const p = worldToScreen(s.x, s.y);
    const size = Math.max(14, s.size * view.scale);
    const half = size / 2;
    const selected = selection.has(makeKey("structure", s.uid));
    const invalid = isObjectInvalid("structure", s) || isActiveRotationInvalidKey(makeKey("structure", s.uid));
    const fillColor = invalid ? COLORS.danger : (TEAM_COLORS[String(s.team_id)] || s.color || COLORS.red);
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = invalid ? 0.55 : 1.0;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = selected ? 3.3 : 2;
    ctx.strokeStyle = invalid ? COLORS.danger : (selected ? "#FFD166" : "#5C1219");
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
    if (activeLiveMirrorPreviewModel?.suppressedWallUids.has(wall.uid)) return;
    const aTower = getTowerById(wall.t1);
    const bTower = getTowerById(wall.t2);
    if (!aTower || !bTower) return;
    const a = worldToScreen(aTower.x, aTower.y);
    const b = worldToScreen(bTower.x, bTower.y);
    const invalid = isObjectInvalid("wall", wall) || isObjectInvalid("tower", aTower) || isObjectInvalid("tower", bTower) || isActiveRotationInvalidWall(wall);
    const color = invalid ? COLORS.danger : getTeamColor(wall.team_id);
    ctx.lineCap = "round";
    ctx.lineWidth = 32 * view.scale;
    ctx.globalAlpha = invalid ? 0.55 : 0.85;
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
    if (isSuppressedLiveMirrorItem("spawn", spawn.uid)) return;
    const p = worldToScreen(spawn.x, spawn.y);
    const spawnSize = Math.max(1, Number(state.spawn_protection_size) || 500);
    const size = spawnSize * view.scale;
    const half = size / 2;
    const invalid = isObjectInvalid("spawn", spawn) || isActiveRotationInvalidKey(makeKey("spawn", spawn.uid));
    const color = invalid ? COLORS.danger : getTeamColor(spawn.team_id);
    ctx.lineWidth = 4 * view.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = invalid ? 0.38 : 0.25;
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
    if (isSuppressedLiveMirrorItem("bomb", bomb.uid)) return;
    const p = worldToScreen(bomb.x, bomb.y);
    const radius = 250 * view.scale;
    const invalid = isObjectInvalid("bomb", bomb) || isActiveRotationInvalidKey(makeKey("bomb", bomb.uid));
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = invalid ? withAlpha(COLORS.danger, 0.85) : "rgba(51, 127, 229, 0.8)";
    ctx.fillStyle = invalid ? withAlpha(COLORS.danger, 0.22) : "rgba(51, 127, 229, 0.15)";
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
    if (isSuppressedLiveMirrorItem("tower", tower.uid)) return;
    const p = worldToScreen(tower.x, tower.y);
    const invalid = isObjectInvalid("tower", tower) || isActiveRotationInvalidKey(makeKey("tower", tower.uid));
    const color = getTeamColor(tower.team_id);
    const borderColor = tower.is_invincible ? "#FFD166" : color;

    ctx.beginPath();
    ctx.arc(p.x, p.y, (GAME.TOWER_DIAMETER / 2) * view.scale, 0, Math.PI * 2);
    ctx.lineWidth = (GAME.TOWER_DIAMETER / 11) * view.scale;
    ctx.strokeStyle = borderColor;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();

    if (invalid) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (GAME.TOWER_DIAMETER / 2) * view.scale, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(COLORS.danger, 0.35);
      ctx.fill();
      ctx.lineWidth = 4 * view.scale;
      ctx.strokeStyle = COLORS.danger;
      ctx.stroke();
    }

    if (!tower.is_invincible) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${(GAME.TOWER_DIAMETER / 5.5) * view.scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(tower.health), p.x, p.y);
    }

    if (selection.has(makeKey("tower", tower.uid))) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, ((GAME.TOWER_DIAMETER / 2) + (GAME.TOWER_DIAMETER / 11)) * view.scale, 0, Math.PI * 2);
      ctx.lineWidth = 3 * view.scale;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
    }
  });
}

function drawTowerChainGhostWall() {
  if (interaction.mode !== "build") return;
  const startTower = getAutoWallStartTower();
  if (!startTower) return;

  const hoveredTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
  const snappedTarget = getBuildPlacementTarget(interaction.mouseWorld, startTower);
  const rawTarget = hoveredTower && hoveredTower.id !== startTower.id
    ? { x: hoveredTower.x, y: hoveredTower.y }
    : snappedTarget;
  const outsideBoundary = hoveredTower ? false : !isPlacementInsideBoundary("tower", rawTarget.x, rawTarget.y);
  let color = getTeamColor(startTower.team_id);
  if (outsideBoundary) color = COLORS.danger;

  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(rawTarget.x, rawTarget.y);

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

function drawBuildGhostTower() {
  if (interaction.mode !== "build") return;
  const startTower = getAutoWallStartTower();
  const ghost = interaction.buildGhost || getBuildPlacementTarget(interaction.mouseWorld, startTower);
  if (!ghost) return;

  const p = worldToScreen(ghost.x, ghost.y);
  const teamId = startTower ? startTower.team_id : defaults.defaultTeam;
  const invalid = Boolean(ghost.invalid) || !isPlacementInsideBoundary("tower", ghost.x, ghost.y);
  const color = invalid ? COLORS.danger : getTeamColor(teamId);
  const borderColor = defaults.towerInvincible && !invalid ? "#FFD166" : color;

  ctx.globalAlpha = invalid ? 0.45 : 0.35;
  ctx.beginPath();
  ctx.arc(p.x, p.y, (GAME.TOWER_DIAMETER / 2) * view.scale, 0, Math.PI * 2);
  ctx.lineWidth = (GAME.TOWER_DIAMETER / 11) * view.scale;
  ctx.strokeStyle = borderColor;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();

  if (!defaults.towerInvincible) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `${(GAME.TOWER_DIAMETER / 5.5) * view.scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(clamp(1, Math.round(defaults.towerHealth), GAME.TOWER_MAX_HEALTH)), p.x, p.y);
  }
  ctx.globalAlpha = 1.0;
}

function drawPlacementGhost() {
  const ghost = interaction.placementGhost;
  if (!ghost) return;
  if (ghost.type === "spawn") {
    drawSpawnGhost(ghost);
  } else if (ghost.type === "bomb") {
    drawBombGhost(ghost);
  } else if (ghost.type === "boundary") {
    drawBoundaryGhost(ghost);
  } else if (ghost.type === "hole") {
    drawHoleGhost(ghost);
  }
}

function drawPasteDraft() {
  const draft = interaction.pasteDraft;
  if (!draft) return;
  const entities = getPasteDraftEntities(draft);
  const invalid = !validatePasteDraft(draft).valid;
  const towerByOriginalId = new Map(entities.towers.map((tower) => [tower.id, tower]));

  if (entities.boundaries.length) {
    ctx.beginPath();
    entities.boundaries.forEach((boundary, index) => {
      const point = worldToScreen(boundary.x, boundary.y);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    if (entities.boundaries.length >= 3) ctx.closePath();
    ctx.strokeStyle = invalid ? COLORS.danger : withAlpha(COLORS.guide, 0.9);
    ctx.lineWidth = 3 * view.scale;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    entities.boundaries.forEach((boundary) => {
      const point = worldToScreen(boundary.x, boundary.y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = invalid ? COLORS.danger : COLORS.guide;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  entities.holes.forEach((hole) => {
    if (!hole.points.length) return;
    ctx.beginPath();
    hole.points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (hole.points.length >= 3) ctx.closePath();
    ctx.fillStyle = invalid ? withAlpha(COLORS.danger, 0.28) : COLORS.boundaryFog;
    ctx.strokeStyle = invalid ? COLORS.danger : withAlpha(COLORS.guide, 0.9);
    ctx.lineWidth = 3 * view.scale;
    ctx.globalAlpha = 0.8;
    if (hole.points.length >= 3) ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  entities.walls.forEach((wall) => {
    const aTower = towerByOriginalId.get(wall.t1);
    const bTower = towerByOriginalId.get(wall.t2);
    if (!aTower || !bTower) return;
    const a = worldToScreen(aTower.x, aTower.y);
    const b = worldToScreen(bTower.x, bTower.y);
    ctx.lineCap = "round";
    ctx.lineWidth = 32 * view.scale;
    ctx.strokeStyle = invalid ? COLORS.danger : getTeamColor(wall.team_id);
    ctx.globalAlpha = invalid ? 0.45 : 0.35;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  });

  entities.structures.forEach((structure) => {
    const p = worldToScreen(structure.x, structure.y);
    const size = Math.max(14, structure.size * view.scale);
    const half = size / 2;
    ctx.fillStyle = invalid ? COLORS.danger : (TEAM_COLORS[String(structure.team_id)] || structure.color || COLORS.red);
    ctx.globalAlpha = invalid ? 0.42 : 0.35;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = invalid ? COLORS.danger : "#FFFFFF";
    ctx.lineWidth = 2 * view.scale;
    ctx.strokeRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 1.0;
  });

  entities.spawns.forEach((spawn) => {
    const p = worldToScreen(spawn.x, spawn.y);
    const spawnSize = Math.max(1, Number(state.spawn_protection_size) || 500);
    const size = spawnSize * view.scale;
    const half = size / 2;
    const color = invalid ? COLORS.danger : getTeamColor(spawn.team_id);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = invalid ? 0.35 : 0.22;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4 * view.scale;
    ctx.strokeRect(p.x - half, p.y - half, size, size);
    ctx.globalAlpha = 1.0;
  });

  entities.bombs.forEach((bomb) => {
    const p = worldToScreen(bomb.x, bomb.y);
    const radius = 250 * view.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = invalid ? withAlpha(COLORS.danger, 0.85) : "rgba(51, 127, 229, 0.8)";
    ctx.fillStyle = invalid ? withAlpha(COLORS.danger, 0.2) : "rgba(51, 127, 229, 0.15)";
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${72 * view.scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(bomb.site_letter || "A").toUpperCase(), p.x, p.y);
    ctx.globalAlpha = 1.0;
  });

  entities.towers.forEach((tower) => {
    const p = worldToScreen(tower.x, tower.y);
    const color = invalid ? COLORS.danger : getTeamColor(tower.team_id);
    const borderColor = tower.is_invincible && !invalid ? "#FFD166" : color;
    ctx.globalAlpha = invalid ? 0.45 : 0.35;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (GAME.TOWER_DIAMETER / 2) * view.scale, 0, Math.PI * 2);
    ctx.lineWidth = (GAME.TOWER_DIAMETER / 11) * view.scale;
    ctx.strokeStyle = borderColor;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();

    if (!tower.is_invincible) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${(GAME.TOWER_DIAMETER / 5.5) * view.scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(tower.health), p.x, p.y);
    }
    ctx.globalAlpha = 1.0;
  });
}

function drawSpawnGhost(ghost) {
  const p = worldToScreen(ghost.x, ghost.y);
  const spawnSize = Math.max(1, Number(state.spawn_protection_size) || 500);
  const size = spawnSize * view.scale;
  const half = size / 2;
  const color = ghost.invalid ? COLORS.danger : getTeamColor(defaults.defaultTeam);

  ctx.lineWidth = 4 * view.scale;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = ghost.invalid ? 0.35 : 0.22;
  ctx.fillRect(p.x - half, p.y - half, size, size);
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(p.x - half, p.y - half, size, size);

  const iconSize = 20 * view.scale;
  const iconHalf = iconSize / 2;
  ctx.globalAlpha = ghost.invalid ? 0.75 : 0.9;
  ctx.fillRect(p.x - iconHalf, p.y - iconHalf, iconSize, iconSize);
  ctx.globalAlpha = 1.0;
}

function drawBombGhost(ghost) {
  const p = worldToScreen(ghost.x, ghost.y);
  const radius = 250 * view.scale;
  const stroke = ghost.invalid ? withAlpha(COLORS.danger, 0.85) : "rgba(51, 127, 229, 0.8)";
  const fill = ghost.invalid ? withAlpha(COLORS.danger, 0.2) : "rgba(51, 127, 229, 0.15)";

  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 8 * view.scale;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${72 * view.scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.85;
  ctx.fillText(nextBombSiteLetter(), p.x, p.y);
  ctx.globalAlpha = 1.0;
}

function drawBoundaryGhost(ghost) {
  const p = worldToScreen(ghost.x, ghost.y);
  const last = state.map_boundaries[state.map_boundaries.length - 1];
  if (last) {
    const s = worldToScreen(last.x, last.y);
    ctx.strokeStyle = withAlpha(COLORS.guide, 0.65);
    ctx.lineWidth = 2 * view.scale;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(COLORS.guide, 0.82);
  ctx.fill();
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHoleGhost(ghost) {
  const points = interaction.holeDraft?.points || [];
  const previewPoints = [...points, ...(ghost.closing ? [] : [{ x: ghost.x, y: ghost.y }])];
  if (!previewPoints.length) return;
  ctx.beginPath();
  previewPoints.forEach((point, index) => {
    const screen = worldToScreen(point.x, point.y);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  if (ghost.closing && points.length >= 3) ctx.closePath();
  ctx.lineWidth = 3 * view.scale;
  ctx.strokeStyle = ghost.invalid ? COLORS.danger : withAlpha(COLORS.guide, 0.9);
  if (ghost.closing && points.length >= 3) {
    ctx.fillStyle = COLORS.boundaryFog;
    ctx.fill();
  }
  ctx.stroke();
  points.forEach((point, index) => {
    const screen = worldToScreen(point.x, point.y);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, index === 0 ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 && ghost.closing ? "#FFFFFF" : withAlpha(COLORS.guide, 0.95);
    ctx.fill();
  });
  if (!ghost.closing) {
    const screen = worldToScreen(ghost.x, ghost.y);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = ghost.invalid ? COLORS.danger : COLORS.guide;
    ctx.fill();
  }
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
  drawRotationWallSnapGuide();
}

function drawRotationWallSnapGuide() {
  const guide = interaction.rotate?.wallSnapGuide;
  if (!guide) return;
  drawGuideSegment(guide.target.a, guide.target.b, 5, 0.88);
  drawGuideSegment(guide.source.a, guide.source.b, 3, 0.72);
  [guide.target.a, guide.target.b, guide.source.a, guide.source.b].forEach((point) => {
    const p = worldToScreen(point.x, point.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(COLORS.guide, 0.95);
    ctx.fill();
  });
}

function drawGuideSegment(a, b, width, alpha) {
  const start = worldToScreen(a.x, a.y);
  const end = worldToScreen(b.x, b.y);
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = withAlpha(COLORS.guide, alpha);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function roundRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(rawTarget.x, rawTarget.y);
  const color = getTeamColor(startTower.team_id);
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
  const invalidRemoved = getOutOfBoundsObjects().length;
  const exportState = getExportableState();
  const validation = validateForExport(exportState);
  if (validation) {
    alert(validation);
    setActionState(validation, "error");
    requestRender();
    return;
  }
  const payload = buildExportPayload(exportState);
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
  setActionState(invalidRemoved ? `Export successful; removed ${invalidRemoved} invalid object${invalidRemoved === 1 ? "" : "s"}` : "Export successful", "success", true);
}

function buildExportPayload(exportState) {
  const payload = {
    spawn_protection_size: Number(exportState.spawn_protection_size),
    map_boundaries: exportState.map_boundaries.map((point) => ({ x: roundTo(point.x, 3), y: roundTo(point.y, 3) })),
    spawn_points: exportState.spawn_points.map((spawn) => ({ team_id: spawn.team_id, x: roundTo(spawn.x, 3), y: roundTo(spawn.y, 3) })).sort((a, b) => a.team_id - b.team_id),
    bomb_sites: exportState.bomb_sites.map((bomb) => ({ site_letter: String(bomb.site_letter || "A").toUpperCase(), x: roundTo(bomb.x, 3), y: roundTo(bomb.y, 3) })),
    towers: [...exportState.towers].sort((a, b) => a.id - b.id).map((tower) => ({
      id: tower.id,
      team_id: tower.team_id,
      x: roundTo(tower.x, 3),
      y: roundTo(tower.y, 3),
      health: clamp(1, Math.round(tower.health), GAME.TOWER_MAX_HEALTH),
      is_invincible: Boolean(tower.is_invincible),
    })),
    walls: exportState.walls.map((wall) => ({ t1: wall.t1, t2: wall.t2, team_id: wall.team_id })),
  };
  HOLE_GEOMETRY.addMapHolesToPayload(payload, exportState.map_holes, (value) => roundTo(value, 3));
  if (exportState.structures.length) {
    payload.structures = exportState.structures.map((structure) => ({
      id: structure.id,
      x: roundTo(structure.x, 3),
      y: roundTo(structure.y, 3),
      size: structure.size,
      label: structure.label,
      color: structure.color,
      team_id: structure.team_id,
    }));
  }
  return payload;
}

function getOutOfBoundsObjects(mapState = state) {
  const out = [];
  const collect = (type, items) => items.forEach((item) => {
    if (isObjectOutsideBoundary(type, item, mapState)) out.push({ type, item });
  });
  collect("tower", mapState.towers);
  collect("spawn", mapState.spawn_points);
  collect("bomb", mapState.bomb_sites);
  collect("structure", mapState.structures);
  return out;
}

function getExportableState() {
  const towers = state.towers.filter((item) => !isObjectOutsideBoundary("tower", item));
  const towerIds = new Set(towers.map((tower) => tower.id));
  return {
    ...state,
    spawn_points: state.spawn_points.filter((item) => !isObjectOutsideBoundary("spawn", item)),
    bomb_sites: state.bomb_sites.filter((item) => !isObjectOutsideBoundary("bomb", item)),
    towers,
    walls: state.walls.filter((wall) => towerIds.has(wall.t1) && towerIds.has(wall.t2)),
    structures: state.structures.filter((item) => !isObjectOutsideBoundary("structure", item)),
  };
}

function validateForExport(mapState = state) {
  const report = getMapValidationReport(mapState);
  return report.issues.length ? `Validation error: ${report.issues[0].message}` : null;
}

function getDeflyConversionOptions() {
  return {
    spacingPercent: Number(el.deflySpacingInput.value),
    unitSize: Number(el.deflyUnitSizeInput.value),
    spawnProtectionSize: Number(el.deflySpawnSizeInput.value),
    towerClearance: Number(el.deflyTowerClearanceInput.value),
    bombClearance: Number(el.deflyBombClearanceInput.value),
    boundaryPadding: Number(el.deflyBoundaryPaddingInput.value),
  };
}

function beginDeflyConversion(contents, fileName = "source map") {
  if (typeof convertDeflyMap !== "function") throw new Error("The map converter is unavailable.");
  if (conversionSession) cancelDeflyConversion(false);
  el.deflySpacingInput.value = "100";
  el.deflyUnitSizeInput.value = "32";
  el.deflySpawnSizeInput.value = String(Number(state.spawn_protection_size) || 500);
  el.deflyTowerClearanceInput.value = "35.2";
  el.deflyBombClearanceInput.value = "250";
  el.deflyBoundaryPaddingInput.value = "1";
  conversionSession = {
    sourceText: String(contents),
    fileName: String(fileName || "source map"),
    beforeState: cloneState(state),
    beforeView: { ...view },
    valid: false,
  };
  el.deflyConversionPanel.classList.remove("hidden");
  setSettingsOpen(false);
  setMode("select");
  updateDeflyConversionPreview();
}

function applyConversionPreviewState(nextState) {
  state = nextState;
  normalizeMapHolesInState();
  normalizeTowerHealthInState();
  selection.clear();
  interaction.pasteDraft = null;
  interaction.drag = null;
  interaction.rotate = null;
  interaction.resize = null;
  hydrateCountersFromState();
  renderSelectionPanel();
  el.spawnProtectionInput.value = String(state.spawn_protection_size);
  updateInvalidObjectWarning();
  fitBoundaryInView();
  requestRender();
}

function updateDeflyConversionPreview() {
  if (!conversionSession) return false;
  try {
    const converted = convertDeflyMap(conversionSession.sourceText, getDeflyConversionOptions());
    const preview = parseImportedState(converted);
    centerMapStateOnOrigin(preview);
    conversionSession.valid = true;
    conversionSession.previewState = cloneState(preview);
    applyConversionPreviewState(preview);
    const width = state.map_boundaries.length ? Math.max(...state.map_boundaries.map((point) => point.x)) - Math.min(...state.map_boundaries.map((point) => point.x)) : 0;
    const height = state.map_boundaries.length ? Math.max(...state.map_boundaries.map((point) => point.y)) - Math.min(...state.map_boundaries.map((point) => point.y)) : 0;
    el.deflyConversionStatus.classList.remove("error");
    el.deflyConversionStatus.textContent = `${state.towers.length} towers · ${state.walls.length} walls · ${roundTo(width, 1)} × ${roundTo(height, 1)} map`;
    el.finishDeflyConversionBtn.disabled = false;
    setActionState("Map conversion preview — adjust values or finish", "idle");
    return true;
  } catch (error) {
    conversionSession.valid = false;
    el.deflyConversionStatus.classList.add("error");
    el.deflyConversionStatus.textContent = error.message;
    el.finishDeflyConversionBtn.disabled = true;
    setActionState(`Conversion setting error: ${error.message}`, "warn");
    return false;
  }
}

function finishDeflyConversion() {
  if (!conversionSession || !conversionSession.valid) return false;
  const session = conversionSession;
  const after = cloneState(state);
  conversionSession = null;
  el.deflyConversionPanel.classList.add("hidden");
  pushHistory("IMPORT_CONVERTED_MAP", session.beforeState, after);
  onStateChanged();
  const report = getMapValidationReport();
  if (report.issues.length) {
    const additional = report.issues.length > 1 ? ` (+${report.issues.length - 1} more)` : "";
    setActionState(`Map conversion finished with validation issues: ${report.issues[0].message}${additional}`, "warn");
  } else {
    setActionState("Map conversion finished", "success", true);
  }
  return true;
}

function cancelDeflyConversion(showMessage = true) {
  if (!conversionSession) return false;
  const previous = cloneState(conversionSession.beforeState);
  const previousView = { ...conversionSession.beforeView };
  conversionSession = null;
  el.deflyConversionPanel.classList.add("hidden");
  state = previous;
  Object.assign(view, previousView);
  onStateReplaced();
  if (showMessage) setActionState("Map conversion cancelled", "idle", true);
  return true;
}

function importMap(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const contents = String(reader.result);
      const fileName = file.name.toLowerCase();
      const isDeflyText = fileName.endsWith(".txt");
      const isJson = fileName.endsWith(".json");
      if (!isDeflyText && !isJson) throw new Error("Choose a .json or .txt map file.");

      if (isDeflyText) {
        beginDeflyConversion(contents, file.name);
        return;
      }
      const parsed = JSON.parse(contents);
      const convertedHealthCount = Array.isArray(parsed?.towers)
        ? parsed.towers.filter((tower) => Number(tower?.health) > GAME.TOWER_MAX_HEALTH).length
        : 0;
      const imported = parseImportedState(parsed);
      centerMapStateOnOrigin(imported);
      const before = cloneState(state);
      state = imported;
      pushHistory("IMPORT_JSON", before, cloneState(state));
      onStateReplaced();
      const report = getMapValidationReport();
      const conversionNote = convertedHealthCount
        ? ` Converted ${convertedHealthCount} tower${convertedHealthCount === 1 ? "" : "s"} from 5 HP to ${GAME.TOWER_MAX_HEALTH} HP.`
        : "";
      const importLabel = "JSON";
      if (report.issues.length) {
        const additional = report.issues.length > 1 ? ` (+${report.issues.length - 1} more)` : "";
        setActionState(`${importLabel} imported with validation issues.${conversionNote} ${report.issues[0].message}${additional}`, "warn");
      } else {
        setActionState(`${importLabel} imported.${conversionNote}`.trim(), "success", true);
      }
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
  const holes = HOLE_GEOMETRY.parseMapHoles(data.map_holes, createUid);
  const spawnRaw = expectArray(data.spawn_points, "spawn_points");
  const bombRaw = expectArray(data.bomb_sites, "bomb_sites");
  const towersRaw = expectArray(data.towers, "towers");
  const wallsRaw = expectArray(data.walls, "walls");
  const structRaw = Array.isArray(data.structures) ? data.structures : [];
  const imported = {
    spawn_protection_size: expectNumber(data.spawn_protection_size, "spawn_protection_size"),
    map_boundaries: mapRaw.map((p, i) => ({ uid: createUid("boundary"), x: expectNumber(p?.x, `map_boundaries[${i}].x`), y: expectNumber(p?.y, `map_boundaries[${i}].y`) })),
    map_holes: holes,
    spawn_points: spawnRaw.map((s, i) => ({ uid: createUid("spawn"), team_id: expectInteger(s?.team_id, `spawn_points[${i}].team_id`), x: expectNumber(s?.x, `spawn_points[${i}].x`), y: expectNumber(s?.y, `spawn_points[${i}].y`) })),
    bomb_sites: bombRaw.map((b, i) => ({ uid: createUid("bomb"), site_letter: expectString(b?.site_letter, `bomb_sites[${i}].site_letter`).toUpperCase(), x: expectNumber(b?.x, `bomb_sites[${i}].x`), y: expectNumber(b?.y, `bomb_sites[${i}].y`) })),
    towers: towersRaw.map((t, i) => ({
      uid: createUid("tower"),
      id: expectInteger(t?.id, `towers[${i}].id`),
      team_id: expectInteger(t?.team_id, `towers[${i}].team_id`),
      x: expectNumber(t?.x, `towers[${i}].x`),
      y: expectNumber(t?.y, `towers[${i}].y`),
      health: clamp(1, expectInteger(t?.health, `towers[${i}].health`), GAME.TOWER_MAX_HEALTH),
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
  imported.walls.forEach((w) => {
    if (!towerIds.has(w.t1) || !towerIds.has(w.t2)) throw new Error("Wall references a missing tower id.");
  });
  return imported;
}

function drawMirrorAxes() {
  const axes = [...mirrorState.axes];
  if (interaction.mirrorDraft) axes.push({ type: interaction.mirrorDraft.type, a: interaction.mirrorDraft.start, b: interaction.mirrorDraft.end, draft: true });
  axes.forEach((axis, index) => {
    if (!isUsableMirrorAxis(axis)) return;
    const dragging = interaction.mirrorAxisDrag?.index === index && !axis.draft;
    const selected = interaction.selectedMirrorAxisIndex === index && !axis.draft;
    const a = worldToScreen(axis.a.x, axis.a.y);
    const b = worldToScreen(axis.b.x, axis.b.y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const extension = Math.hypot(viewport.width, viewport.height) * 2;
    ctx.save();
    ctx.setLineDash(axis.type === "rotate" ? [12, 8] : axis.draft ? [8, 6] : []);
    ctx.lineWidth = dragging || selected ? 3.25 : axis.draft ? 2.5 : 1.75;
    ctx.strokeStyle = dragging || selected ? "rgba(255, 255, 255, 0.98)" : axis.type === "rotate" ? "rgba(255, 128, 220, 0.9)" : "rgba(111, 207, 231, 0.88)";
    ctx.beginPath();
    ctx.moveTo(a.x - ux * extension, a.y - uy * extension);
    ctx.lineTo(b.x + ux * extension, b.y + uy * extension);
    ctx.stroke();
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.setLineDash([]);
    ctx.fillStyle = selected ? "#FFFFFF" : axis.type === "rotate" ? "#FF80DC" : "#6FCFE7";
    ctx.beginPath();
    ctx.arc(center.x, center.y, axis.type === "rotate" ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "11px Space Mono, monospace";
    ctx.fillText(axis.type === "rotate" ? "180°" : `M${index + 1}`, center.x + 8, center.y - 8);
    ctx.restore();
  });
}

function drawSelectionTransformBounds() {
  if (interaction.mode !== "select" || interaction.drag) return;
  const keys = getTransformableSelectionKeys();
  if (keys.length < 2 && !canResizeSingleSelection(keys)) return;
  const bounds = getSelectionTransformBoundsScreen(keys);
  if (!bounds) return;
  const { minX, maxX, minY, maxY } = bounds;
  const handles = getSelectionTransformHandles(bounds);
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = interaction.resize ? "rgba(255, 224, 138, 0.95)" : "rgba(116, 200, 255, 0.8)";
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.setLineDash([]);
  Object.entries(handles).forEach(([name, point]) => {
    if (name === "rotate") return;
    ctx.fillStyle = "#FFE08A";
    ctx.strokeStyle = "#0D0F17";
    ctx.lineWidth = 1;
    ctx.fillRect(point.x - 5, point.y - 5, 10, 10);
    ctx.strokeRect(point.x - 5, point.y - 5, 10, 10);
  });
  const topCenter = handles.n;
  ctx.strokeStyle = "rgba(116, 200, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(topCenter.x, topCenter.y);
  ctx.lineTo(handles.rotate.x, handles.rotate.y);
  ctx.stroke();
  ctx.fillStyle = "#74C8FF";
  ctx.beginPath();
  ctx.arc(handles.rotate.x, handles.rotate.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0D0F17";
  ctx.stroke();
  ctx.restore();
}

function getSelectionTransformBoundsScreen(keys = getTransformableSelectionKeys()) {
  const entries = keys.map(resolveKey).filter(Boolean);
  if (!entries.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  entries.forEach((entry) => {
    const position = getKeyPosition(entry.key);
    if (!position) return;
    const point = worldToScreen(position.x, position.y);
    const worldPadding = entry.type === "structure"
      ? (Number(entry.item.size) || 20) / 2
      : entry.type === "tower" ? GAME.TOWER_DIAMETER / 2 : 22;
    const padding = ["boundary", "holeVertex"].includes(entry.type) ? 0 : worldPadding * view.scale;
    minX = Math.min(minX, point.x - padding);
    maxX = Math.max(maxX, point.x + padding);
    minY = Math.min(minY, point.y - padding);
    maxY = Math.max(maxY, point.y + padding);
  });
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  if (maxX - minX < 24) {
    const middle = (minX + maxX) / 2;
    minX = middle - 12;
    maxX = middle + 12;
  }
  if (maxY - minY < 24) {
    const middle = (minY + maxY) / 2;
    minY = middle - 12;
    maxY = middle + 12;
  }
  return { minX, maxX, minY, maxY };
}

function getSelectionTransformHandles(bounds) {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  return {
    nw: { x: bounds.minX, y: bounds.minY }, n: { x: midX, y: bounds.minY }, ne: { x: bounds.maxX, y: bounds.minY },
    e: { x: bounds.maxX, y: midY }, se: { x: bounds.maxX, y: bounds.maxY }, s: { x: midX, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY }, w: { x: bounds.minX, y: midY }, rotate: { x: midX, y: bounds.minY - 30 },
  };
}

function hitSelectionTransformControl(screen) {
  if (interaction.mode !== "select" || interaction.drag || interaction.rotate || interaction.resize) return null;
  const keys = getTransformableSelectionKeys();
  if (keys.length < 2 && !canResizeSingleSelection(keys)) return null;
  const bounds = getSelectionTransformBoundsScreen(keys);
  if (!bounds) return null;
  const handles = getSelectionTransformHandles(bounds);
  if (distance(screen.x, screen.y, handles.rotate.x, handles.rotate.y) <= 10) return { type: "rotate" };
  for (const [handle, point] of Object.entries(handles)) {
    if (handle !== "rotate" && Math.abs(screen.x - point.x) <= 8 && Math.abs(screen.y - point.y) <= 8) {
      return { type: "resize", handle };
    }
  }
  const withinX = screen.x >= bounds.minX - 6 && screen.x <= bounds.maxX + 6;
  const withinY = screen.y >= bounds.minY - 6 && screen.y <= bounds.maxY + 6;
  const nearEdge = withinX && withinY && (
    Math.abs(screen.x - bounds.minX) <= 6 || Math.abs(screen.x - bounds.maxX) <= 6
    || Math.abs(screen.y - bounds.minY) <= 6 || Math.abs(screen.y - bounds.maxY) <= 6
  );
  return nearEdge ? { type: "move" } : null;
}

function drawLiveMirrorPreview() {
  const previewAxes = interaction.mirrorDraft
    ? [...mirrorState.axes, { type: interaction.mirrorDraft.type, a: interaction.mirrorDraft.start, b: interaction.mirrorDraft.end }]
    : mirrorState.axes;
  if (!previewAxes.length) return;
  const activeTransform = interaction.drag || interaction.rotate || interaction.resize;
  const previewEntries = [];
  if (mirrorState.liveEnabled && activeTransform) {
    const keys = activeTransform.keys || [];
    keys.forEach((key) => {
      const entry = resolveKey(key);
      if (entry) previewEntries.push({ type: entry.type, item: entry.item, key: entry.key });
    });
  } else if (interaction.mirrorDraft) {
    getTransformableSelectionKeys().forEach((key) => {
      const entry = resolveKey(key);
      if (entry) previewEntries.push({ type: entry.type, item: entry.item, key: entry.key });
    });
  }
  if (mirrorState.liveEnabled && interaction.buildGhost) previewEntries.push({ type: "tower", item: interaction.buildGhost });
  if (mirrorState.liveEnabled && interaction.placementGhost) previewEntries.push({ type: interaction.placementGhost.type, item: interaction.placementGhost });
  if (mirrorState.liveEnabled && interaction.pasteDraft) {
    const entities = getPasteDraftEntities(interaction.pasteDraft);
    entities.towers.forEach((item) => previewEntries.push({ type: "tower", item }));
    entities.spawns.forEach((item) => previewEntries.push({ type: "spawn", item }));
    entities.bombs.forEach((item) => previewEntries.push({ type: "bomb", item }));
    entities.structures.forEach((item) => previewEntries.push({ type: "structure", item }));
    entities.boundaries.forEach((item) => previewEntries.push({ type: "boundary", item }));
  }
  ctx.save();
  ctx.globalAlpha = 0.48;
  if (mirrorState.liveEnabled) drawMirroredHoleDraftPreview(previewAxes);
  if (mirrorState.liveEnabled && interaction.pasteDraft) {
    const entities = getPasteDraftEntities(interaction.pasteDraft);
    entities.holes.forEach((hole) => {
      getMirrorTransformVariants(previewAxes).forEach((variant) => {
        const points = hole.points.map((point) => transformPointByAxes(point, variant.axes));
        if (!points.length) return;
        ctx.beginPath();
        points.forEach((point, index) => {
          const screen = worldToScreen(point.x, point.y);
          if (index === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        if (points.length >= 3) ctx.closePath();
        ctx.fillStyle = COLORS.boundaryFog;
        ctx.strokeStyle = withAlpha(COLORS.guide, 0.9);
        ctx.lineWidth = 3 * view.scale;
        if (points.length >= 3) ctx.fill();
        ctx.stroke();
      });
    });
  }
  previewEntries.forEach((entry) => {
    getMirroredPointVariants(entry.item, previewAxes).forEach((variant) => {
      if (activeLiveMirrorPreviewModel?.previewSkip.has(`${entry.key}|${variant.key}`)) return;
      drawMirrorPreviewEntity(entry.type, entry.item, variant.point);
    });
  });
  if (activeTransform) {
    const sourceWallUids = activeLiveMirrorPreviewModel?.sourceWallUids || new Set();
    state.walls.forEach((wall) => {
      if (!sourceWallUids.has(wall.uid)) return;
      const a = getTowerById(wall.t1);
      const b = getTowerById(wall.t2);
      if (!a || !b) return;
      getMirrorTransformVariants(previewAxes).forEach((variant) => {
        if (activeLiveMirrorPreviewModel?.wallPreviewSkip.has(`${wall.uid}|${variant.key}`)) return;
        const mirrorA = transformPointByAxes(a, variant.axes);
        const mirrorB = transformPointByAxes(b, variant.axes);
        const ma = worldToScreen(mirrorA.x, mirrorA.y);
        const mb = worldToScreen(mirrorB.x, mirrorB.y);
        ctx.lineWidth = GAME.WALL_THICKNESS * view.scale;
        ctx.strokeStyle = withAlpha(getTeamColor(wall.team_id), 0.7);
        ctx.beginPath();
        ctx.moveTo(ma.x, ma.y);
        ctx.lineTo(mb.x, mb.y);
        ctx.stroke();
      });
    });
  }
  if (mirrorState.liveEnabled && interaction.buildGhost) {
    const startTower = getAutoWallStartTower();
    if (startTower) {
      getMirrorTransformVariants(previewAxes).forEach((variant) => {
        const mirrorStart = transformPointByAxes(startTower, variant.axes);
        const mirrorEnd = transformPointByAxes(interaction.buildGhost, variant.axes);
        const start = worldToScreen(mirrorStart.x, mirrorStart.y);
        const end = worldToScreen(mirrorEnd.x, mirrorEnd.y);
        ctx.lineCap = "round";
        ctx.lineWidth = GAME.WALL_THICKNESS * view.scale;
        ctx.strokeStyle = withAlpha(getTeamColor(startTower.team_id), 0.72);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      });
    }
  }
  ctx.restore();
}

function drawMirroredHoleDraftPreview(previewAxes) {
  getMirroredHoleDraftPolygons(previewAxes).forEach(({ points, closing, invalid }) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (closing && points.length >= 3) ctx.closePath();
    ctx.lineWidth = 3 * view.scale;
    ctx.strokeStyle = invalid ? COLORS.danger : withAlpha(COLORS.guide, 0.9);
    if (closing && points.length >= 3) {
      ctx.fillStyle = COLORS.boundaryFog;
      ctx.fill();
    }
    ctx.stroke();
    points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, index === 0 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(COLORS.guide, 0.95);
      ctx.fill();
    });
  });
}

function getMirroredHoleDraftPolygons(previewAxes = mirrorState.axes) {
  const draftPoints = interaction.holeDraft?.points || [];
  const ghost = interaction.placementGhost?.type === "hole" ? interaction.placementGhost : null;
  if (!draftPoints.length && !ghost) return [];
  const sourcePoints = [...draftPoints];
  if (ghost && !ghost.closing) sourcePoints.push({ x: ghost.x, y: ghost.y });
  if (!sourcePoints.length) return [];
  return getMirrorTransformVariants(previewAxes).map((variant) => ({
    key: variant.key,
    points: sourcePoints.map((point) => transformPointByAxes(point, variant.axes)),
    closing: Boolean(ghost?.closing),
    invalid: Boolean(ghost?.invalid),
  }));
}

function buildActiveLiveMirrorPreviewModel() {
  const activeTransform = interaction.drag || interaction.rotate || interaction.resize;
  if (!mirrorState.liveEnabled || !mirrorState.axes.length || !activeTransform?.beforeState) return null;
  const beforeState = activeTransform.beforeState;
  const activeKeys = new Set(activeTransform.keys || []);
  const model = {
    activeKeys,
    sourceWallUids: new Set(),
    suppressedKeys: new Set(),
    suppressedWallUids: new Set(),
    previewSkip: new Set(),
    wallPreviewSkip: new Set(),
  };
  const variants = getMirrorTransformVariants();
  const configs = [
    { type: "tower", key: "towers" },
    { type: "spawn", key: "spawn_points" },
    { type: "bomb", key: "bomb_sites" },
    { type: "structure", key: "structures" },
    { type: "boundary", key: "map_boundaries" },
  ];
  configs.forEach((config) => {
    const beforeItems = beforeState[config.key] || [];
    activeKeys.forEach((activeKey) => {
      const [type, uid] = String(activeKey).split(":");
      if (type !== config.type) return;
      const previous = beforeItems.find((item) => item.uid === uid);
      if (!previous) return;
      variants.forEach((variant) => {
        const oldPoint = transformPointByAxes(previous, variant.axes);
        const counterpart = findPositionMatch(beforeItems, oldPoint, previous.uid);
        if (!counterpart) return;
        const counterpartKey = makeKey(config.type, counterpart.uid);
        if (activeKeys.has(counterpartKey)) model.previewSkip.add(`${activeKey}|${variant.key}`);
        else model.suppressedKeys.add(counterpartKey);
      });
    });
  });

  const activeTowerIds = new Set(beforeState.towers
    .filter((tower) => activeKeys.has(makeKey("tower", tower.uid)))
    .map((tower) => tower.id));
  const selectedWallUids = new Set(getSelectionEntries().filter((entry) => entry.type === "wall").map((entry) => entry.item.uid));
  beforeState.walls.forEach((wall) => {
    if ((activeTowerIds.has(wall.t1) && activeTowerIds.has(wall.t2)) || selectedWallUids.has(wall.uid)) {
      model.sourceWallUids.add(wall.uid);
    }
  });
  model.sourceWallUids.forEach((uid) => {
    const wall = beforeState.walls.find((item) => item.uid === uid);
    if (!wall) return;
    variants.forEach((variant) => {
      const counterpart = findMirroredWall(beforeState, wall, variant.axes, beforeState);
      if (!counterpart || counterpart.uid === wall.uid) return;
      if (model.sourceWallUids.has(counterpart.uid)) model.wallPreviewSkip.add(`${uid}|${variant.key}`);
      else model.suppressedWallUids.add(counterpart.uid);
    });
  });
  return model;
}

function isSuppressedLiveMirrorItem(type, uid) {
  return Boolean(activeLiveMirrorPreviewModel?.suppressedKeys.has(makeKey(type, uid)));
}

function drawMirrorPreviewEntity(type, item, point) {
  const p = worldToScreen(point.x, point.y);
  ctx.strokeStyle = withAlpha(COLORS.guide, 0.95);
  ctx.fillStyle = withAlpha(getTeamColor(item.team_id), 0.5);
  ctx.lineWidth = 2;
  if (type === "tower") {
    ctx.beginPath();
    ctx.arc(p.x, p.y, (GAME.TOWER_DIAMETER / 2) * view.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (type === "spawn") {
    const size = (Number(state.spawn_protection_size) || 500) * view.scale;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (type === "bomb") {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 250 * view.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (type === "structure") {
    const size = (Number(item.size) || 130) * view.scale;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (type === "boundary") {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function applySelectedMapPreset() {
  const preset = el.mapPresetSelect.value;
  let width = clamp(500, Number(el.mapPresetWidth.value) || 4000, 50000);
  let height = clamp(500, Number(el.mapPresetHeight.value) || 4000, 50000);
  if (preset === "square") height = width;
  if (preset === "wide" && Math.abs(width - height) < 0.001) height = width * 0.625;
  el.mapPresetWidth.value = String(roundTo(width, 1));
  el.mapPresetHeight.value = String(roundTo(height, 1));
  const points = getMapPresetPoints(preset, width, height);
  if (!points.length) return;
  const hasPlacedContent = state.map_holes.length || state.towers.length || state.walls.length || state.spawn_points.length || state.bomb_sites.length || state.structures.length;
  if (hasPlacedContent && !confirm("Replace the current boundary with this preset? Existing objects will be kept.")) return;
  withAction("APPLY_MAP_PRESET", () => {
    state.map_boundaries = points.map((point) => ({ uid: createUid("boundary"), x: roundTo(point.x, 3), y: roundTo(point.y, 3) }));
    selection.clear();
    return true;
  });
  fitBoundaryInView();
  setActionState(`${preset === "circle" ? "Round arena" : preset[0].toUpperCase() + preset.slice(1)} boundary applied`, "success", true);
}

function getMapPresetPoints(preset, width, height) {
  const halfW = width / 2;
  const halfH = height / 2;
  if (preset === "diamond") return [{ x: 0, y: -halfH }, { x: halfW, y: 0 }, { x: 0, y: halfH }, { x: -halfW, y: 0 }];
  if (preset === "octagon") {
    const inset = 0.292893;
    return [
      { x: -halfW * (1 - inset), y: -halfH }, { x: halfW * (1 - inset), y: -halfH },
      { x: halfW, y: -halfH * (1 - inset) }, { x: halfW, y: halfH * (1 - inset) },
      { x: halfW * (1 - inset), y: halfH }, { x: -halfW * (1 - inset), y: halfH },
      { x: -halfW, y: halfH * (1 - inset) }, { x: -halfW, y: -halfH * (1 - inset) },
    ];
  }
  if (preset === "circle") {
    return Array.from({ length: 16 }, (_, index) => {
      const angle = -Math.PI / 2 + (index / 16) * Math.PI * 2;
      return { x: Math.cos(angle) * halfW, y: Math.sin(angle) * halfH };
    });
  }
  return [{ x: -halfW, y: -halfH }, { x: halfW, y: -halfH }, { x: halfW, y: halfH }, { x: -halfW, y: halfH }];
}

function fitBoundaryInView() {
  if (!state.map_boundaries.length) return;
  const xs = state.map_boundaries.map((point) => point.x);
  const ys = state.map_boundaries.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  view.scale = clamp(GAME.MIN_ZOOM, Math.min((viewport.width - 100) / width, (viewport.height - 100) / height), GAME.MAX_ZOOM);
  view.offsetX = viewport.width / 2 - ((minX + maxX) / 2) * view.scale;
  view.offsetY = viewport.height / 2 - ((minY + maxY) / 2) * view.scale;
  requestRender();
}

function getMapCenterOffset(mapState) {
  if (!mapState.map_boundaries.length) return null;
  const xs = mapState.map_boundaries.map((point) => point.x);
  const ys = mapState.map_boundaries.map((point) => point.y);
  const offsetX = -((Math.min(...xs) + Math.max(...xs)) / 2);
  const offsetY = -((Math.min(...ys) + Math.max(...ys)) / 2);
  return { offsetX, offsetY };
}

function centerMapStateOnOrigin(mapState) {
  const offset = getMapCenterOffset(mapState);
  if (!offset) return { changed: false, offsetX: 0, offsetY: 0 };
  const { offsetX, offsetY } = offset;
  if (Math.abs(offsetX) <= 0.001 && Math.abs(offsetY) <= 0.001) {
    return { changed: false, offsetX, offsetY };
  }
  const translate = (item) => {
    item.x = roundTo(item.x + offsetX, 3);
    item.y = roundTo(item.y + offsetY, 3);
  };
  mapState.map_boundaries.forEach(translate);
  mapState.map_holes.forEach((hole) => hole.points.forEach(translate));
  mapState.spawn_points.forEach(translate);
  mapState.bomb_sites.forEach(translate);
  mapState.towers.forEach(translate);
  mapState.structures.forEach(translate);
  return { changed: true, offsetX, offsetY };
}

function centerMapOnOrigin() {
  const offset = getMapCenterOffset(state);
  if (!offset) {
    setActionState("Add a map boundary before centering the map", "warn", true);
    return false;
  }
  const { offsetX, offsetY } = offset;
  if (Math.abs(offsetX) <= 0.001 && Math.abs(offsetY) <= 0.001) {
    fitBoundaryInView();
    saveSession();
    setActionState("Map is already centered on 0,0", "idle", true);
    return false;
  }
  const changed = withAction("CENTER_MAP_ON_ORIGIN", () => {
    return centerMapStateOnOrigin(state).changed;
  });
  fitBoundaryInView();
  restoredViewFromSession = true;
  saveSession();
  setActionState(`Map centered on 0,0 (shifted ${roundTo(offsetX, 1)}, ${roundTo(offsetY, 1)})`, "success", true);
  return changed;
}

function finishMirrorAxis() {
  const draft = interaction.mirrorDraft;
  interaction.mirrorDraft = null;
  if (!draft || distance(draft.start.x, draft.start.y, draft.end.x, draft.end.y) < 20 / Math.max(view.scale, 0.001)) {
    setActionState("Mirror axis was too short", "warn", true);
    requestRender();
    return;
  }
  const beforeAxes = cloneState(mirrorState.axes);
  mirrorState.axes.push({
    type: draft.type === "rotate" ? "rotate" : "reflect",
    a: { x: roundTo(draft.start.x, 3), y: roundTo(draft.start.y, 3) },
    b: { x: roundTo(draft.end.x, 3), y: roundTo(draft.end.y, 3) },
  });
  if (mirrorState.axes.length > 8) mirrorState.axes.shift();
  pushMirrorAxesHistory("ADD_MIRROR_AXIS", beforeAxes, cloneState(mirrorState.axes));
  saveSession();
  updateMirrorStatus();
  setActionState(`${draft.type === "rotate" ? "Rotational centre" : "Mirror axis"} added`, "success", true);
  requestRender();
}

function updateMirrorStatus() {
  if (!el.mirrorStatus) return;
  const count = mirrorState.axes.length;
  if (!count) {
    el.mirrorStatus.textContent = "No mirror axes. Choose Draw Mirror Axis, then drag a line.";
  } else {
    el.mirrorStatus.textContent = `${count} active ${count === 1 ? "axis" : "axes"}. ${mirrorState.liveEnabled ? "Live mirroring is on." : "Use Mirror Selection Once or enable live mode."}`;
  }
  el.applyMirrorSelectionBtn.disabled = count === 0;
  el.removeLastMirrorBtn.disabled = count === 0;
  el.clearMirrorAxesBtn.disabled = count === 0;
}

function isUsableMirrorAxis(axis) {
  return Boolean(axis && (axis.type === "reflect" || axis.type === "rotate")
    && Number.isFinite(axis.a?.x) && Number.isFinite(axis.a?.y)
    && Number.isFinite(axis.b?.x) && Number.isFinite(axis.b?.y)
    && distance(axis.a.x, axis.a.y, axis.b.x, axis.b.y) > 0.001);
}

function transformPointByAxis(point, axis) {
  if (axis.type === "rotate") {
    const cx = (axis.a.x + axis.b.x) / 2;
    const cy = (axis.a.y + axis.b.y) / 2;
    return { x: cx * 2 - point.x, y: cy * 2 - point.y };
  }
  const dx = axis.b.x - axis.a.x;
  const dy = axis.b.y - axis.a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) return { ...point };
  const t = ((point.x - axis.a.x) * dx + (point.y - axis.a.y) * dy) / lengthSq;
  const px = axis.a.x + t * dx;
  const py = axis.a.y + t * dy;
  return { x: px * 2 - point.x, y: py * 2 - point.y };
}

function transformPointByAxes(point, axes) {
  return axes.reduce((current, axis) => transformPointByAxis(current, axis), { x: point.x, y: point.y });
}

function getMirrorTransformVariants(sourceAxes = mirrorState.axes) {
  let variants = [{ axes: [], key: "identity" }];
  sourceAxes.filter(isUsableMirrorAxis).forEach((axis, index) => {
    variants = variants.concat(variants.map((variant) => ({ axes: [...variant.axes, axis], key: `${variant.key}:${index}` })));
  });
  return variants.filter((variant) => variant.axes.length > 0);
}

function getMirroredPointVariants(point, sourceAxes = mirrorState.axes) {
  const seen = new Set();
  const out = [];
  getMirrorTransformVariants(sourceAxes).forEach((variant) => {
    const transformed = transformPointByAxes(point, variant.axes);
    const key = `${roundTo(transformed.x, 3)}:${roundTo(transformed.y, 3)}`;
    if (seen.has(key) || distance(point.x, point.y, transformed.x, transformed.y) <= 0.001) return;
    seen.add(key);
    out.push({ ...variant, point: transformed });
  });
  return out;
}

function mirrorSelectionOnce() {
  if (!mirrorState.axes.length) {
    setActionState("Draw at least one mirror axis first", "warn", true);
    return;
  }
  const entries = getSelectionEntries();
  if (!entries.length) {
    setActionState("Select objects to mirror", "warn", true);
    return;
  }
  const sourceTowerIds = new Set(entries.filter((entry) => entry.type === "tower").map((entry) => entry.item.id));
  entries.filter((entry) => entry.type === "wall").forEach((entry) => {
    sourceTowerIds.add(entry.item.t1);
    sourceTowerIds.add(entry.item.t2);
  });
  const sourceTowers = state.towers.filter((tower) => sourceTowerIds.has(tower.id));
  const sourceWalls = state.walls.filter((wall) => sourceTowerIds.has(wall.t1) && sourceTowerIds.has(wall.t2));
  const sourceSpawns = entries.filter((entry) => entry.type === "spawn").map((entry) => entry.item);
  const sourceBombs = entries.filter((entry) => entry.type === "bomb").map((entry) => entry.item);
  const sourceStructures = entries.filter((entry) => entry.type === "structure").map((entry) => entry.item);
  const sourceBoundaries = entries.filter((entry) => entry.type === "boundary").map((entry) => entry.item);
  const sourceHoleUids = new Set();
  entries.forEach((entry) => {
    if (entry.type === "hole") sourceHoleUids.add(entry.item.uid);
    if (entry.type === "holeVertex") sourceHoleUids.add(entry.hole.uid);
  });
  const sourceHoles = state.map_holes.filter((hole) => sourceHoleUids.has(hole.uid));
  const variants = getMirrorTransformVariants();
  const createdKeys = [];

  const changed = withAction("MIRROR_SELECTION", () => {
    variants.forEach((variant) => {
      const towerIdMap = new Map();
      sourceTowers.forEach((tower) => {
        const point = transformPointByAxes(tower, variant.axes);
        if (distance(tower.x, tower.y, point.x, point.y) <= 0.001) {
          towerIdMap.set(tower.id, tower.id);
          return;
        }
        const existing = findPositionMatch(state.towers, point, tower.uid);
        if (existing) {
          towerIdMap.set(tower.id, existing.id);
          return;
        }
        const clone = { ...cloneState(tower), uid: createUid("tower"), id: nextTowerId(), x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
        state.towers.push(clone);
        towerIdMap.set(tower.id, clone.id);
        createdKeys.push(makeKey("tower", clone.uid));
      });
      sourceWalls.forEach((wall) => {
        const t1 = towerIdMap.get(wall.t1);
        const t2 = towerIdMap.get(wall.t2);
        if (!t1 || !t2 || hasDuplicateWall(t1, t2)) return;
        const clone = { ...cloneState(wall), uid: createUid("wall"), id: nextWallLocalId(), t1, t2 };
        state.walls.push(clone);
        createdKeys.push(makeKey("wall", clone.uid));
      });
      sourceSpawns.forEach((spawn) => {
        const point = transformPointByAxes(spawn, variant.axes);
        if (distance(spawn.x, spawn.y, point.x, point.y) <= 0.001) return;
        const teamId = spawn.team_id === 0 ? 1 : spawn.team_id === 1 ? 0 : spawn.team_id;
        const existing = state.spawn_points.find((item) => item.team_id === teamId);
        if (existing) {
          existing.x = roundTo(point.x, 3);
          existing.y = roundTo(point.y, 3);
          createdKeys.push(makeKey("spawn", existing.uid));
          return;
        }
        const clone = { ...cloneState(spawn), uid: createUid("spawn"), team_id: teamId, x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
        state.spawn_points.push(clone);
        createdKeys.push(makeKey("spawn", clone.uid));
      });
      sourceBombs.forEach((bomb) => {
        const point = transformPointByAxes(bomb, variant.axes);
        if (distance(bomb.x, bomb.y, point.x, point.y) <= 0.001 || findPositionMatch(state.bomb_sites, point, bomb.uid)) return;
        const clone = { ...cloneState(bomb), uid: createUid("bomb"), site_letter: nextBombSiteLetter(), x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
        state.bomb_sites.push(clone);
        createdKeys.push(makeKey("bomb", clone.uid));
      });
      sourceStructures.forEach((structure) => {
        const point = transformPointByAxes(structure, variant.axes);
        if (distance(structure.x, structure.y, point.x, point.y) <= 0.001 || findPositionMatch(state.structures, point, structure.uid)) return;
        const clone = { ...cloneState(structure), uid: createUid("structure"), id: nextStructureId(), x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
        state.structures.push(clone);
        createdKeys.push(makeKey("structure", clone.uid));
      });
      sourceHoles.forEach((hole) => {
        const points = hole.points.map((point) => transformPointByAxes(point, variant.axes));
        if (findMatchingHole(state.map_holes, points)) return;
        const clone = {
          uid: createUid("hole"),
          points: points.map((point) => ({ uid: createUid("hole_vertex"), x: roundTo(point.x, 3), y: roundTo(point.y, 3) })),
        };
        state.map_holes.push(clone);
        createdKeys.push(makeKey("hole", clone.uid));
      });
      [...sourceBoundaries].reverse().forEach((boundary) => {
        const point = transformPointByAxes(boundary, variant.axes);
        if (distance(boundary.x, boundary.y, point.x, point.y) <= 0.001 || findPositionMatch(state.map_boundaries, point, boundary.uid)) return;
        const clone = { uid: createUid("boundary"), x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
        state.map_boundaries.push(clone);
        createdKeys.push(makeKey("boundary", clone.uid));
      });
    });
    if (!createdKeys.length) return false;
    selection.clear();
    createdKeys.forEach((key) => selection.add(key));
    return true;
  });
  if (!changed) {
    setActionState("Selection lies on the axis or already has mirrored copies", "idle", true);
    return;
  }
  renderSelectionPanel();
  setActionState(`Created ${createdKeys.length} mirrored item${createdKeys.length === 1 ? "" : "s"}`, "success", true);
}

function applyLiveMirroring(beforeState) {
  if (!mirrorState.liveEnabled || mirrorState.applying || !mirrorState.axes.length) return;
  mirrorState.applying = true;
  try {
    const variants = getMirrorTransformVariants();
    const configs = [
      { type: "tower", key: "towers" },
      { type: "spawn", key: "spawn_points" },
      { type: "bomb", key: "bomb_sites" },
      { type: "structure", key: "structures" },
      { type: "boundary", key: "map_boundaries" },
    ];
    configs.forEach((config) => {
      const beforeItems = beforeState[config.key] || [];
      const currentItems = state[config.key] || [];
      const beforeByUid = mapItemsByUid(beforeItems);
      const currentByUid = mapItemsByUid(currentItems);
      const changedUids = new Set();
      currentItems.forEach((item) => {
        const previous = beforeByUid.get(item.uid);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) changedUids.add(item.uid);
      });
      beforeItems.forEach((item) => { if (!currentByUid.has(item.uid)) changedUids.add(item.uid); });

      beforeItems.forEach((previous) => {
        const current = currentByUid.get(previous.uid);
        if (current) return;
        variants.forEach((variant) => {
          const oldPoint = transformPointByAxes(previous, variant.axes);
          const counterpart = findPositionMatch(beforeItems, oldPoint, previous.uid);
          if (counterpart) removeMirroredItem(config.type, counterpart.uid);
        });
      });

      currentItems.slice().forEach((current) => {
        const previous = beforeByUid.get(current.uid);
        if (!previous) {
          getMirroredPointVariants(current).forEach((variant) => createMirroredPositionItem(config.type, current, variant.point, config.type === "boundary"));
          return;
        }
        if (JSON.stringify(previous) === JSON.stringify(current)) return;
        variants.forEach((variant) => {
          const oldPoint = transformPointByAxes(previous, variant.axes);
          const newPoint = transformPointByAxes(current, variant.axes);
          const counterpartBefore = findPositionMatch(beforeItems, oldPoint, previous.uid);
          if (counterpartBefore && changedUids.has(counterpartBefore.uid)) return;
          const counterpart = counterpartBefore ? mapItemsByUid(state[config.key]).get(counterpartBefore.uid) : null;
          if (counterpart) updateMirroredPositionItem(config.type, counterpart, current, newPoint);
          else createMirroredPositionItem(config.type, current, newPoint, config.type === "boundary");
        });
      });
    });
    mirrorLiveHoles(beforeState, variants);
    mirrorLiveWalls(beforeState, variants);
  } finally {
    mirrorState.applying = false;
  }
}

function createMirroredPositionItem(type, source, point, prepend = false) {
  const keyByType = { tower: "towers", spawn: "spawn_points", bomb: "bomb_sites", structure: "structures", boundary: "map_boundaries" };
  const list = state[keyByType[type]];
  if (!list || distance(source.x, source.y, point.x, point.y) <= 0.001 || findPositionMatch(list, point, source.uid)) return null;
  const clone = { ...cloneState(source), uid: createUid(type), x: roundTo(point.x, 3), y: roundTo(point.y, 3) };
  if (type === "tower") clone.id = nextTowerId();
  if (type === "structure") clone.id = nextStructureId();
  if (type === "spawn" && (source.team_id === 0 || source.team_id === 1)) {
    clone.team_id = source.team_id === 0 ? 1 : 0;
    const existing = state.spawn_points.find((item) => item.team_id === clone.team_id);
    if (existing) {
      updateMirroredPositionItem(type, existing, source, point);
      return existing;
    }
  }
  if (type === "bomb") clone.site_letter = nextBombSiteLetter();
  if (prepend) list.unshift(clone);
  else list.push(clone);
  return clone;
}

function updateMirroredPositionItem(type, target, source, point) {
  target.x = roundTo(point.x, 3);
  target.y = roundTo(point.y, 3);
  if (type === "tower") {
    target.team_id = source.team_id;
    target.health = source.health;
    target.is_invincible = source.is_invincible;
  } else if (type === "spawn") {
    target.team_id = source.team_id === 0 ? 1 : source.team_id === 1 ? 0 : source.team_id;
  } else if (type === "bomb") {
    // Preserve the mirrored site's own letter while following position edits.
  } else if (type === "structure") {
    target.size = source.size;
    target.label = source.label;
    target.color = source.color;
    target.team_id = source.team_id;
  }
}

function removeMirroredItem(type, uid) {
  if (type === "tower") {
    const tower = state.towers.find((item) => item.uid === uid);
    if (!tower) return;
    state.towers = state.towers.filter((item) => item.uid !== uid);
    state.walls = state.walls.filter((wall) => wall.t1 !== tower.id && wall.t2 !== tower.id);
    return;
  }
  const keyByType = { spawn: "spawn_points", bomb: "bomb_sites", structure: "structures", boundary: "map_boundaries" };
  const key = keyByType[type];
  if (key) state[key] = state[key].filter((item) => item.uid !== uid);
}

function findPositionMatch(items, point, excludeUid = "") {
  let best = null;
  items.forEach((item) => {
    if (!item || item.uid === excludeUid || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return;
    const delta = distance(item.x, item.y, point.x, point.y);
    if (delta <= 1 && (!best || delta < best.delta)) best = { item, delta };
  });
  return best ? best.item : null;
}

function mirrorLiveWalls(beforeState, variants) {
  const beforeWalls = beforeState.walls || [];
  const beforeByUid = mapItemsByUid(beforeWalls);
  const currentByUid = mapItemsByUid(state.walls);
  const beforeTowersByUid = mapItemsByUid(beforeState.towers || []);
  const changedTowerIds = new Set();
  state.towers.forEach((tower) => {
    const previous = beforeTowersByUid.get(tower.uid);
    if (!previous || previous.x !== tower.x || previous.y !== tower.y) changedTowerIds.add(tower.id);
  });
  beforeWalls.forEach((wall) => {
    if (currentByUid.has(wall.uid)) return;
    variants.forEach((variant) => {
      const counterpart = findMirroredWall(beforeState, wall, variant.axes, beforeState);
      if (counterpart) state.walls = state.walls.filter((item) => item.uid !== counterpart.uid);
    });
  });
  state.walls.filter((wall) => changedTowerIds.has(wall.t1) || changedTowerIds.has(wall.t2)).forEach((wall) => {
    const previous = beforeByUid.get(wall.uid);
    if (!previous) {
      variants.forEach((variant) => createMirroredWall(wall, variant.axes));
      return;
    }
    if (previous.team_id === wall.team_id) return;
    variants.forEach((variant) => {
      const counterpart = findMirroredWall(beforeState, previous, variant.axes, state);
      if (counterpart) counterpart.team_id = wall.team_id;
    });
  });
  // Moving an existing connected group changes its tower endpoints but not the
  // wall record itself. Reconcile every wall after towers have been mirrored so
  // a previously missing counterpart wall is created between the new towers.
  state.walls.slice().forEach((wall) => {
    variants.forEach((variant) => {
      if (!findMirroredWall(state, wall, variant.axes, state)) createMirroredWall(wall, variant.axes);
    });
  });
}

function findMirroredWall(sourceState, wall, axes, targetState = state) {
  const a = getTowerByIdFrom(sourceState, wall.t1);
  const b = getTowerByIdFrom(sourceState, wall.t2);
  if (!a || !b) return null;
  const ma = transformPointByAxes(a, axes);
  const mb = transformPointByAxes(b, axes);
  const ta = findPositionMatch(targetState.towers, ma);
  const tb = findPositionMatch(targetState.towers, mb);
  if (!ta || !tb) return null;
  return targetState.walls.find((item) => (item.t1 === ta.id && item.t2 === tb.id) || (item.t1 === tb.id && item.t2 === ta.id)) || null;
}

function createMirroredWall(sourceWall, axes) {
  const a = getTowerById(sourceWall.t1);
  const b = getTowerById(sourceWall.t2);
  if (!a || !b) return null;
  const ma = transformPointByAxes(a, axes);
  const mb = transformPointByAxes(b, axes);
  const ta = findPositionMatch(state.towers, ma);
  const tb = findPositionMatch(state.towers, mb);
  if (!ta || !tb || ta.id === tb.id || hasDuplicateWall(ta.id, tb.id)) return null;
  const clone = { uid: createUid("wall"), id: nextWallLocalId(), t1: ta.id, t2: tb.id, team_id: sourceWall.team_id };
  state.walls.push(clone);
  return clone;
}

function startResize(keysToResize, world, handle = null) {
  const startPositions = new Map();
  const startSizes = new Map();
  keysToResize.forEach((key) => {
    const p = getKeyPosition(key);
    if (p) startPositions.set(key, p);
    const entry = resolveKey(key);
    if (entry?.type === "structure") startSizes.set(key, Number(entry.item.size) || 20);
  });
  if (!startPositions.size) return;
  const center = getPositionMapCenter(startPositions);
  const xs = Array.from(startPositions.values()).map((point) => point.x);
  const ys = Array.from(startPositions.values()).map((point) => point.y);
  const positionBounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  if (positionBounds.maxX - positionBounds.minX < 0.001) {
    positionBounds.minX = center.x - 20;
    positionBounds.maxX = center.x + 20;
  }
  if (positionBounds.maxY - positionBounds.minY < 0.001) {
    positionBounds.minY = center.y - 20;
    positionBounds.maxY = center.y + 20;
  }
  const usesX = Boolean(handle && /[ew]/.test(handle));
  const usesY = Boolean(handle && /[ns]/.test(handle));
  const origin = {
    x: handle?.includes("w") ? positionBounds.maxX : handle?.includes("e") ? positionBounds.minX : center.x,
    y: handle?.includes("n") ? positionBounds.maxY : handle?.includes("s") ? positionBounds.minY : center.y,
  };
  const startHandle = {
    x: handle?.includes("w") ? positionBounds.minX : handle?.includes("e") ? positionBounds.maxX : center.x,
    y: handle?.includes("n") ? positionBounds.minY : handle?.includes("s") ? positionBounds.maxY : center.y,
  };
  const referenceRadius = Math.max(
    40,
    ...Array.from(startPositions.values()).map((point) => distance(point.x, point.y, center.x, center.y)),
    ...Array.from(startSizes.values()).map((size) => size / 2),
  );
  interaction.resize = {
    keys: Array.from(startPositions.keys()),
    keySet: new Set(startPositions.keys()),
    center,
    handle,
    usesX,
    usesY,
    origin,
    startHandle,
    startDistance: distance(world.x, world.y, center.x, center.y),
    referenceRadius,
    startPositions,
    startSizes,
    beforeState: cloneState(state),
    scale: 1,
    moved: false,
    invalidReason: "",
  };
  setActionState("Resizing selection", "idle");
}

function applyResize(world) {
  const resize = interaction.resize;
  if (!resize) return;
  let scaleX;
  let scaleY;
  if (resize.handle) {
    let handleX = world.x;
    let handleY = world.y;
    if (editorSettings.gridSnapEnabled && !interaction.snapTemporarilyDisabled) {
      const grid = Math.max(4, Number(editorSettings.gridSize) || 48);
      if (resize.usesX) handleX = Math.round(handleX / grid) * grid;
      if (resize.usesY) handleY = Math.round(handleY / grid) * grid;
    }
    scaleX = resize.usesX
      ? clamp(0.1, (handleX - resize.origin.x) / (resize.startHandle.x - resize.origin.x), 10)
      : 1;
    scaleY = resize.usesY
      ? clamp(0.1, (handleY - resize.origin.y) / (resize.startHandle.y - resize.origin.y), 10)
      : 1;
  } else {
    const currentDistance = distance(world.x, world.y, resize.center.x, resize.center.y);
    let scale = clamp(0.1, 1 + ((currentDistance - resize.startDistance) / resize.referenceRadius), 10);
    if (editorSettings.gridSnapEnabled && !interaction.snapTemporarilyDisabled) scale = roundTo(scale, 2);
    scaleX = scale;
    scaleY = scale;
  }
  const sizeScale = Math.sqrt(scaleX * scaleY);
  const nextPositions = new Map();
  resize.startPositions.forEach((pos, key) => {
    nextPositions.set(key, {
      x: roundTo(resize.origin.x + (pos.x - resize.origin.x) * scaleX, 3),
      y: roundTo(resize.origin.y + (pos.y - resize.origin.y) * scaleY, 3),
    });
  });

  let invalidReason = "";
  for (const [key, pos] of nextPositions) {
    const entry = resolveKey(key);
    if (!entry || entry.type === "boundary") continue;
    const item = entry.type === "structure"
      ? { ...entry.item, size: Math.max(20, Math.round((resize.startSizes.get(key) || entry.item.size) * sizeScale)) }
      : entry.item;
    if (!isPlacementInsideBoundary(entry.type, pos.x, pos.y, item)) {
      invalidReason = "Selection is outside map boundary.";
      break;
    }
  }
  const movedTowerTargets = getTowerTargetsFromPositionMap(nextPositions);
  if (!invalidReason && movedTowerTargets.size > 0 && hasTowerOverlapConflict(movedTowerTargets)) invalidReason = "A tower overlaps another tower.";
  if (!invalidReason && movedTowerTargets.size > 0 && hasTowerOnWallConflict(movedTowerTargets)) invalidReason = "A tower overlaps an existing wall.";
  if (!invalidReason && movedTowerTargets.size > 0 && findWallOverlap(movedTowerTargets)) invalidReason = "Walls overlap or intersect.";

  nextPositions.forEach((pos, key) => setKeyPosition(key, pos.x, pos.y));
  resize.startSizes.forEach((size, key) => {
    const entry = resolveKey(key);
    if (entry?.type === "structure") entry.item.size = Math.max(20, Math.round(size * sizeScale));
  });
  resize.scale = sizeScale;
  resize.scaleX = scaleX;
  resize.scaleY = scaleY;
  resize.moved = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
  resize.invalidReason = invalidReason;
  updateLiveSelectionCoordinates();
  setActionState(invalidReason || `Selection scale: ${roundTo(scaleX * 100, 1)}% x ${roundTo(scaleY * 100, 1)}%`, invalidReason ? "warn" : "idle");
}

function finishResize() {
  const resize = interaction.resize;
  interaction.resize = null;
  if (!resize || !resize.moved) return;
  applyLiveMirroring(resize.beforeState);
  pushHistory("RESIZE_MULTI", resize.beforeState, cloneState(state));
  onStateChanged();
  if (resize.invalidReason) setActionState(`${resize.invalidReason} Export validation may fail.`, "warn");
  else setActionState(`Selection resized to ${roundTo((resize.scaleX ?? resize.scale) * 100, 1)}% x ${roundTo((resize.scaleY ?? resize.scale) * 100, 1)}%`, "success", true);
}

function findMatchingHole(holes, points, excludeUid = null) {
  return (holes || []).find((hole) => hole.uid !== excludeUid
    && hole.points.length === points.length
    && points.every((point) => hole.points.some((candidate) => distance(point.x, point.y, candidate.x, candidate.y) <= 0.01))) || null;
}

function createMirroredHole(source, axes) {
  const points = source.points.map((point) => transformPointByAxes(point, axes));
  if (findMatchingHole(state.map_holes, points)) return null;
  const clone = {
    uid: createUid("hole"),
    points: points.map((point) => ({ uid: createUid("hole_vertex"), x: roundTo(point.x, 3), y: roundTo(point.y, 3) })),
  };
  state.map_holes.push(clone);
  return clone;
}

function mirrorLiveHoles(beforeState, variants) {
  const beforeHoles = beforeState.map_holes || [];
  const beforeByUid = mapItemsByUid(beforeHoles);
  const currentByUid = mapItemsByUid(state.map_holes);
  const changedUids = new Set();
  state.map_holes.forEach((hole) => {
    const previous = beforeByUid.get(hole.uid);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(hole)) changedUids.add(hole.uid);
  });
  beforeHoles.forEach((hole) => { if (!currentByUid.has(hole.uid)) changedUids.add(hole.uid); });

  beforeHoles.forEach((previous) => {
    if (currentByUid.has(previous.uid)) return;
    variants.forEach((variant) => {
      const oldPoints = previous.points.map((point) => transformPointByAxes(point, variant.axes));
      const counterpart = findMatchingHole(beforeHoles, oldPoints, previous.uid);
      if (counterpart) state.map_holes = state.map_holes.filter((hole) => hole.uid !== counterpart.uid);
    });
  });

  state.map_holes.slice().forEach((current) => {
    const previous = beforeByUid.get(current.uid);
    if (!previous) {
      variants.forEach((variant) => createMirroredHole(current, variant.axes));
      return;
    }
    if (JSON.stringify(previous) === JSON.stringify(current)) return;
    variants.forEach((variant) => {
      const oldPoints = previous.points.map((point) => transformPointByAxes(point, variant.axes));
      const newPoints = current.points.map((point) => transformPointByAxes(point, variant.axes));
      const counterpartBefore = findMatchingHole(beforeHoles, oldPoints, previous.uid);
      if (counterpartBefore && changedUids.has(counterpartBefore.uid)) return;
      const counterpart = counterpartBefore ? state.map_holes.find((hole) => hole.uid === counterpartBefore.uid) : null;
      if (!counterpart) {
        createMirroredHole(current, variant.axes);
        return;
      }
      counterpart.points = newPoints.map((point, index) => ({
        uid: counterpart.points[index]?.uid || createUid("hole_vertex"),
        x: roundTo(point.x, 3),
        y: roundTo(point.y, 3),
      }));
    });
  });
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
  state.map_holes.forEach((hole) => {
    hole.points.forEach((item) => list.push({ type: "holeVertex", item, hole, key: makeKey("holeVertex", item.uid), movable: true }));
  });
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
  if (type === "hole") {
    const item = state.map_holes.find((hole) => hole.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  if (type === "holeVertex") {
    for (const hole of state.map_holes) {
      const item = hole.points.find((point) => point.uid === uid);
      if (item) return { type, item, hole, key, movable: true };
    }
    return null;
  }
  if (type === "structure") {
    const item = state.structures.find((x) => x.uid === uid);
    return item ? { type, item, key, movable: true } : null;
  }
  return null;
}

function getEntryCenter(entry) {
  if (entry.type === "hole") return getHoleCenter(entry.item);
  if (entry.type === "holeVertex") return { x: entry.item.x, y: entry.item.y };
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
  if (entry.type === "hole") return getHoleCenter(entry.item);
  return { x: entry.item.x, y: entry.item.y };
}
function setKeyPosition(key, x, y) {
  const entry = resolveKey(key);
  if (!entry || !entry.movable) return;
  if (entry.type === "hole") {
    moveHoleTo(entry.item, x, y);
    return;
  }
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
  const holeVertex = hitHoleVertex(world);
  if (holeVertex) return { key: makeKey("holeVertex", holeVertex.uid), movable: true };
  const hole = hitHole(world);
  if (hole) return { key: makeKey("hole", hole.uid), movable: true };
  const boundary = hitBoundary(world);
  if (boundary) return { key: makeKey("boundary", boundary.uid), movable: true };
  const wall = hitWall(world);
  if (wall) return { key: makeKey("wall", wall.uid), movable: false };
  return null;
}

function hitTower(world) {
  const threshold = GAME.TOWER_DIAMETER / 2;
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
function hitHoleVertex(world) {
  const threshold = 18 / Math.max(view.scale, 0.0001);
  for (let holeIndex = state.map_holes.length - 1; holeIndex >= 0; holeIndex -= 1) {
    const points = state.map_holes[holeIndex].points;
    for (let pointIndex = points.length - 1; pointIndex >= 0; pointIndex -= 1) {
      if (distance(world.x, world.y, points[pointIndex].x, points[pointIndex].y) <= threshold) return points[pointIndex];
    }
  }
  return null;
}
function hitHole(world) {
  const rimThreshold = 12 / Math.max(view.scale, 0.0001);
  for (let index = state.map_holes.length - 1; index >= 0; index -= 1) {
    const hole = state.map_holes[index];
    if (HOLE_GEOMETRY.pointInPolygon(world, hole.points, true)) return hole;
    for (let edge = 0; edge < hole.points.length; edge += 1) {
      if (pointToSegmentDistance(world, hole.points[edge], hole.points[(edge + 1) % hole.points.length]) <= rimThreshold) return hole;
    }
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
  if (multiplayerManager?.shouldUseTemporaryIds()) {
    const safePeerId = String(multiplayerManager.localPeerId || "client").replace(/[^a-zA-Z0-9_-]/g, "");
    return `temp_${safePeerId}_${prefix}_${uidSeed}`;
  }
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
      if (!updateInvalidObjectWarning()) {
        el.actionState.textContent = "Idle";
        el.actionState.className = "action-state idle";
      }
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
  state.map_holes.forEach((hole) => {
    scanUid(hole.uid);
    (hole.points || []).forEach((point) => scanUid(point.uid));
  });
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

function applyStateDelta(currentState, fromState, toState) {
  const next = cloneState(currentState);
  if (Number(fromState.spawn_protection_size) !== Number(toState.spawn_protection_size)) {
    next.spawn_protection_size = Number(toState.spawn_protection_size);
  }

  MULTIPLAYER_COLLECTIONS.forEach((config) => {
    const fromMap = mapItemsByUid(fromState[config.key] || []);
    const toMap = mapItemsByUid(toState[config.key] || []);

    fromMap.forEach((fromItem, uid) => {
      if (toMap.has(uid)) return;
      if (config.type === "tower") {
        const tower = next.towers.find((item) => item.uid === uid);
        if (tower) {
          next.towers = next.towers.filter((item) => item.uid !== uid);
          next.walls = next.walls.filter((wall) => wall.t1 !== tower.id && wall.t2 !== tower.id);
        }
      } else {
        next[config.key] = next[config.key].filter((item) => item.uid !== uid);
      }
    });

    toMap.forEach((toItem, uid) => {
      const fromItem = fromMap.get(uid);
      const currentIndex = next[config.key].findIndex((item) => item.uid === uid);
      if (!fromItem) {
        if (currentIndex === -1) next[config.key].push(cloneState(toItem));
        return;
      }
      if (JSON.stringify(fromItem) === JSON.stringify(toItem)) return;
      if (currentIndex !== -1) next[config.key][currentIndex] = cloneState(toItem);
    });
  });

  hydrateStateIdsFromReferences(next);
  return next;
}

function hydrateStateIdsFromReferences(mapState) {
  const towerIds = new Set(mapState.towers.map((tower) => tower.id));
  mapState.walls = mapState.walls.filter((wall) => towerIds.has(wall.t1) && towerIds.has(wall.t2));
}

function mapItemsByUid(items) {
  const map = new Map();
  items.forEach((item) => { if (item?.uid) map.set(item.uid, item); });
  return map;
}

function rewriteStateIds(mapState, permanentIds) {
  if (!mapState || !permanentIds) return;
  MULTIPLAYER_COLLECTIONS.forEach((config) => {
    (mapState[config.key] || []).forEach((item) => {
      const uid = lookupPermanentId(permanentIds.uids, item.uid);
      if (uid != null) item.uid = uid;
      if (config.type === "tower") {
        const id = lookupPermanentId(permanentIds.towerIds, item.id);
        if (id != null) item.id = id;
      }
      if (config.type === "wall") {
        const id = lookupPermanentId(permanentIds.wallIds, item.id);
        const t1 = lookupPermanentId(permanentIds.towerIds, item.t1);
        const t2 = lookupPermanentId(permanentIds.towerIds, item.t2);
        if (id != null) item.id = id;
        if (t1 != null) item.t1 = t1;
        if (t2 != null) item.t2 = t2;
      }
      if (config.type === "structure") {
        const id = lookupPermanentId(permanentIds.structureIds, item.id);
        if (id != null) item.id = id;
      }
    });
  });
}

function lookupPermanentId(map, key) {
  if (!map) return null;
  const stringKey = String(key);
  if (Object.prototype.hasOwnProperty.call(map, stringKey)) return map[stringKey];
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return null;
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

function hasUsableBoundary(mapState = state) {
  return mapState.map_boundaries.length >= 3;
}

function isInsideCurrentBoundary(x, y, mapState = state) {
  if (!hasUsableBoundary(mapState)) return false;
  return pointInPolygon(x, y, mapState.map_boundaries);
}

function isPlacementInsideBoundary(type, x, y, item = null, mapState = state) {
  if (!isPlacementInsideOuterBoundary(type, x, y, item, mapState)) return false;
  if (type === "tower" || type === "spawn") {
    return HOLE_GEOMETRY.findContainingHoleIndex({ x, y }, mapState.map_holes || []) < 0;
  }
  if (type === "bomb") {
    return HOLE_GEOMETRY.findCircleOverlappingHoleIndex({ x, y }, 250, mapState.map_holes || []) < 0;
  }
  return true;
}

function isPlacementInsideOuterBoundary(type, x, y, item = null, mapState = state) {
  if (!hasUsableBoundary(mapState)) return false;
  if (type === "tower") return isCircleInsideBoundary(x, y, GAME.TOWER_DIAMETER / 2, mapState);
  if (type === "bomb") return isCircleInsideBoundary(x, y, 250, mapState);
  if (type === "spawn") return isSquareInsideBoundary(x, y, (Number(mapState.spawn_protection_size) || 500) / 2, mapState);
  if (type === "structure") {
    const half = item && Number.isFinite(item.size) ? item.size / 2 : 70;
    return isSquareInsideBoundary(x, y, half, mapState);
  }
  return isInsideCurrentBoundary(x, y, mapState);
}

function isCircleInsideBoundary(x, y, radius, mapState = state) {
  if (!isInsideCurrentBoundary(x, y, mapState)) return false;
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
  return testPoints.every((p) => isInsideCurrentBoundary(p.x, p.y, mapState));
}

function isSquareInsideBoundary(x, y, half, mapState = state) {
  const testPoints = [
    { x, y },
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x - half, y: y + half },
    { x: x + half, y: y + half },
  ];
  return testPoints.every((p) => isInsideCurrentBoundary(p.x, p.y, mapState));
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
function rotateVector(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}
function snapAngleNear(angle, step, threshold) {
  const snapped = Math.round(angle / step) * step;
  return Math.abs(angle - snapped) <= threshold ? snapped : angle;
}
function angleDistance(a, b) {
  return Math.abs(normalizeAngle(a - b));
}
function normalizeAngle(angle) {
  let out = angle;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}
function nearestEquivalentAngle(angle, reference, period = Math.PI * 2) {
  return angle + Math.round((reference - angle) / period) * period;
}
function lineAngle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
function pointToInfiniteLineDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return Infinity;
  return Math.abs(dx * (a.y - point.y) - (a.x - point.x) * dy) / length;
}
function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}
function rotatePoint(x, y, cx, cy, angle) {
  const rotated = rotateVector(x - cx, y - cy, angle);
  return { x: cx + rotated.x, y: cy + rotated.y };
}
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

function getTowerByIdFrom(mapState, id) {
  return mapState.towers.find((tower) => tower.id === id) || null;
}

function getTowerPoint(id, overrides = null, mapState = state) {
  if (overrides && overrides.has(id)) return overrides.get(id);
  const tower = getTowerByIdFrom(mapState, id);
  if (!tower) return null;
  return { x: tower.x, y: tower.y };
}

function hasTowerOverlapAt(x, y, ignoreTowerId = null, mapState = state) {
  const minDist = GAME.TOWER_DIAMETER - 0.001;
  for (const tower of mapState.towers) {
    if (ignoreTowerId != null && tower.id === ignoreTowerId) continue;
    if (distance(x, y, tower.x, tower.y) < minDist) return true;
  }
  return false;
}

function hasTowerOverlapConflict(overrides = null, mapState = state) {
  const towers = mapState.towers.map((tower) => ({
    id: tower.id,
    ...(getTowerPoint(tower.id, overrides, mapState) || { x: tower.x, y: tower.y }),
  }));
  for (let i = 0; i < towers.length; i += 1) {
    for (let j = i + 1; j < towers.length; j += 1) {
      if (distance(towers[i].x, towers[i].y, towers[j].x, towers[j].y) < GAME.TOWER_DIAMETER - 0.001) return true;
    }
  }
  return false;
}

function isTowerPositionOnWall(x, y, ignoreTowerId = null, overrides = null, mapState = state) {
  const clearance = (GAME.TOWER_DIAMETER / 2) - 0.001;
  for (const wall of mapState.walls) {
    if (ignoreTowerId != null && (wall.t1 === ignoreTowerId || wall.t2 === ignoreTowerId)) continue;
    const a = getTowerPoint(wall.t1, overrides, mapState);
    const b = getTowerPoint(wall.t2, overrides, mapState);
    if (!a || !b) continue;
    if (pointToSegmentDistance({ x, y }, a, b) <= clearance) return true;
  }
  return false;
}

function hasTowerOnWallConflict(overrides = null, mapState = state) {
  for (const tower of mapState.towers) {
    const p = getTowerPoint(tower.id, overrides, mapState);
    if (!p) continue;
    if (isTowerPositionOnWall(p.x, p.y, tower.id, overrides, mapState)) return true;
  }
  return false;
}

function getTowerOverlapSignatures(overrides = null, mapState = state) {
  const conflicts = new Set();
  for (let i = 0; i < mapState.towers.length; i += 1) {
    const towerA = mapState.towers[i];
    const pointA = getTowerPoint(towerA.id, overrides, mapState);
    if (!pointA) continue;
    for (let j = i + 1; j < mapState.towers.length; j += 1) {
      const towerB = mapState.towers[j];
      const pointB = getTowerPoint(towerB.id, overrides, mapState);
      if (!pointB || distance(pointA.x, pointA.y, pointB.x, pointB.y) >= GAME.TOWER_DIAMETER - 0.001) continue;
      conflicts.add([String(towerA.uid || towerA.id), String(towerB.uid || towerB.id)].sort().join("|"));
    }
  }
  return conflicts;
}

function getTowerWallConflictSignatures(overrides = null, mapState = state) {
  const conflicts = new Set();
  const clearance = (GAME.TOWER_DIAMETER / 2) - 0.001;
  mapState.towers.forEach((tower) => {
    const point = getTowerPoint(tower.id, overrides, mapState);
    if (!point) return;
    mapState.walls.forEach((wall, wallIndex) => {
      if (wall.t1 === tower.id || wall.t2 === tower.id) return;
      const a = getTowerPoint(wall.t1, overrides, mapState);
      const b = getTowerPoint(wall.t2, overrides, mapState);
      if (!a || !b || pointToSegmentDistance(point, a, b) > clearance) return;
      const wallIdentity = wall.uid || wall.id || wallIndex;
      conflicts.add(`${tower.uid || tower.id}|${wallIdentity}`);
    });
  });
  return conflicts;
}

function getWallOverlapSignatures(overrides = null, mapState = state) {
  const conflicts = new Set();
  for (let i = 0; i < mapState.walls.length; i += 1) {
    const wallA = mapState.walls[i];
    const a1 = getTowerPoint(wallA.t1, overrides, mapState);
    const a2 = getTowerPoint(wallA.t2, overrides, mapState);
    if (!a1 || !a2) continue;
    for (let j = i + 1; j < mapState.walls.length; j += 1) {
      const wallB = mapState.walls[j];
      const b1 = getTowerPoint(wallB.t1, overrides, mapState);
      const b2 = getTowerPoint(wallB.t2, overrides, mapState);
      if (!b1 || !b2 || !wallsConflict(a1, a2, wallA.t1, wallA.t2, b1, b2, wallB.t1, wallB.t2)) continue;
      const wallAIdentity = String(wallA.uid || wallA.id || i);
      const wallBIdentity = String(wallB.uid || wallB.id || j);
      conflicts.add([wallAIdentity, wallBIdentity].sort().join("|"));
    }
  }
  return conflicts;
}

function hasNewConflict(nextConflicts, initialConflicts) {
  for (const conflict of nextConflicts) {
    if (!initialConflicts?.has(conflict)) return true;
  }
  return false;
}

function findWallOverlap(overrides = null, mapState = state) {
  for (let i = 0; i < mapState.walls.length; i += 1) {
    const wa = mapState.walls[i];
    const a1 = getTowerPoint(wa.t1, overrides, mapState);
    const a2 = getTowerPoint(wa.t2, overrides, mapState);
    if (!a1 || !a2) continue;
    for (let j = i + 1; j < mapState.walls.length; j += 1) {
      const wb = mapState.walls[j];
      const b1 = getTowerPoint(wb.t1, overrides, mapState);
      const b2 = getTowerPoint(wb.t2, overrides, mapState);
      if (!b1 || !b2) continue;
      if (wallsConflict(a1, a2, wa.t1, wa.t2, b1, b2, wb.t1, wb.t2)) return { wallA: wa, wallB: wb };
    }
  }
  return null;
}

function findWallOverlapForSegment(startPoint, endPoint, startTowerId, endTowerId, mapState = state, excludeWallUid = null) {
  for (const wall of mapState.walls) {
    if (excludeWallUid && wall.uid === excludeWallUid) continue;
    const b1 = getTowerPoint(wall.t1, null, mapState);
    const b2 = getTowerPoint(wall.t2, null, mapState);
    if (!b1 || !b2) continue;
    if (wallsConflict(startPoint, endPoint, startTowerId, endTowerId, b1, b2, wall.t1, wall.t2)) return wall;
  }
  return null;
}

function wallsConflict(a1, a2, aT1, aT2, b1, b2, bT1, bT2) {
  if (!segmentsIntersectOrTouch(a1, a2, b1, b2)) return false;
  const shared = [];
  if (aT1 != null && (aT1 === bT1 || aT1 === bT2)) shared.push(aT1);
  if (aT2 != null && (aT2 === bT1 || aT2 === bT2) && !shared.includes(aT2)) shared.push(aT2);
  if (!shared.length) return true;

  const collinear = isCollinear(a1, a2, b1) && isCollinear(a1, a2, b2);
  if (!collinear) return false;
  if (shared.length > 1) return true;

  const sharedId = shared[0];
  const aShared = aT1 === sharedId ? a1 : a2;
  const aOther = aT1 === sharedId ? a2 : a1;
  const bShared = bT1 === sharedId ? b1 : b2;
  const bOther = bT1 === sharedId ? b2 : b1;
  if (!nearlyEqualPoint(aShared, bShared)) return true;

  const v1x = aOther.x - aShared.x;
  const v1y = aOther.y - aShared.y;
  const v2x = bOther.x - bShared.x;
  const v2y = bOther.y - bShared.y;
  const dot = v1x * v2x + v1y * v2y;
  return dot > 0.0001;
}

function segmentsIntersectOrTouch(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function isCollinear(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <= 0.0001;
}

function orientation(a, b, c) {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) <= 0.0001) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) + 0.0001
    && b.x + 0.0001 >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + 0.0001
    && b.y + 0.0001 >= Math.min(a.y, c.y);
}

function nearlyEqualPoint(a, b) {
  return Math.abs(a.x - b.x) <= 0.0001 && Math.abs(a.y - b.y) <= 0.0001;
}

function createInitialState() {
  return {
    spawn_protection_size: 500,
    map_boundaries: getMapPresetPoints("square", 4000, 4000).map((point) => ({ uid: createUid("boundary"), ...point })),
    map_holes: [],
    spawn_points: [],
    bomb_sites: [],
    towers: [],
    walls: [],
    structures: [],
  };
}

function ensureDefaultBoundary() {
  if (state.map_boundaries.length) return;
  state.map_boundaries = getMapPresetPoints("square", 4000, 4000).map((point) => ({ uid: createUid("boundary"), ...point }));
}

if (globalThis.__COSMOWAR_EDITOR_TEST__) {
  globalThis.CosmowarEditorTestApi = {
    importState(data) {
      state = parseImportedState(data);
      history.undo = [];
      history.redo = [];
      selection.clear();
      normalizeMapHolesInState();
      hydrateCountersFromState();
      return cloneState(state);
    },
    getState: () => cloneState(state),
    exportState: () => buildExportPayload(state),
    validationMessages: () => getMapValidationReport(state).issues.map((issue) => issue.message),
    isPlacementAllowed: (type, x, y) => isPlacementInsideBoundary(type, x, y),
    createHole(points) {
      const previousLength = state.map_holes.length;
      interaction.holeDraft = { points: points.map((point) => ({ x: Number(point.x), y: Number(point.y) })) };
      if (!finishHoleDraft()) return null;
      return state.map_holes[previousLength]?.uid || null;
    },
    moveHoleVertex(holeIndex, vertexIndex, x, y) {
      return withAction("EDIT_HOLE_VERTEX", () => {
        const point = state.map_holes[holeIndex]?.points?.[vertexIndex];
        if (!point) return false;
        point.x = Number(x);
        point.y = Number(y);
        return true;
      });
    },
    moveHole(holeIndex, x, y) {
      return withAction("MOVE_HOLE", () => {
        const hole = state.map_holes[holeIndex];
        if (!hole) return false;
        moveHoleTo(hole, Number(x), Number(y));
        return true;
      });
    },
    deleteHole(holeIndex) {
      const hole = state.map_holes[holeIndex];
      if (!hole) return false;
      selection.clear();
      selection.add(makeKey("hole", hole.uid));
      deleteSelected();
      return true;
    },
    undo: undoAction,
    redo: redoAction,
    historyCounts: () => ({ undo: history.undo.length, redo: history.redo.length }),
    fitView(width, height) {
      viewport.width = width;
      viewport.height = height;
      fitBoundaryInView();
      return { ...view };
    },
    boxSelect(start, end) {
      interaction.boxSelect = { start: { ...start }, end: { ...end }, additive: false, baseSelection: [] };
      finishBoxSelection();
      return Array.from(selection);
    },
    getSelection: () => Array.from(selection),
    selectKeys(keys) {
      selection.clear();
      keys.forEach((key) => { if (resolveKey(key)) selection.add(key); });
      return Array.from(selection);
    },
    selectHoleVertices(holeIndex) {
      selection.clear();
      const hole = state.map_holes[holeIndex];
      hole?.points.forEach((point) => selection.add(makeKey("holeVertex", point.uid)));
      return Array.from(selection);
    },
    setMirror(axes, liveEnabled = false) {
      mirrorState.axes = cloneState(axes).filter(isUsableMirrorAxis);
      mirrorState.liveEnabled = Boolean(liveEnabled);
      interaction.selectedMirrorAxisIndex = null;
    },
    getMirrorAxes: () => cloneState(mirrorState.axes),
    getSelectedMirrorAxisIndex: () => interaction.selectedMirrorAxisIndex,
    selectMirrorAxis(index) {
      if (!mirrorState.axes[index]) return false;
      interaction.selectedMirrorAxisIndex = index;
      return true;
    },
    pressKey(key) {
      let prevented = false;
      onKeyDown({
        key: String(key),
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() { prevented = true; },
      });
      return { prevented, axes: cloneState(mirrorState.axes) };
    },
    addMirrorAxis(axis) {
      const beforeAxes = cloneState(mirrorState.axes);
      mirrorState.axes.push(cloneState(axis));
      pushMirrorAxesHistory("ADD_MIRROR_AXIS", beforeAxes, cloneState(mirrorState.axes));
      return cloneState(mirrorState.axes);
    },
    removeLastMirrorAxis() {
      commitMirrorAxesChange("REMOVE_MIRROR_AXIS", () => mirrorState.axes.pop(), "Last mirror axis removed");
      return cloneState(mirrorState.axes);
    },
    moveMirrorAxis(index, dx, dy) {
      const axis = mirrorState.axes[index];
      if (!axis) return false;
      interaction.snapTemporarilyDisabled = true;
      startMirrorAxisDrag(index, axis.a);
      applyMirrorAxisDrag({ x: axis.a.x + Number(dx), y: axis.a.y + Number(dy) });
      finishMirrorAxisDrag();
      interaction.snapTemporarilyDisabled = false;
      return true;
    },
    setHoleDraftPreview(points, ghost) {
      interaction.holeDraft = { points: cloneState(points) };
      interaction.placementGhost = ghost ? { type: "hole", ...cloneState(ghost) } : null;
      return cloneState(getMirroredHoleDraftPolygons());
    },
    mirrorSelectionOnce() {
      mirrorSelectionOnce();
      return cloneState(state);
    },
    centerImportedState(data) {
      const imported = parseImportedState(data);
      const result = centerMapStateOnOrigin(imported);
      return { ...result, state: cloneState(imported) };
    },
    selectMatching(key) {
      const source = resolveKey(key);
      if (!source) return [];
      const candidates = source.type === "hole"
        ? state.map_holes.map((item) => ({ type: "hole", item, key: makeKey("hole", item.uid) }))
        : getSelectableEntries().filter((entry) => entry.type === source.type);
      selection.clear();
      candidates.filter((entry) => objectsMatchForBatchSelection(source, entry)).forEach((entry) => selection.add(entry.key));
      return Array.from(selection);
    },
    getSettings: () => cloneState(editorSettings),
    updateSettings(patch, persist = true) {
      Object.keys(editorSettings).forEach((key) => {
        if (Object.hasOwn(patch, key)) editorSettings[key] = patch[key];
      });
      if (persist) saveSession();
      return cloneState(editorSettings);
    },
    restoreSession() {
      restoreSavedSession();
      return { settings: cloneState(editorSettings), view: { ...view } };
    },
    setView(nextView, persist = true) {
      Object.assign(view, nextView);
      if (persist) saveSession();
      return { ...view };
    },
    centerMapOnOrigin(width = viewport.width, height = viewport.height) {
      viewport.width = width;
      viewport.height = height;
      const changed = centerMapOnOrigin();
      return { changed, view: { ...view }, state: cloneState(state) };
    },
    resizeSelection(handle, world) {
      const keys = getTransformableSelectionKeys();
      startResize(keys, world, handle);
      applyResize(world);
      finishResize();
      return cloneState(state);
    },
    moveSelection(dx, dy) {
      const keys = getMovableSelectionKeys();
      const primaryKey = keys[0];
      const start = getKeyPosition(primaryKey);
      if (!primaryKey || !start) return false;
      interaction.snapTemporarilyDisabled = true;
      startDrag(keys, primaryKey, start);
      applyDrag({ x: start.x + Number(dx), y: start.y + Number(dy) });
      finishDrag();
      interaction.snapTemporarilyDisabled = false;
      return true;
    },
    moveSelectionSnapped(dx, dy) {
      const keys = getMovableSelectionKeys();
      const primaryKey = keys[0];
      const start = getKeyPosition(primaryKey);
      if (!primaryKey || !start) return false;
      interaction.snapTemporarilyDisabled = false;
      startDrag(keys, primaryKey, start);
      applyDrag({ x: start.x + Number(dx), y: start.y + Number(dy) });
      finishDrag();
      return true;
    },
    normalizeCustomShapeClipboard: (clipboard) => cloneState(normalizeCustomShapeClipboard(clipboard)),
    getSelectionClipboard: () => cloneState(buildSelectionClipboard()),
    importCustomShapes(data) {
      const result = appendImportedCustomShapes(cloneState(data));
      return { ...result, shapes: cloneState(customShapes) };
    },
    getCustomShapes: () => cloneState(customShapes),
    clearCustomShapes() {
      customShapes = [];
      persistCustomShapes();
      return [];
    },
    placeCustomShape(index, x, y) {
      const shape = customShapes[index];
      if (!shape) return false;
      editorClipboard = cloneState(shape.clipboard);
      interaction.pasteDraft = { clipboard: cloneState(editorClipboard), center: { x: Number(x), y: Number(y) }, angle: 0 };
      updatePasteDraft(interaction.pasteDraft.center);
      const valid = validatePasteDraft(interaction.pasteDraft).valid;
      if (valid) commitPasteDraft();
      return { valid, state: cloneState(state) };
    },
    beginSelectionMove(dx, dy) {
      const keys = getMovableSelectionKeys().length ? getMovableSelectionKeys() : getTransformableSelectionKeys();
      const primaryKey = keys[0];
      const start = getKeyPosition(primaryKey);
      if (!primaryKey || !start) return null;
      interaction.snapTemporarilyDisabled = true;
      startDrag(keys, primaryKey, start);
      applyDrag({ x: start.x + Number(dx), y: start.y + Number(dy) });
      const model = buildActiveLiveMirrorPreviewModel();
      activeLiveMirrorPreviewModel = model;
      return model ? {
        sourceWallUids: Array.from(model.sourceWallUids),
        suppressedWallUids: Array.from(model.suppressedWallUids),
        suppressedKeys: Array.from(model.suppressedKeys),
        previewSkip: Array.from(model.previewSkip),
        wallPreviewSkip: Array.from(model.wallPreviewSkip),
      } : null;
    },
    finishSelectionMove() {
      finishDrag();
      interaction.snapTemporarilyDisabled = false;
      activeLiveMirrorPreviewModel = null;
      return cloneState(state);
    },
    renderHoles: drawHoles,
  };
}

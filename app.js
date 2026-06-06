
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

const GAME = {
  SNAP_THRESHOLD: 20,
  ROTATION_SNAP_DEGREES: 90,
  ROTATION_SNAP_THRESHOLD_DEGREES: 5,
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
const SESSION_STORAGE_KEY = "top_down_map_editor_session_v1";
const PANEL_LAYOUT_STORAGE_KEY = "top_down_map_editor_panel_layout_v1";
const MULTIPLAYER_USERNAME_KEY = "top_down_map_editor_username";
const MULTIPLAYER_COLLECTIONS = [
  { key: "map_boundaries", type: "boundary", prefix: "boundary" },
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
  buildSnapEnabledInput: document.getElementById("buildSnapEnabledInput"),
  usernameInput: document.getElementById("usernameInput"),
  hostSessionBtn: document.getElementById("hostSessionBtn"),
  multiplayerStatus: document.getElementById("multiplayerStatus"),
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
let invalidObjectWarningCount = 0;
let editorClipboard = null;
let multiplayerManager = null;
let panelResize = null;

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
  buildModeSnapEnabled: true,
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
  rotate: null,
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
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
    }
    this.hostPeerId = hostId;
    const conn = this.peer.connect(hostId, {
      reliable: true,
      metadata: { username: this.getUsername() },
    });
    this.hostConn = conn;
    let handledClose = false;
    conn.on("open", () => {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.setStatus(`Connected to host ${hostId}. Waiting for map state...`);
      this.updateUi();
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
      this.retryTimer = setTimeout(() => {
        if (this.role === "client" && (!this.hostConn || !this.hostConn.open)) {
          this.connectToHost(hostId, options);
        }
      }, 1200);
    }
  }

  promoteToHost(previousList) {
    this.role = "host";
    this.hostPeerId = this.localPeerId;
    this.hostConn = null;
    this.connections.clear();
    this.connectedPeers = {};
    const nextList = [this.localPeerId, ...previousList.slice(2).filter((id) => id !== this.localPeerId)];
    this.succession.set(nextList);
    this.updateLocalPeerMeta();
    this.updateInviteLink();
    this.updateUi();
    this.setStatus("Host disconnected. You are now the host.", "success");
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
      this.setStatus(`Peer joined: ${this.connectedPeers[peerId].username}`);
    });
    conn.on("data", (payload) => this.handleClientData(conn, payload));
    conn.on("close", () => this.removeClient(peerId));
    conn.on("error", () => this.removeClient(peerId));
  }

  removeClient(peerId) {
    if (!this.connections.has(peerId) && !this.connectedPeers[peerId]) return;
    this.connections.delete(peerId);
    delete this.connectedPeers[peerId];
    this.succession.remove(peerId);
    this.broadcastSuccession();
    this.broadcastPeerList();
    this.setStatus(`Peer left: ${peerId}`);
  }

  handleHostConnectionLost() {
    if (this.role !== "client") return;
    const list = this.succession.list.slice();
    this.setStatus("Host connection lost. Checking succession list...", "warn");
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
    else if (payload.type === "succession_update") this.succession.set(payload.successionList || []);
    else if (payload.type === "peer_list") this.applyPeerList(payload.peers || {});
    else if (payload.type === "action_commit") this.applyActionCommit(payload);
    else if (payload.type === "action_reject") this.rollback.reject(payload);
    else if (payload.type === "cursor_move") this.receiveRemoteCursor(payload);
    else if (payload.type === "join_reject") this.setStatus(payload.reason || "Join rejected.", "warn");
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
    this.setStatus(`Committed ${payload.actionType || "remote action"}`, "success");
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
    if (payload.successionList) this.succession.set(payload.successionList);
    if (payload.peers) this.applyPeerList(payload.peers);
    this.applyAuthoritativeState(payload.state);
    this.setStatus(`Synced full state from host ${this.hostPeerId}`, "success");
  }

  applyActionCommit(payload) {
    this.rewriteHistoryIds(payload);
    this.rollback.resolve(payload.actionId);
    this.applyAuthoritativeState(payload.state);
    this.setStatus(`Synced ${payload.actionType || "remote action"}`, "success");
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
      state: cloneState(state),
      successionList: this.succession.list.slice(),
      peers: this.getPeerSnapshot(),
    });
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

  setStatus(text, tone = "idle") {
    if (el.multiplayerStatus) {
      el.multiplayerStatus.textContent = text;
      el.multiplayerStatus.dataset.tone = tone;
    }
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
    this.role = "offline";
    if (this.hostConn) {
      this.hostConn._manualClose = true;
      this.hostConn.close();
    }
    this.connections.forEach((conn) => conn.close());
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
      this.manager.joinSession(newHostId, { reconnect: true });
      return;
    }
    this.manager.role = "offline";
    this.manager.setStatus("Host disconnected and no successor was available.", "warn");
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

    const validationError = this.validateCandidate(candidate);
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
        health: clamp(1, Math.round(Number(item.health) || 5), 5),
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
        health: clamp(1, Math.round(Number(item.health) || current.health || 5), 5),
        is_invincible: Boolean(item.is_invincible),
      };
    }
    if (type === "wall") {
      return { ...current, t1: Number(item.t1), t2: Number(item.t2), team_id: Number(item.team_id) };
    }
    if (type === "spawn") return { ...current, team_id: Number(item.team_id), x: Number(item.x), y: Number(item.y) };
    if (type === "bomb") return { ...current, site_letter: String(item.site_letter || "A").toUpperCase(), x: Number(item.x), y: Number(item.y) };
    if (type === "boundary") return { ...current, x: Number(item.x), y: Number(item.y) };
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

  validateCandidate(candidate) {
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
    if (hasTowerOverlapConflict(null, candidate)) return "A tower overlaps another tower.";
    if (hasMovedWallLengthConflict(null, candidate)) return `A wall exceeds ${GAME.WALL_MAX_LENGTH}.`;
    if (hasTowerOnWallConflict(null, candidate)) return "A tower overlaps an existing wall.";
    if (findWallOverlap(null, candidate)) return "Walls overlap or intersect.";
    return "";
  }

  isStateLike(value) {
    return Boolean(value)
      && typeof value === "object"
      && Array.isArray(value.map_boundaries)
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
  }

  removeTemporaryIds(temporaryIds) {
    const uidSet = new Set(Object.keys(temporaryIds.uids || {}));
    if (!uidSet.size) return;
    state.map_boundaries = state.map_boundaries.filter((item) => !uidSet.has(item.uid));
    state.spawn_points = state.spawn_points.filter((item) => !uidSet.has(item.uid));
    state.bomb_sites = state.bomb_sites.filter((item) => !uidSet.has(item.uid));
    state.structures = state.structures.filter((item) => !uidSet.has(item.uid));
    const deletedTowerIds = new Set(state.towers.filter((item) => uidSet.has(item.uid)).map((tower) => tower.id));
    state.towers = state.towers.filter((item) => !uidSet.has(item.uid));
    state.walls = state.walls.filter((item) => !uidSet.has(item.uid) && !deletedTowerIds.has(item.t1) && !deletedTowerIds.has(item.t2));
  }
}

restoreSavedSession();
setup();

function setup() {
  hydrateCountersFromState();
  bindUI();
  setupPanelResizers();
  setupMultiplayer();
  updateTeamSwatches();
  el.snapStrengthInput.value = String(editorSettings.snapStrength);
  el.buildSnapEnabledInput.checked = editorSettings.buildModeSnapEnabled;
  el.towerHealthInput.max = "5";
  el.towerHealthInput.value = String(defaults.towerHealth);
  el.towerInvincibleInput.checked = defaults.towerInvincible;
  resizeCanvas();
  setMode("select");
  renderSelectionPanel();
  setActionState("Idle", "idle");
  requestRender();
  window.addEventListener("resize", onWindowResize);
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
      defaults.towerHealth = clamp(1, v, 5);
      el.towerHealthInput.value = String(defaults.towerHealth);
      saveSession();
    }
  });
  el.towerInvincibleInput.addEventListener("change", () => {
    defaults.towerInvincible = el.towerInvincibleInput.checked;
    saveSession();
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
  window.addEventListener("keyup", onKeyUp);
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
  interaction.rotate = null;
  interaction.boxSelect = null;
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
  setActionState(`Tool: ${toolLabel(mode)}`, "idle", true);
  requestRender();
}

function toolLabel(mode) {
  if (mode === "select") return "Select / Move";
  if (mode === "boundary") return "Draw Boundary";
  if (mode === "spawn") return "Place Spawn";
  if (mode === "bomb") return "Place Bomb Site";
  if (mode === "build") return "Build";
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
  if (interaction.pasteDraft) {
    commitPasteDraft();
    return;
  }
  if (interaction.mode === "select") {
    handleSelectDown(event, world);
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
    interaction.buildGhost = null;
    interaction.placementGhost = {
      type: "spawn",
      x: world.x,
      y: world.y,
      invalid: !isPlacementInsideBoundary("spawn", world.x, world.y),
    };
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
    requestRender();
  } else if (interaction.mode === "bomb") {
    interaction.buildGhost = null;
    interaction.placementGhost = {
      type: "bomb",
      x: world.x,
      y: world.y,
      invalid: !isPlacementInsideBoundary("bomb", world.x, world.y),
    };
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
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
  } else if (!interaction.drag) {
    interaction.buildGhost = null;
    interaction.placementGhost = null;
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
  }
  updateDraftLengthWarnings();
  if (interaction.mode === "build") requestRender();
}

function updateDraftLengthWarnings() {
  if (interaction.mode === "wall" && interaction.wallDraft) {
    const startTower = getTowerById(interaction.wallDraft.startTowerId);
    if (startTower) {
      const hoverTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
      const rawTarget = hoverTower && hoverTower.id !== startTower.id
        ? { x: hoverTower.x, y: hoverTower.y }
        : interaction.wallDraft.mouse;
      const length = distance(startTower.x, startTower.y, rawTarget.x, rawTarget.y);
      const tooLong = length > GAME.WALL_MAX_LENGTH;
      if (tooLong && !interaction.wallDraftWarnActive) {
        setActionState(`Wall exceeds max length (${Math.round(length)})`, "error");
        interaction.wallDraftWarnActive = true;
      }
      if (!tooLong && interaction.wallDraftWarnActive) {
        setActionState("Idle", "idle");
        interaction.wallDraftWarnActive = false;
      }
      return;
    }
  }
  if (interaction.wallDraftWarnActive) {
    interaction.wallDraftWarnActive = false;
    setActionState("Idle", "idle");
  }

  if (interaction.mode !== "build") {
    if (interaction.towerDraftWarnActive) {
      interaction.towerDraftWarnActive = false;
      setActionState("Idle", "idle");
    }
    return;
  }
  const startTower = getAutoWallStartTower();
  if (!startTower) {
    if (interaction.towerDraftWarnActive) {
      interaction.towerDraftWarnActive = false;
      setActionState("Idle", "idle");
    }
    return;
  }
  const hoverTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
  const snappedTarget = interaction.buildGhost || getBuildPlacementTarget(interaction.mouseWorld, startTower);
  const rawTarget = hoverTower && hoverTower.id !== startTower.id
    ? { x: hoverTower.x, y: hoverTower.y }
    : snappedTarget;
  const length = distance(startTower.x, startTower.y, rawTarget.x, rawTarget.y);
  const tooLong = length > GAME.WALL_MAX_LENGTH;
  if (tooLong && !interaction.towerDraftWarnActive) {
    setActionState(`Wall exceeds max length (${Math.round(length)})`, "error");
    interaction.towerDraftWarnActive = true;
  }
  if (!tooLong && interaction.towerDraftWarnActive) {
    setActionState("Idle", "idle");
    interaction.towerDraftWarnActive = false;
  }
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
  }
}

function onMouseUp() {
  interaction.isPanning = false;
  interaction.panStartMouse = null;
  interaction.panStartOffset = null;

  if (interaction.boxSelect) finishBoxSelection();
  if (interaction.drag) finishDrag();
  if (interaction.rotate) finishRotate();

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
  interaction.snapTemporarilyDisabled = event.ctrlKey;
  if (interaction.mode === "build" || interaction.mode === "boundary") {
    refreshPlacementPreviewFromMouse();
    requestRender();
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
    interaction.wallDraft = null;
    interaction.hoverTowerId = null;
    interaction.towerDraftWarnActive = false;
    interaction.wallDraftWarnActive = false;
    interaction.boxSelect = null;
    interaction.drag = null;
    interaction.rotate = null;
    interaction.pasteDraft = null;
    interaction.guides = { x: null, y: null, xPoints: [], yPoints: [] };
    setActionState("Draft actions cancelled", "idle", true);
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
  if ((key === "delete" || key === "backspace") && !isTypingInFormControl()) {
    event.preventDefault();
    deleteSelected();
  }
}

function onKeyUp(event) {
  interaction.snapTemporarilyDisabled = event.ctrlKey;
  if (interaction.mode === "build" || interaction.mode === "boundary") {
    refreshPlacementPreviewFromMouse();
    requestRender();
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
  interaction.snapTemporarilyDisabled = Boolean(event.ctrlKey);
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
  if (event.altKey && movable.length > 1) {
    startRotate(movable, world);
    return;
  }
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
  const snap = interaction.snapEnabled && !interaction.snapTemporarilyDisabled
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

  const movedTowerTargets = getMovedTowerTargets(drag, dx, dy);
  if (movedTowerTargets.size > 0) {
    if (hasTowerOnWallConflict(movedTowerTargets)) {
      setActionState("A tower cannot overlap an existing wall.", "warn");
      return;
    }
    if (findWallOverlap(movedTowerTargets)) {
      setActionState("Walls cannot overlap or intersect.", "warn");
      return;
    }
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
    if (!invalidReason && hasMovedWallLengthConflict(movedTowerTargets)) invalidReason = `Wall span exceeds ${GAME.WALL_MAX_LENGTH}.`;
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

function placeSpawn(world) {
  const target = interaction.placementGhost && interaction.placementGhost.type === "spawn"
    ? interaction.placementGhost
    : { x: world.x, y: world.y };
  if (!isPlacementInsideBoundary("spawn", target.x, target.y)) {
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
    : { x: world.x, y: world.y };
  if (!isPlacementInsideBoundary("bomb", target.x, target.y)) {
    setActionState("Cannot place bomb site outside map boundary.", "warn", true);
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
    if (length > GAME.WALL_MAX_LENGTH) {
      setActionState(`Wall too long (${Math.round(length)}), max ${GAME.WALL_MAX_LENGTH}`, "error", true);
      return;
    }
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
    if (startTower) {
      const dx = x - startTower.x;
      const dy = y - startTower.y;
      const dist = Math.hypot(dx, dy);
      if (dist > GAME.WALL_MAX_LENGTH) {
        setActionState(`Wall too long (${Math.round(dist)}), max ${GAME.WALL_MAX_LENGTH}`, "error", true);
        return false;
      }
    }
    if (!isPlacementInsideBoundary("tower", x, y)) {
      setActionState("Cannot place tower outside map boundary.", "warn", true);
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
      health: clamp(1, Math.round(defaults.towerHealth), 5),
      is_invincible: defaults.towerInvincible,
    };
    state.towers.push(tower);
    if (startTower && !hasDuplicateWall(startTower.id, tower.id)) {
      const length = distance(startTower.x, startTower.y, tower.x, tower.y);
      if (length <= GAME.WALL_MAX_LENGTH + 0.0001) {
        state.walls.push({ uid: createUid("wall"), id: nextWallLocalId(), t1: startTower.id, t2: tower.id, team_id: startTower.team_id });
      }
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
  if (length > GAME.WALL_MAX_LENGTH) {
    setActionState(`Wall too long (${Math.round(length)}), max ${GAME.WALL_MAX_LENGTH}`, "error", true);
    return;
  }
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

function getBuildPlacementTarget(world, startTower = null) {
  const preview = getBuildPlacementPreview(world, startTower);
  return { x: preview.x, y: preview.y };
}

function getBuildPlacementPreview(world, startTower = null) {
  if (!editorSettings.buildModeSnapEnabled || !interaction.snapEnabled || interaction.snapTemporarilyDisabled) {
    return { x: world.x, y: world.y, guideX: null, guideY: null, xPoints: [], yPoints: [] };
  }
  const exclude = new Set();
  return getSnapResult(world.x, world.y, exclude);
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
  const x = bestX ? bestX.value : world.x;
  const y = bestY ? bestY.value : world.y;
  return {
    x,
    y,
    guideX: bestX ? x : null,
    guideY: bestY ? y : null,
    xPoints: bestX ? candidates.filter((candidate) => Math.abs(candidate.x - x) <= 0.001) : [],
    yPoints: bestY ? candidates.filter((candidate) => Math.abs(candidate.y - y) <= 0.001) : [],
  };
}

function copySelectionToClipboard() {
  const entries = getSelectionEntries();
  const towerIds = new Set();
  const wallsByUid = new Map();
  const spawns = [];
  const bombs = [];
  const structures = [];

  entries.forEach((entry) => {
    if (entry.type === "tower") towerIds.add(entry.item.id);
    else if (entry.type === "spawn") spawns.push(cloneState(entry.item));
    else if (entry.type === "bomb") bombs.push(cloneState(entry.item));
    else if (entry.type === "structure") structures.push(cloneState(entry.item));
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
  const centers = [
    ...towers.map((item) => ({ x: item.x, y: item.y })),
    ...spawns.map((item) => ({ x: item.x, y: item.y })),
    ...bombs.map((item) => ({ x: item.x, y: item.y })),
    ...structures.map((item) => ({ x: item.x, y: item.y })),
  ];

  if (!centers.length) {
    setActionState("No copyable objects selected", "warn", true);
    return;
  }

  const origin = centers.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  origin.x /= centers.length;
  origin.y /= centers.length;

  const withOffset = (item) => ({ ...item, dx: item.x - origin.x, dy: item.y - origin.y });
  editorClipboard = {
    towers: towers.map(withOffset),
    spawns: spawns.map(withOffset),
    bombs: bombs.map(withOffset),
    structures: structures.map(withOffset),
    walls: Array.from(wallsByUid.values()).filter((wall) => towerIds.has(wall.t1) && towerIds.has(wall.t2)),
    origin,
  };
  startPasteDraft();
  setActionState(`Copied ${centers.length} object${centers.length === 1 ? "" : "s"}`, "success", true);
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
  interaction.pasteDraft.center = { ...world };
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
  return {
    towers: draft.clipboard.towers.map(rotateItem),
    spawns: draft.clipboard.spawns.map(rotateItem),
    bombs: draft.clipboard.bombs.map(rotateItem),
    structures: draft.clipboard.structures.map(rotateItem),
    walls: draft.clipboard.walls.map((wall) => ({ ...wall })),
  };
}

function validatePasteDraft(draft) {
  const entities = getPasteDraftEntities(draft);
  const towerByOriginalId = new Map(entities.towers.map((tower) => [tower.id, tower]));

  for (const spawn of entities.spawns) {
    if (!isPlacementInsideBoundary("spawn", spawn.x, spawn.y)) return { valid: false, reason: "Spawn would be outside map boundary." };
    if (state.spawn_points.some((existing) => existing.team_id === spawn.team_id)) return { valid: false, reason: "Pasted spawn would duplicate an existing team spawn." };
  }
  for (const bomb of entities.bombs) {
    if (!isPlacementInsideBoundary("bomb", bomb.x, bomb.y)) return { valid: false, reason: "Bomb site would be outside map boundary." };
  }
  for (const structure of entities.structures) {
    if (!isPlacementInsideBoundary("structure", structure.x, structure.y, structure)) return { valid: false, reason: "Structure would be outside map boundary." };
  }
  for (const tower of entities.towers) {
    if (!isPlacementInsideBoundary("tower", tower.x, tower.y)) return { valid: false, reason: "Tower would be outside map boundary." };
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
    if (distance(a.x, a.y, b.x, b.y) > GAME.WALL_MAX_LENGTH + 0.0001) return { valid: false, reason: "Copied wall would be too long." };
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

    entities.towers.forEach((tower) => {
      const pasted = {
        uid: createUid("tower"),
        id: nextTowerId(),
        team_id: tower.team_id,
        x: tower.x,
        y: tower.y,
        health: clamp(1, Math.round(tower.health), 5),
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

function getGuideCandidates(excludeKeys = new Set()) {
  const list = [];
  state.map_boundaries.forEach((p) => { if (!excludeKeys.has(makeKey("boundary", p.uid))) list.push({ x: p.x, y: p.y }); });
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
  bindTeamSwatchGroup(el.selectionPanel, tower.team_id, (nextTeam) => withAction("EDIT_TOWER", () => setConnectedComponentTeam(tower.id, nextTeam)));
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
  const entry = { type, before, after };
  history.undo.push(entry);
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo = [];
  multiplayerManager?.handleLocalAction(type, before, after, entry);
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
  onStateReplaced();
  multiplayerManager?.handleLocalAction("UNDO", before, cloneState(state));
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
  onStateReplaced();
  multiplayerManager?.handleLocalAction("REDO", before, cloneState(state));
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
  interaction.wallDraft = null;
  interaction.hoverTowerId = null;
  interaction.buildGhost = null;
  interaction.placementGhost = null;
  interaction.pasteDraft = null;
  interaction.towerDraftWarnActive = false;
  interaction.wallDraftWarnActive = false;
  interaction.drag = null;
  interaction.rotate = null;
  interaction.boxSelect = null;
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
    if (Array.isArray(saved?.history?.undo)) history.undo = saved.history.undo.filter(isLocalHistoryEntry).slice(-history.limit);
    if (Array.isArray(saved?.history?.redo)) history.redo = saved.history.redo.filter(isLocalHistoryEntry).slice(-history.limit);
    if (Number.isFinite(saved?.editorSettings?.snapStrength)) {
      editorSettings.snapStrength = clamp(1, Math.round(saved.editorSettings.snapStrength), 500);
    }
    if (typeof saved?.editorSettings?.buildModeSnapEnabled === "boolean") {
      editorSettings.buildModeSnapEnabled = saved.editorSettings.buildModeSnapEnabled;
    }
    if ([-1, 0, 1].includes(saved?.defaults?.defaultTeam)) {
      defaults.defaultTeam = saved.defaults.defaultTeam;
    }
    if (Number.isFinite(saved?.defaults?.towerHealth)) {
      defaults.towerHealth = clamp(1, Math.round(saved.defaults.towerHealth), 5);
    }
    if (typeof saved?.defaults?.towerInvincible === "boolean") {
      defaults.towerInvincible = saved.defaults.towerInvincible;
    }
  } catch (error) {
    console.warn("Could not restore saved map editor session.", error);
  }
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      state,
      history: {
        undo: history.undo.slice(-history.limit),
        redo: history.redo.slice(-history.limit),
      },
      editorSettings,
      defaults,
    }));
  } catch (error) {
    console.warn("Could not save map editor session.", error);
  }
}

function isSessionStateShape(value) {
  return Boolean(value)
    && typeof value === "object"
    && Array.isArray(value.map_boundaries)
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
  const invalid = [];
  mapState.towers.forEach((item) => {
    if (isObjectInvalid("tower", item, mapState)) invalid.push({ type: "tower", item, key: makeKey("tower", item.uid) });
  });
  mapState.spawn_points.forEach((item) => {
    if (isObjectInvalid("spawn", item, mapState)) invalid.push({ type: "spawn", item, key: makeKey("spawn", item.uid) });
  });
  mapState.bomb_sites.forEach((item) => {
    if (isObjectInvalid("bomb", item, mapState)) invalid.push({ type: "bomb", item, key: makeKey("bomb", item.uid) });
  });
  mapState.structures.forEach((item) => {
    if (isObjectInvalid("structure", item, mapState)) invalid.push({ type: "structure", item, key: makeKey("structure", item.uid) });
  });
  return invalid;
}

function isObjectInvalid(type, item, mapState = state) {
  return !isPlacementInsideBoundary(type, item.x, item.y, item, mapState);
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
  const count = getInvalidObjects().length;
  const previousCount = invalidObjectWarningCount;
  invalidObjectWarningCount = count;
  if (count <= 0) {
    if (previousCount > 0 && el.actionState.classList.contains("warn")) {
      el.actionState.textContent = "Idle";
      el.actionState.className = "action-state idle";
    }
    return false;
  }
  setActionState(`${count} object${count === 1 ? "" : "s"} invalid; export will remove invalid objects.`, "warn");
  return true;
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
  drawBuildGhostTower();
  drawPlacementGhost();
  drawPasteDraft();
  multiplayerManager?.drawCursors();
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
    const aTower = getTowerById(wall.t1);
    const bTower = getTowerById(wall.t2);
    if (!aTower || !bTower) return;
    const a = worldToScreen(aTower.x, aTower.y);
    const b = worldToScreen(bTower.x, bTower.y);
    const invalid = isObjectInvalid("tower", aTower) || isObjectInvalid("tower", bTower) || isActiveRotationInvalidWall(wall);
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
    const p = worldToScreen(tower.x, tower.y);
    const invalid = isObjectInvalid("tower", tower) || isActiveRotationInvalidKey(makeKey("tower", tower.uid));
    const color = getTeamColor(tower.team_id);
    const borderColor = tower.is_invincible ? "#FFD166" : color;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 44 * view.scale, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = borderColor;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();

    if (invalid) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 44 * view.scale, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(COLORS.danger, 0.35);
      ctx.fill();
      ctx.lineWidth = 4 * view.scale;
      ctx.strokeStyle = COLORS.danger;
      ctx.stroke();
    }

    if (!tower.is_invincible) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${16 * view.scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(tower.health), p.x, p.y);
    }

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
  if (interaction.mode !== "build") return;
  const startTower = getAutoWallStartTower();
  if (!startTower) return;

  const hoveredTower = interaction.hoverTowerId ? getTowerById(interaction.hoverTowerId) : null;
  const snappedTarget = getBuildPlacementTarget(interaction.mouseWorld, startTower);
  const rawTarget = hoveredTower && hoveredTower.id !== startTower.id
    ? { x: hoveredTower.x, y: hoveredTower.y }
    : snappedTarget;
  const length = distance(startTower.x, startTower.y, rawTarget.x, rawTarget.y);
  const ratio = length / GAME.WALL_MAX_LENGTH;
  const outsideBoundary = hoveredTower ? false : !isPlacementInsideBoundary("tower", rawTarget.x, rawTarget.y);
  let color = getTeamColor(startTower.team_id);
  if (ratio > 0.95) color = COLORS.warn;
  if (ratio > 1) color = COLORS.danger;
  if (outsideBoundary) color = COLORS.danger;
  const endWorld = clipLineToMaxLength(startTower.x, startTower.y, rawTarget.x, rawTarget.y, GAME.WALL_MAX_LENGTH);

  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(endWorld.x, endWorld.y);

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
  ctx.arc(p.x, p.y, 44 * view.scale, 0, Math.PI * 2);
  ctx.lineWidth = 8 * view.scale;
  ctx.strokeStyle = borderColor;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();

  if (!defaults.towerInvincible) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `${16 * view.scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(clamp(1, Math.round(defaults.towerHealth), 5)), p.x, p.y);
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
  }
}

function drawPasteDraft() {
  const draft = interaction.pasteDraft;
  if (!draft) return;
  const entities = getPasteDraftEntities(draft);
  const invalid = !validatePasteDraft(draft).valid;
  const towerByOriginalId = new Map(entities.towers.map((tower) => [tower.id, tower]));

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
    ctx.arc(p.x, p.y, 44 * view.scale, 0, Math.PI * 2);
    ctx.lineWidth = 8 * view.scale;
    ctx.strokeStyle = borderColor;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();

    if (!tower.is_invincible) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${16 * view.scale}px sans-serif`;
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
  const endWorld = clipLineToMaxLength(startTower.x, startTower.y, rawTarget.x, rawTarget.y, GAME.WALL_MAX_LENGTH);
  const length = distance(startTower.x, startTower.y, rawTarget.x, rawTarget.y);
  const start = worldToScreen(startTower.x, startTower.y);
  const end = worldToScreen(endWorld.x, endWorld.y);
  const ratio = length / GAME.WALL_MAX_LENGTH;
  let color = getTeamColor(startTower.team_id);
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
  const invalidRemoved = getInvalidObjects().length;
  const exportState = getExportableState();
  const validation = validateForExport(exportState);
  if (validation) {
    alert(validation);
    setActionState(validation, "error", true);
    return;
  }
  const payload = {
    spawn_protection_size: Number(exportState.spawn_protection_size),
    map_boundaries: exportState.map_boundaries.map((p) => ({ x: roundTo(p.x, 3), y: roundTo(p.y, 3) })),
    spawn_points: exportState.spawn_points.map((s) => ({ team_id: s.team_id, x: roundTo(s.x, 3), y: roundTo(s.y, 3) })).sort((a, b) => a.team_id - b.team_id),
    bomb_sites: exportState.bomb_sites.map((b) => ({ site_letter: String(b.site_letter || "A").toUpperCase(), x: roundTo(b.x, 3), y: roundTo(b.y, 3) })),
    towers: [...exportState.towers].sort((a, b) => a.id - b.id).map((t) => ({
      id: t.id,
      team_id: t.team_id,
      x: roundTo(t.x, 3),
      y: roundTo(t.y, 3),
      health: clamp(1, Math.round(t.health), 5),
      is_invincible: Boolean(t.is_invincible),
    })),
    walls: exportState.walls.map((w) => ({ t1: w.t1, t2: w.t2, team_id: w.team_id })),
  };
  if (exportState.structures.length) {
    payload.structures = exportState.structures.map((s) => ({ id: s.id, x: roundTo(s.x, 3), y: roundTo(s.y, 3), size: s.size, label: s.label, color: s.color, team_id: s.team_id }));
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
  setActionState(invalidRemoved ? `Export successful; removed ${invalidRemoved} invalid object${invalidRemoved === 1 ? "" : "s"}` : "Export successful", "success", true);
}

function getExportableState() {
  const towers = state.towers.filter((item) => !isObjectInvalid("tower", item));
  const towerIds = new Set(towers.map((tower) => tower.id));
  return {
    ...state,
    spawn_points: state.spawn_points.filter((item) => !isObjectInvalid("spawn", item)),
    bomb_sites: state.bomb_sites.filter((item) => !isObjectInvalid("bomb", item)),
    towers,
    walls: state.walls.filter((wall) => towerIds.has(wall.t1) && towerIds.has(wall.t2)),
    structures: state.structures.filter((item) => !isObjectInvalid("structure", item)),
  };
}

function validateForExport(mapState = state) {
  if (mapState.map_boundaries.length < 3) return "Validation error: map_boundaries must contain at least 3 points.";
  const team0 = mapState.spawn_points.filter((p) => p.team_id === 0).length;
  const team1 = mapState.spawn_points.filter((p) => p.team_id === 1).length;
  if (mapState.spawn_points.length !== 2 || team0 !== 1 || team1 !== 1) {
    return "Validation error: spawn_points must include exactly one Team 0 and one Team 1 spawn.";
  }
  const ids = new Set(mapState.towers.map((t) => t.id));
  const seen = new Set();
  for (const wall of mapState.walls) {
    if (wall.t1 === wall.t2) return "Validation error: wall cannot connect a tower to itself.";
    if (!ids.has(wall.t1) || !ids.has(wall.t2)) return "Validation error: wall references a missing tower id.";
    const a = getTowerByIdFrom(mapState, wall.t1);
    const b = getTowerByIdFrom(mapState, wall.t2);
    if (!a || !b) return "Validation error: wall references a missing tower id.";
    if (a.team_id !== b.team_id || wall.team_id !== a.team_id) {
      return "Validation error: every wall and its connected towers must share the same team color.";
    }
    const key = `${Math.min(wall.t1, wall.t2)}:${Math.max(wall.t1, wall.t2)}`;
    if (seen.has(key)) return "Validation error: duplicate wall between two towers.";
    seen.add(key);
  }
  if (findWallOverlap(null, mapState)) return "Validation error: walls cannot overlap or intersect.";
  if (hasTowerOnWallConflict(null, mapState)) return "Validation error: a tower overlaps an existing wall.";
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
  imported.walls.forEach((wall) => {
    const a = getTowerByIdFrom(imported, wall.t1);
    const b = getTowerByIdFrom(imported, wall.t2);
    if (!a || !b) throw new Error("Wall references a missing tower id.");
    if (a.team_id !== b.team_id || wall.team_id !== a.team_id) {
      throw new Error("Every wall and its connected towers must share the same team color.");
    }
  });
  if (findWallOverlap(null, imported)) throw new Error("Walls cannot overlap or intersect.");
  if (hasTowerOnWallConflict(null, imported)) throw new Error("A tower overlaps an existing wall.");

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
  if (!hasUsableBoundary(mapState)) return false;
  if (type === "tower") return isCircleInsideBoundary(x, y, 44, mapState);
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

function hasMovedWallLengthConflict(overrides = null, mapState = state) {
  for (const wall of mapState.walls) {
    const a = getTowerPoint(wall.t1, overrides, mapState);
    const b = getTowerPoint(wall.t2, overrides, mapState);
    if (!a || !b) continue;
    if (distance(a.x, a.y, b.x, b.y) > GAME.WALL_MAX_LENGTH + 0.0001) return true;
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
    map_boundaries: [],
    spawn_points: [],
    bomb_sites: [],
    towers: [],
    walls: [],
    structures: [],
  };
}

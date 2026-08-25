(function () {
  "use strict";

  const STORAGE_KEY = "top_down_map_editor_ui_shell_v1";
  const shellNew = document.getElementById("shellNew");
  const shellCurrent = document.getElementById("shellCurrent");
  const newHost = document.getElementById("newWorkspace");
  const currentHost = shellCurrent.querySelector(".workspace");
  const canvas = document.getElementById("mapCanvas");
  const buttons = Array.from(document.querySelectorAll("[data-ui-shell]"));

  function readShell() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "current" ? "current" : "new";
    } catch (_error) {
      return "new";
    }
  }

  function applyShell(shell, persist) {
    const next = shell === "current" ? "current" : "new";
    const isNew = next === "new";
    const host = isNew ? newHost : currentHost;
    shellNew.hidden = !isNew;
    shellCurrent.hidden = isNew;
    host.insertBefore(canvas, host.firstChild);
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.uiShell === next)));
    document.documentElement.dataset.uiShell = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_error) { /* Storage is optional. */ }
    }
    if (typeof globalThis.resizeCanvas === "function") globalThis.resizeCanvas();
    window.dispatchEvent(new CustomEvent("cosmowar-ui-shell-change", { detail: { shell: next } }));
  }

  buttons.forEach((button) => button.addEventListener("click", () => applyShell(button.dataset.uiShell, true)));
  applyShell(readShell(), false);

  globalThis.CosmowarUIShell = {
    get current() { return document.documentElement.dataset.uiShell || "new"; },
    set: (shell) => applyShell(shell, true),
  };
}());

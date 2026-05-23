(() => {
  if (window.__flowToolsProtectionLoaded) return;
  window.__flowToolsProtectionLoaded = true;

  const BLOCKED_KEY_COMBOS = new Set([
    "F12",
    "Ctrl+Shift+I",
    "Ctrl+Shift+J",
    "Ctrl+Shift+C",
    "Meta+Alt+I",
    "Meta+Alt+J",
    "Meta+Alt+C",
    "Ctrl+U",
    "Meta+U"
  ]);

  const getKeyCombo = (event) => {
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Meta");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(event.key?.length === 1 ? event.key.toUpperCase() : event.key);
    return parts.join("+");
  };

  const blockEvent = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    return false;
  };

  const stopRunningTasks = () => {
    const buttons = document.querySelectorAll(
      "#flow-tools-panel button.flow-tools-button.danger, #flow-tools-panel button.flow-tools-button.warning"
    );

    for (const button of buttons) {
      if (button.id === "flow-tools-unlink-license" || button.disabled) continue;
      const text = (button.textContent || "").trim().toLowerCase();
      if (text.includes("dung") || text.includes("dừng") || text.includes("dá»«ng")) {
        button.click();
      }
    }
  };

  const lockTool = () => {
    stopRunningTasks();
    document.getElementById("flow-tools-panel")?.remove();
  };

  document.addEventListener("keydown", (event) => {
    if (BLOCKED_KEY_COMBOS.has(getKeyCombo(event))) {
      lockTool();
      blockEvent(event);
    }
  }, true);

  document.addEventListener("contextmenu", blockEvent, true);

  const noop = () => {};
  for (const method of ["debug", "log", "info", "warn", "error", "trace", "table"]) {
    try {
      console[method] = noop;
    } catch {
      // Ignore read-only console implementations.
    }
  }
})();

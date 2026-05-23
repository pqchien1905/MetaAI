(() => {
  if (window.__flowToolsLoaded) return;
  window.__flowToolsLoaded = true;

  const CONFIG = {
    expectedTotal: 9999,
    scrollStepPx: 700,
    scrollDelayMs: 1000,
    noNewLimit: 60,
    downloadDelayMs: 1200,
    filePrefix: "meta-video",
    afterInputDelayMs: 2500,
    afterClickDelayMs: 8000,
    delayBetweenPromptsMs: 1000,
    maxWaitPerPromptMs: 15 * 60 * 1000,
    generatedItemsPerPrompt: 4,
    keepFlowTabActive: true,
    autoDownloadAfterPrompt: true,
    autoAppendVideo169: true,
    promptSuffix: "CREATE VIDEO 16:9",
    licenseRequired: true,
    licenseApiUrl: "https://flow-tools-license.pqchien1905.workers.dev/verify",
    promptSelector: '[data-testid="composer-input"][contenteditable="true"], textarea[data-testid="composer-input"], [data-testid="composer-input"] textarea, [data-slate-editor="true"][contenteditable="true"][role="textbox"]'
  };

  const DEFAULT_CONFIG = { ...CONFIG };
  const STORAGE_KEY = "flowToolsConfig";
  const UI_STORAGE_KEY = "flowToolsUi";
  const LICENSE_STORAGE_KEY = "flowToolsLicense";
  const FONT_FACE_STYLE_ID = "flow-tools-font-face";

  const state = {
    items: new Map(),
    promptItems: new Map(),
    failed: [],
    prompts: [],
    index: 0,
    scanning: false,
    scanStopRequested: false,
    downloading: false,
    downloadStopRequested: false,
    autoVideoRunning: false,
    running: false,
    paused: false,
    stopped: false,
    panel: null,
    statusBox: null,
    statsBox: null,
    progressBar: null,
    logBox: null,
    settingsForm: null,
    manualPromptBox: null,
    autoVideoButton: null,
    batchActionButton: null,
    backgroundDownloads: new Set(),
    downloadedPromptVideoKeys: new Set(),
    license: {
      key: "",
      active: false,
      checkedAt: 0,
      message: ""
    },
    activeView: "tools",
    collapsed: false,
    panelPosition: null,
    dragging: null,
    lastFocusRequestAt: 0
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitWhilePaused() {
    while (state.paused && !state.stopped) {
      await sleep(200);
    }

    if (state.stopped) throw new Error("Đã dừng.");
  }

  async function batchDelay(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await keepFlowTabActive("batch-delay");
      await waitWhilePaused();
      await sleep(Math.min(200, end - Date.now()));
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function keepFlowTabActive(reason) {
    if (!CONFIG.keepFlowTabActive) return;
    if (!state.running && !state.autoVideoRunning && !state.scanning && !state.downloading) return;

    const now = Date.now();
    if (now - state.lastFocusRequestAt < 1200) return;
    state.lastFocusRequestAt = now;

    try {
      await sendRuntimeMessage({ type: "FLOW_TOOLS_FOCUS_FLOW_TAB", reason });
    } catch (error) {
      addLog(`Không thể giữ tab Meta AI hoạt động: ${error.message}`, "warn");
    }
  }

  function licenseApiConfigured() {
    return CONFIG.licenseApiUrl && !CONFIG.licenseApiUrl.includes("YOUR-WORKER");
  }

  async function verifyLicenseKey(licenseKey) {
    const key = String(licenseKey || "").trim();
    if (!CONFIG.licenseRequired) return { active: true, message: "License không bắt buộc." };
    if (!licenseApiConfigured()) {
      return { active: false, message: "Chưa cấu hình licenseApiUrl trong content.js." };
    }
    if (!key) return { active: false, message: "Bạn chưa nhập license key." };

    const response = await sendRuntimeMessage({
      type: "FLOW_TOOLS_VERIFY_LICENSE",
      apiUrl: CONFIG.licenseApiUrl,
      licenseKey: key
    });

    if (!response?.ok) {
      return {
        active: false,
        message: response?.data?.message || response?.error || "Không kiểm tra được license."
      };
    }

    return {
      active: Boolean(response.data?.active),
      message: response.data?.message || (response.data?.active ? "License hợp lệ." : "License không hợp lệ.")
    };
  }

  function getLicenseUnlinkApiUrl() {
    return CONFIG.licenseApiUrl.replace(/\/verify\/?$/, "/unlink");
  }

  async function unlinkLicenseKey(licenseKey) {
    const key = String(licenseKey || "").trim();
    if (!CONFIG.licenseRequired) return { unlinked: true, message: "License khong bat buoc." };
    if (!licenseApiConfigured()) {
      return { unlinked: false, message: "Chua cau hinh licenseApiUrl trong content.js." };
    }
    if (!key) return { unlinked: false, message: "Ban chua nhap license key." };

    const response = await sendRuntimeMessage({
      type: "FLOW_TOOLS_UNLINK_LICENSE",
      apiUrl: getLicenseUnlinkApiUrl(),
      licenseKey: key
    });

    if (!response?.ok) {
      return {
        unlinked: false,
        message: response?.data?.message || response?.error || "Khong huy lien ket duoc license."
      };
    }

    return {
      unlinked: Boolean(response.data?.unlinked),
      message: response.data?.message || (response.data?.unlinked ? "Da huy lien ket license." : "Khong huy lien ket duoc license.")
    };
  }

  async function handleUnlinkLicense(event) {
    event?.preventDefault();
    const key = String(state.license.key || "").trim();
    if (!key) {
      updateStatus("Chua co license de huy lien ket.");
      return;
    }

    const confirmed = window.confirm("Huy lien ket license khoi may nay? Sau do ban co the nhap key tren thiet bi khac.");
    if (!confirmed) return;

    updateStatus("Dang huy lien ket license...");
    const result = await unlinkLicenseKey(key);

    if (!result.unlinked) {
      updateStatus(result.message);
      addLog(`Khong huy lien ket license: ${result.message}`, "warn");
      return;
    }

    state.license = {
      key: "",
      active: false,
      checkedAt: 0,
      message: result.message
    };
    await saveLicenseState();
    showLicensePanel(result.message);
  }

  async function ensureLicenseValid(force = false) {
    if (!CONFIG.licenseRequired) return true;
    const now = Date.now();
    const recentlyChecked = state.license.active && now - state.license.checkedAt < 5 * 60 * 1000;
    if (!force && recentlyChecked) return true;

    const result = await verifyLicenseKey(state.license.key);
    state.license.active = result.active;
    state.license.message = result.message;
    state.license.checkedAt = now;
    await saveLicenseState();

    if (!result.active) {
      showLicensePanel(result.message);
      return false;
    }

    return true;
  }

  function loadStoredConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY, UI_STORAGE_KEY, LICENSE_STORAGE_KEY], (result) => {
        Object.assign(CONFIG, normalizeConfig(result?.[STORAGE_KEY] || {}));
        Object.assign(state, normalizeUiState(result?.[UI_STORAGE_KEY] || {}));
        Object.assign(state.license, normalizeLicenseState(result?.[LICENSE_STORAGE_KEY] || {}));
        resolve();
      });
    });
  }

  function saveStoredConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: pickPersistedConfig() }, resolve);
    });
  }

  function saveUiState() {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        [UI_STORAGE_KEY]: {
          activeView: state.activeView,
          collapsed: state.collapsed,
          panelPosition: state.panelPosition
        }
      }, resolve);
    });
  }

  function saveLicenseState() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: state.license }, resolve);
    });
  }

  function pickPersistedConfig() {
    return {
      expectedTotal: CONFIG.expectedTotal,
      scrollStepPx: CONFIG.scrollStepPx,
      scrollDelayMs: CONFIG.scrollDelayMs,
      noNewLimit: CONFIG.noNewLimit,
      downloadDelayMs: CONFIG.downloadDelayMs,
      filePrefix: CONFIG.filePrefix,
      afterInputDelayMs: CONFIG.afterInputDelayMs,
      afterClickDelayMs: CONFIG.afterClickDelayMs,
      delayBetweenPromptsMs: CONFIG.delayBetweenPromptsMs,
      maxWaitPerPromptMs: CONFIG.maxWaitPerPromptMs,
      generatedItemsPerPrompt: CONFIG.generatedItemsPerPrompt,
      keepFlowTabActive: CONFIG.keepFlowTabActive,
      autoDownloadAfterPrompt: CONFIG.autoDownloadAfterPrompt,
      autoAppendVideo169: CONFIG.autoAppendVideo169,
      promptSuffix: CONFIG.promptSuffix,
      licenseApiUrl: CONFIG.licenseApiUrl
    };
  }

  function normalizeConfig(raw) {
    const clean = {};
    clean.filePrefix = String(raw.filePrefix || DEFAULT_CONFIG.filePrefix).trim() || DEFAULT_CONFIG.filePrefix;
    clean.expectedTotal = clampNumber(raw.expectedTotal, 1, 99999, DEFAULT_CONFIG.expectedTotal);
    clean.scrollStepPx = clampNumber(raw.scrollStepPx, 200, 3000, DEFAULT_CONFIG.scrollStepPx);
    clean.scrollDelayMs = clampNumber(raw.scrollDelayMs, 300, 10000, DEFAULT_CONFIG.scrollDelayMs);
    clean.noNewLimit = clampNumber(raw.noNewLimit, 5, 300, DEFAULT_CONFIG.noNewLimit);
    clean.downloadDelayMs = clampNumber(raw.downloadDelayMs, 0, 30000, DEFAULT_CONFIG.downloadDelayMs);
    clean.afterInputDelayMs = clampNumber(raw.afterInputDelayMs, 300, 30000, DEFAULT_CONFIG.afterInputDelayMs);
    clean.afterClickDelayMs = clampNumber(raw.afterClickDelayMs, 1000, 60000, DEFAULT_CONFIG.afterClickDelayMs);
    clean.delayBetweenPromptsMs = clampNumber(raw.delayBetweenPromptsMs, 0, 120000, DEFAULT_CONFIG.delayBetweenPromptsMs);
    clean.maxWaitPerPromptMs = clampNumber(raw.maxWaitPerPromptMs, 60000, 60 * 60 * 1000, DEFAULT_CONFIG.maxWaitPerPromptMs);
    clean.generatedItemsPerPrompt = clampNumber(raw.generatedItemsPerPrompt, 1, 12, DEFAULT_CONFIG.generatedItemsPerPrompt);
    clean.keepFlowTabActive = raw.keepFlowTabActive !== false && raw.keepFlowTabActive !== "false";
    clean.autoDownloadAfterPrompt = raw.autoDownloadAfterPrompt !== false && raw.autoDownloadAfterPrompt !== "false";
    clean.autoAppendVideo169 = raw.autoAppendVideo169 !== false && raw.autoAppendVideo169 !== "false";
    clean.promptSuffix = String(raw.promptSuffix || DEFAULT_CONFIG.promptSuffix).trim() || DEFAULT_CONFIG.promptSuffix;
    if (clean.promptSuffix.toUpperCase() === "VIDEO 16:9") {
      clean.promptSuffix = DEFAULT_CONFIG.promptSuffix;
    }
    clean.licenseApiUrl = String(raw.licenseApiUrl || DEFAULT_CONFIG.licenseApiUrl).trim() || DEFAULT_CONFIG.licenseApiUrl;
    return clean;
  }

  function normalizeLicenseState(raw) {
    return {
      key: String(raw.key || ""),
      active: Boolean(raw.active),
      checkedAt: Number(raw.checkedAt) || 0,
      message: String(raw.message || "")
    };
  }

  function secondsToMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    return Math.round(parsed * 1000);
  }

  function msToSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    const seconds = parsed / 1000;
    return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)));
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function normalizeUiState(raw) {
    const clean = {};
    const normalizedView = raw.activeView === "download" || raw.activeView === "batch" ? "tools" : raw.activeView;
    clean.activeView = ["tools", "settings"].includes(normalizedView) ? normalizedView : "tools";
    clean.collapsed = Boolean(raw.collapsed);
    clean.panelPosition = normalizePanelPosition(raw.panelPosition);
    return clean;
  }

  function normalizePanelPosition(position) {
    if (!position) return null;
    const left = Number(position.left);
    const top = Number(position.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return {
      left: Math.max(8, Math.min(window.innerWidth - 120, left)),
      top: Math.max(8, Math.min(window.innerHeight - 80, top))
    };
  }

  function addLog(text, level = "info") {
    const prefix = level === "warn" ? "Cảnh báo: " : level === "error" ? "Lỗi: " : "";
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"]("[Meta AI Tools]", text);

    if (!state.logBox) return;
    const row = document.createElement("div");
    row.className = `flow-tools-log-row ${level}`;
    row.textContent = `[${new Date().toLocaleTimeString()}] ${prefix}${text}`;
    state.logBox.prepend(row);
  }

  function injectFonts() {
    document.getElementById(FONT_FACE_STYLE_ID)?.remove();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      keepFlowTabActive("visibility-hidden");
    }
  });

  function updateStatus(text) {
    if (state.statusBox) state.statusBox.textContent = text;
  }

  function updateStats() {
    if (!state.statsBox) return;

    const totalPrompts = state.prompts.length;
    const promptPosition = state.running ? Math.min(state.index + 1, totalPrompts) : Math.min(state.index, totalPrompts);
    const percent = totalPrompts ? Math.round((state.index / totalPrompts) * 100) : 0;
    const activity = state.scanning
      ? "Đang quét"
      : state.downloading || state.autoVideoRunning
        ? "Đang tải"
        : state.running
          ? (state.paused ? "Tạm dừng" : "Đang chạy")
          : "Sẵn sàng";

    state.statsBox.innerHTML = `
      <div class="flow-tools-stat">
        <span>Video đã quét</span>
        <strong>${state.items.size}</strong>
      </div>
      <div class="flow-tools-stat">
        <span>Tải lỗi</span>
        <strong>${state.failed.length}</strong>
      </div>
      <div class="flow-tools-stat">
        <span>Prompt</span>
        <strong>${totalPrompts ? `${promptPosition}/${totalPrompts}` : "0"}</strong>
      </div>
      <div class="flow-tools-stat">
        <span>Trạng thái</span>
        <strong>${activity}</strong>
      </div>
    `;

    if (state.progressBar) {
      state.progressBar.style.width = `${Math.min(100, percent)}%`;
    }
  }

  function makeButton(text, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `flow-tools-button ${className || ""}`.trim();
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function showLicensePanel(message = "") {
    injectFonts();
    document.getElementById("flow-tools-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "flow-tools-panel";
    panel.innerHTML = `
      <div class="flow-tools-header">
        <div>
          <div class="flow-tools-kicker">QUANG CHIẾN - META AI</div>
          <div class="flow-tools-title">Kích hoạt Meta AI Tools</div>
          <div class="flow-tools-status" id="flow-tools-status">${message || "Nhập license key để sử dụng tool."}</div>
        </div>
        <div class="flow-tools-header-actions">
          <button type="button" class="flow-tools-icon-button" id="flow-tools-close" title="Đóng">×</button>
        </div>
      </div>
      <div class="flow-tools-body">
        <div class="flow-tools-license-box">
          <label>
            <span>License key</span>
            <input id="flow-tools-license-key" type="password" autocomplete="off" placeholder="Nhập license key..." />
          </label>
          <button type="button" class="flow-tools-button success" id="flow-tools-activate">Kích hoạt</button>
          <button type="button" class="flow-tools-button danger" id="flow-tools-unlink-license">Hủy liên kết</button>
          <div class="flow-tools-hint">Nếu key bị thu hồi trên server, tool sẽ tự khóa lại trong lần kiểm tra tiếp theo.</div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    state.panel = panel;
    state.statusBox = panel.querySelector("#flow-tools-status");
    applyPanelPosition();
    panel.querySelector("#flow-tools-close").addEventListener("click", () => panel.remove());

    const input = panel.querySelector("#flow-tools-license-key");
    input.value = state.license.key || "";
    input.focus();
    const unlinkButton = panel.querySelector("#flow-tools-unlink-license");
    unlinkButton.hidden = !state.license.key;
    unlinkButton.addEventListener("click", handleUnlinkLicense);

    panel.querySelector("#flow-tools-activate").addEventListener("click", async () => {
      const key = input.value.trim();
      updateStatus("Đang kiểm tra license...");
      const result = await verifyLicenseKey(key);
      state.license = {
        key,
        active: result.active,
        checkedAt: Date.now(),
        message: result.message
      };
      await saveLicenseState();

      if (!result.active) {
        updateStatus(result.message);
        return;
      }

      updateStatus("Kích hoạt thành công.");
      createPanel();
    });
  }

  function createPanel() {
    injectFonts();
    document.getElementById("flow-tools-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "flow-tools-panel";
    panel.innerHTML = `
      <div class="flow-tools-header">
        <div>
          <div class="flow-tools-kicker">QUANG CHIẾN - META AI</div>
          <div class="flow-tools-title">Bộ công cụ tự động</div>
          <div class="flow-tools-status" id="flow-tools-status">Sẵn sàng</div>
        </div>
        <div class="flow-tools-header-actions">
          <button type="button" class="flow-tools-icon-button" id="flow-tools-collapse" title="Thu gọn">−</button>
          <button type="button" class="flow-tools-icon-button" id="flow-tools-close" title="Đóng">×</button>
        </div>
      </div>
      <div class="flow-tools-body">
        <div class="flow-tools-tabs" id="flow-tools-tabs"></div>
        <div class="flow-tools-stats" id="flow-tools-stats"></div>
        <div class="flow-tools-progress"><span id="flow-tools-progress-bar"></span></div>
        <div class="flow-tools-view is-active" data-view="tools">
          <div class="flow-tools-section-title">Chạy prompt hàng loạt</div>
          <div class="flow-tools-toolbar" id="flow-tools-batch-actions"></div>
        </div>
        <div class="flow-tools-view" data-view="settings">
          <div class="flow-tools-section-title">Cài đặt</div>
          <form class="flow-tools-settings" id="flow-tools-settings-form"></form>
        </div>
        <div class="flow-tools-log-title">Nhật ký hoạt động</div>
        <div class="flow-tools-log" id="flow-tools-log"></div>
      </div>
    `;

    document.body.appendChild(panel);

    state.panel = panel;
    state.statusBox = panel.querySelector("#flow-tools-status");
    state.statsBox = panel.querySelector("#flow-tools-stats");
    state.progressBar = panel.querySelector("#flow-tools-progress-bar");
    state.logBox = panel.querySelector("#flow-tools-log");
    state.settingsForm = panel.querySelector("#flow-tools-settings-form");
    applyPanelPosition();

    const tabs = panel.querySelector("#flow-tools-tabs");
    const toolsTab = makeButton("Công cụ", "tab is-active", () => setActiveView("tools"));
    toolsTab.dataset.tab = "tools";
    const settingsTab = makeButton("Cài đặt", "tab", () => setActiveView("settings"));
    settingsTab.dataset.tab = "settings";
    tabs.append(toolsTab, settingsTab);

    panel.querySelector("#flow-tools-close").addEventListener("click", () => panel.remove());
    panel.querySelector("#flow-tools-collapse").addEventListener("click", toggleCollapsed);
    installPanelDrag(panel.querySelector(".flow-tools-header"));

    const batchActions = panel.querySelector("#flow-tools-batch-actions");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.style.display = "none";
    input.addEventListener("change", () => loadPromptFile(input));

    batchActions.append(
      input,
      createManualPromptBox(() => input.click()),
      makeBatchActionButton(),
      makeButton("Dừng", "danger", stopBatch),
      makeAutoVideoButton(),
      makeButton("Xóa nhật ký", "", clearLog),
      hint("Mỗi dòng TXT là 1 prompt. Dòng trống sẽ được bỏ qua.")
    );

    renderSettingsForm();

    setActiveView(state.activeView);
    if (state.collapsed) applyCollapsedState();
    updateStats();
    addLog("Bảng điều khiển đã sẵn sàng.");
  }

  function createManualPromptBox(onPickFile) {
    const wrapper = document.createElement("div");
    wrapper.className = "flow-tools-prompt-box";

    const header = document.createElement("div");
    header.className = "flow-tools-prompt-header";

    const label = document.createElement("label");
    label.textContent = "Nhập prompt";

    const pickButton = makeButton("Nhập tệp TXT", "primary compact", onPickFile);
    header.append(label, pickButton);

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Mỗi dòng là 1 prompt...";
    textarea.rows = 4;

    wrapper.append(header, textarea);
    state.manualPromptBox = textarea;
    return wrapper;
  }

  function makeBatchActionButton() {
    const button = makeButton("Bắt đầu", "success", handleBatchAction);
    state.batchActionButton = button;
    updateBatchActionButton();
    return button;
  }

  function updateBatchActionButton() {
    if (!state.batchActionButton) return;

    state.batchActionButton.classList.remove("success", "warning");
    state.batchActionButton.disabled = false;

    if (!state.running) {
      state.batchActionButton.textContent = "Bắt đầu";
      state.batchActionButton.title = "Bấm để bắt đầu chạy prompt";
      state.batchActionButton.classList.add("success");
      return;
    }

    if (state.stopped) {
      state.batchActionButton.textContent = "Đang dừng";
      state.batchActionButton.title = "Đang dừng batch";
      state.batchActionButton.disabled = true;
      state.batchActionButton.classList.add("warning");
      return;
    }

    if (state.paused) {
      state.batchActionButton.textContent = "Tiếp tục";
      state.batchActionButton.title = "Bấm để chạy tiếp";
      state.batchActionButton.classList.add("success");
      return;
    }

    state.batchActionButton.textContent = "Tạm dừng";
    state.batchActionButton.title = "Bấm để tạm dừng";
    state.batchActionButton.classList.add("warning");
  }

  async function handleBatchAction() {
    if (!state.running) {
      if (!(await ensureLicenseValid(true))) return;
      startBatch();
      return;
    }

    togglePause();
  }

  function makeAutoVideoButton() {
    const button = makeButton("Tải video", "danger", toggleAutoVideoDownload);
    state.autoVideoButton = button;
    updateAutoVideoButton();
    return button;
  }

  function updateAutoVideoButton() {
    if (!state.autoVideoButton) return;
    state.autoVideoButton.textContent = state.autoVideoRunning ? "Dừng tải" : "Tải video";
    state.autoVideoButton.title = state.autoVideoRunning
      ? "Bấm để dừng quét hoặc dừng tải"
      : "Bấm để quét lại từ đầu và tải toàn bộ video";
    state.autoVideoButton.classList.toggle("warning", state.autoVideoRunning);
    state.autoVideoButton.classList.toggle("danger", !state.autoVideoRunning);
  }

  async function toggleAutoVideoDownload() {
    if (state.autoVideoRunning) {
      state.scanStopRequested = true;
      state.downloadStopRequested = true;
      updateStatus("Đang dừng tải video...");
      addLog("Đã yêu cầu dừng tải video.");
      return;
    }

    if (!(await ensureLicenseValid(true))) return;
    autoScanAndDownload();
  }

  function hint(text) {
    const el = document.createElement("div");
    el.className = "flow-tools-hint";
    el.textContent = text;
    return el;
  }

  function setActiveView(view) {
    state.activeView = view;
    if (!state.panel) return;

    state.panel.querySelectorAll(".flow-tools-view").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.view === view);
    });
    state.panel.querySelectorAll(".flow-tools-tabs .flow-tools-button").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.tab === view);
    });
    saveUiState();
  }

  function toggleCollapsed() {
    state.collapsed = !state.collapsed;
    if (!state.panel) return;

    applyCollapsedState();
    saveUiState();
  }

  function applyCollapsedState() {
    if (!state.panel) return;
    state.panel.classList.toggle("is-collapsed", state.collapsed);
    const button = state.panel.querySelector("#flow-tools-collapse");
    if (button) {
      button.textContent = state.collapsed ? "+" : "−";
      button.title = state.collapsed ? "Mở rộng" : "Thu gọn";
    }
  }

  function applyPanelPosition() {
    if (!state.panel || !state.panelPosition) return;
    state.panel.style.left = `${state.panelPosition.left}px`;
    state.panel.style.top = `${state.panelPosition.top}px`;
    state.panel.style.right = "auto";
    state.panel.style.bottom = "auto";
  }

  function installPanelDrag(handle) {
    if (!handle || !state.panel) return;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = state.panel.getBoundingClientRect();
      state.dragging = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      handle.setPointerCapture(event.pointerId);
      state.panel.classList.add("is-dragging");
    });

    handle.addEventListener("pointermove", (event) => {
      if (!state.dragging || !state.panel) return;
      const rect = state.panel.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - state.dragging.offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - state.dragging.offsetY));
      state.panelPosition = { left, top };
      applyPanelPosition();
    });

    const stopDrag = async (event) => {
      if (!state.dragging) return;
      state.dragging = null;
      state.panel?.classList.remove("is-dragging");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      await saveUiState();
    };

    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }

  async function togglePanel() {
    const existing = document.getElementById("flow-tools-panel");
    if (existing) {
      existing.remove();
      return;
    }
    await loadStoredConfig();
    if (!(await ensureLicenseValid())) return;
    createPanel();
  }

  function renderSettingsForm() {
    if (!state.settingsForm) return;

    state.settingsForm.innerHTML = "";
    state.settingsForm.append(
      makeSettingField("Tiền tố tên file", "filePrefix", "text", CONFIG.filePrefix, "Ví dụ: meta-video"),
      makeSettingField("Tổng video dự kiến", "expectedTotal", "number", CONFIG.expectedTotal, "Dừng khi đạt số này"),
      makeSettingField("Bước cuộn", "scrollStepPx", "number", CONFIG.scrollStepPx, "Pixel mỗi lần cuộn"),
      makeSettingField("Nghỉ khi cuộn", "scrollDelayMs", "number", msToSeconds(CONFIG.scrollDelayMs), "Giây", "seconds"),
      makeSettingField("Giới hạn không có video mới", "noNewLimit", "number", CONFIG.noNewLimit, "Số vòng"),
      makeSettingField("Nghỉ giữa mỗi file tải", "downloadDelayMs", "number", msToSeconds(CONFIG.downloadDelayMs), "Giây", "seconds"),
      makeSettingField("Chờ sau khi nhập prompt", "afterInputDelayMs", "number", msToSeconds(CONFIG.afterInputDelayMs), "Giây", "seconds"),
      makeSettingField("Chờ sau khi bấm gửi", "afterClickDelayMs", "number", msToSeconds(CONFIG.afterClickDelayMs), "Giây", "seconds"),
      makeSettingField("Nghỉ giữa mỗi prompt", "delayBetweenPromptsMs", "number", msToSeconds(CONFIG.delayBetweenPromptsMs), "Giây", "seconds"),
      makeSettingField("Chờ tối đa mỗi prompt", "maxWaitPerPromptMs", "number", msToSeconds(CONFIG.maxWaitPerPromptMs), "Giây", "seconds"),
      makeSettingField("Tiền tố prompt", "promptSuffix", "text", CONFIG.promptSuffix, "Tự thêm trước mỗi prompt, ví dụ: CREATE VIDEO 16:9"),
      makeSettingCheckbox("Tự thêm CREATE VIDEO 16:9", "autoAppendVideo169", CONFIG.autoAppendVideo169, "Khi gửi prompt, tool tự thêm tiền tố này nếu chưa có."),
      makeSettingCheckbox("Tự tải video sau mỗi prompt", "autoDownloadAfterPrompt", CONFIG.autoDownloadAfterPrompt, "Sau khi gửi prompt, tool chờ video mới xuất hiện rồi tải trước khi chạy prompt tiếp theo."),
      makeSettingCheckbox("Giữ tab Meta AI hoạt động", "keepFlowTabActive", CONFIG.keepFlowTabActive, "Giúp chạy nhanh hơn khi bạn chuyển tab, nhưng Chrome có thể tự kéo tab Meta AI về trước.")
    );

    const actions = document.createElement("div");
    actions.className = "flow-tools-settings-actions";
    actions.append(
      makeButton("Lưu cài đặt", "success", saveSettingsFromForm),
      makeButton("Khôi phục mặc định", "", resetSettings),
      makeButton("Cài đặt tải xuống", "primary", openDownloadSettings),
      makeButton("Hủy liên kết license", "danger", handleUnlinkLicense)
    );

    state.settingsForm.append(actions, hint("Cài đặt được lưu trong Chrome và tự áp dụng ở lần mở panel tiếp theo."));
  }

  function makeSettingField(label, name, type, value, help, unit) {
    const wrapper = document.createElement("label");
    wrapper.className = "flow-tools-field";

    const labelText = document.createElement("span");
    labelText.textContent = label;

    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    input.value = value;
    if (unit) input.dataset.unit = unit;
    if (type === "number") {
      input.min = unit === "seconds" ? "0" : "1";
      input.step = unit === "seconds" ? "0.1" : "1";
    }

    const helpText = document.createElement("small");
    helpText.textContent = help;

    wrapper.append(labelText, input, helpText);
    return wrapper;
  }

  function makeSettingCheckbox(label, name, checked, help) {
    const wrapper = document.createElement("label");
    wrapper.className = "flow-tools-field flow-tools-checkbox-field";

    const row = document.createElement("span");
    row.className = "flow-tools-checkbox-row";

    const input = document.createElement("input");
    input.name = name;
    input.type = "checkbox";
    input.value = "true";
    input.checked = Boolean(checked);

    const labelText = document.createElement("span");
    labelText.textContent = label;

    const helpText = document.createElement("small");
    helpText.textContent = help;

    row.append(input, labelText);
    wrapper.append(row, helpText);
    return wrapper;
  }

  async function saveSettingsFromForm(event) {
    event?.preventDefault();
    if (!state.settingsForm) return;

    const data = Object.fromEntries(new FormData(state.settingsForm).entries());
    state.settingsForm.querySelectorAll("input[data-unit='seconds']").forEach((input) => {
      data[input.name] = secondsToMs(input.value);
    });
    data.keepFlowTabActive = state.settingsForm.querySelector("input[name='keepFlowTabActive']")?.checked ?? false;
    data.autoDownloadAfterPrompt = state.settingsForm.querySelector("input[name='autoDownloadAfterPrompt']")?.checked ?? false;
    data.autoAppendVideo169 = state.settingsForm.querySelector("input[name='autoAppendVideo169']")?.checked ?? false;
    Object.assign(CONFIG, normalizeConfig(data));
    renderSettingsForm();
    await saveStoredConfig();
    updateStatus("Đã lưu cài đặt.");
    addLog("Đã lưu cài đặt mới.");
  }

  async function resetSettings(event) {
    event?.preventDefault();
    Object.assign(CONFIG, DEFAULT_CONFIG);
    renderSettingsForm();
    await saveStoredConfig();
    updateStatus("Đã khôi phục cài đặt mặc định.");
    addLog("Đã khôi phục cài đặt mặc định.");
  }

  async function openDownloadSettings(event) {
    event?.preventDefault();

    try {
      const response = await sendRuntimeMessage({ type: "FLOW_TOOLS_OPEN_DOWNLOAD_SETTINGS" });
      if (!response?.ok) throw new Error(response?.error || "Không mở được cài đặt tải xuống.");
      updateStatus("Đã mở cài đặt tải xuống của Chrome.");
    } catch (error) {
      updateStatus("Không mở được cài đặt tải xuống.");
      addLog(`Không mở được cài đặt tải xuống: ${error.message}`, "error");
    }
  }

  function getScroller() {
    return (
      document.querySelector('[data-testid="virtuoso-scroller"]') ||
      document.querySelector('[data-virtuoso-scroller="true"]') ||
      document.scrollingElement ||
      document.documentElement ||
      document.body
    );
  }

  function normalizeUrl(src) {
    if (!src) return null;

    try {
      const raw = String(src).replaceAll("&amp;", "&");
      if (/^(blob|data):/i.test(raw)) return null;

      const url = new URL(raw, location.origin);
      if (!["http:", "https:"].includes(url.protocol)) return null;

      if (url.href.includes("media.getMediaUrlRedirect")) {
        url.searchParams.delete("mediaUrlType");
        if (!url.searchParams.get("name")) return null;
        return url.href;
      }

      if (isDirectVideoUrl(url)) return url.href;

      return null;
    } catch {
      return null;
    }
  }

  function isDirectVideoUrl(url) {
    const pathname = url.pathname.toLowerCase();
    const href = url.href.toLowerCase();
    return (
      /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(pathname) ||
      href.includes("/video/") ||
      href.includes("video_dash") ||
      (href.includes("fbcdn") && href.includes(".mp4")) ||
      (href.includes("cdninstagram") && href.includes(".mp4"))
    );
  }

  function sanitizeFilename(text) {
    return (
      String(text || "")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90)
        .toLowerCase() || "untitled"
    );
  }

  function getTitleNear(el, fallbackIndex) {
    const tile = el.closest("[data-tile-id]") || el.closest("[data-item-index]") || el.closest("div");
    const title =
      tile?.querySelector(".sc-899ba078-3")?.textContent?.trim() ||
      [...(tile?.querySelectorAll("div") || [])]
        .map((node) => node.textContent?.trim())
        .find((text) => text && text.length > 5 && text.length < 120);

    return title || `video-${fallbackIndex + 1}`;
  }

  function addItem(url, title, source) {
    if (!url) return false;

    const parsed = new URL(url);
    const key = parsed.searchParams.get("name") || parsed.searchParams.get("oh") || parsed.pathname || url;
    if (state.items.has(key)) return false;

    const item = {
      key,
      url,
      title: title || key,
      source
    };

    let added = false;
    if (!state.items.has(key)) {
      state.items.set(key, item);
      added = true;
    }

    if (state.running && !state.promptItems.has(key)) {
      state.promptItems.set(key, item);
      added = true;
    }

    return added;
  }

  function collectVisible() {
    let added = 0;
    const base = state.items.size;

    document.querySelectorAll("video").forEach((video, index) => {
      [
        video.currentSrc,
        video.src,
        video.getAttribute("src"),
        video.dataset?.videoUrl,
        video.getAttribute("data-video-url")
      ].forEach((url) => {
        if (addItem(normalizeUrl(url), getTitleNear(video, base + index), "video-preview")) added++;
      });
    });

    document.querySelectorAll("video source[src], source[src]").forEach((source, index) => {
      if (addItem(normalizeUrl(source.getAttribute("src")), getTitleNear(source, base + index), "source[src]")) added++;
    });

    document.querySelectorAll("[data-video-url]").forEach((el, index) => {
      if (addItem(normalizeUrl(el.getAttribute("data-video-url")), getTitleNear(el, base + index), "data-video-url")) added++;
    });

    document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach((img, index) => {
      if (addItem(normalizeUrl(img.getAttribute("src")), getTitleNear(img, base + index), "thumbnail-derived")) added++;
    });

    const matches = document.documentElement.innerHTML.match(/\/fx\/api\/trpc\/media\.getMediaUrlRedirect\?name=[a-zA-Z0-9-]+(?:&amp;mediaUrlType=[A-Z_]+)?/g) || [];
    matches.forEach((raw, index) => {
      if (addItem(normalizeUrl(raw), `meta-video-${base + index + 1}`, "html-regex")) added++;
    });

    if (added) addLog(`Thêm ${added} video mới. Tổng: ${state.items.size}`);
    updateStatus(`Đã quét ${state.items.size}/${CONFIG.expectedTotal} video`);
    performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(url) || String(url).includes("media.getMediaUrlRedirect"))
      .forEach((url, index) => {
        if (addItem(normalizeUrl(url), `meta-video-${base + index + 1}`, "performance-resource")) added++;
      });

    updateStatus(`Scanned ${state.items.size}/${CONFIG.expectedTotal} videos`);
    return added;
  }

  function collectVisibleSnapshot() {
    const items = new Map();
    const addSnapshotItem = (url, title, source) => {
      if (!url) return;
      const parsed = new URL(url);
      const key = parsed.searchParams.get("name") || parsed.searchParams.get("oh") || parsed.pathname || url;
      if (items.has(key)) return;
      items.set(key, {
        key,
        url,
        title: title || key,
        source
      });
    };
    const base = items.size;

    document.querySelectorAll("video").forEach((video, index) => {
      [
        video.currentSrc,
        video.src,
        video.getAttribute("src"),
        video.dataset?.videoUrl,
        video.getAttribute("data-video-url")
      ].forEach((url) => {
        addSnapshotItem(normalizeUrl(url), getTitleNear(video, base + index), "video-preview");
      });
    });

    document.querySelectorAll("video source[src], source[src]").forEach((source, index) => {
      addSnapshotItem(normalizeUrl(source.getAttribute("src")), getTitleNear(source, base + index), "source[src]");
    });

    document.querySelectorAll("[data-video-url]").forEach((el, index) => {
      addSnapshotItem(normalizeUrl(el.getAttribute("data-video-url")), getTitleNear(el, base + index), "data-video-url");
    });

    document.querySelectorAll('img[src*="media.getMediaUrlRedirect"]').forEach((img, index) => {
      addSnapshotItem(normalizeUrl(img.getAttribute("src")), getTitleNear(img, base + index), "thumbnail-derived");
    });

    const matches = document.documentElement.innerHTML.match(/\/fx\/api\/trpc\/media\.getMediaUrlRedirect\?name=[a-zA-Z0-9-]+(?:&amp;mediaUrlType=[A-Z_]+)?/g) || [];
    matches.forEach((raw, index) => {
      addSnapshotItem(normalizeUrl(raw), `meta-video-${base + index + 1}`, "html-regex");
    });

    performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(url) || String(url).includes("media.getMediaUrlRedirect"))
      .forEach((url, index) => {
        addSnapshotItem(normalizeUrl(url), `meta-video-${base + index + 1}`, "performance-resource");
      });

    return items;
  }

  function getItemKeySet() {
    return new Set(state.items.keys());
  }

  function getItemsNotIn(keySet) {
    return [...state.promptItems.values()].filter((item) => !keySet.has(item.key));
  }

  function getSnapshotItemsNotIn(snapshot, keySet) {
    return [...snapshot.values()].filter((item) => !keySet.has(item.key));
  }

  function startPromptVideoDownloadWatcher(beforeKeys, promptIndex) {
    if (!CONFIG.autoDownloadAfterPrompt) return;

    const task = waitForNewVideosAndDownload(beforeKeys, promptIndex)
      .catch((error) => {
        if (!state.stopped && !state.downloadStopRequested) {
          addLog(`Lá»—i táº£i ná»n prompt ${promptIndex + 1}: ${error.message}`, "error");
        }
      })
      .finally(() => {
        state.backgroundDownloads.delete(task);
        updateStats();
      });

    state.backgroundDownloads.add(task);
    updateStats();
  }

  async function waitForNewVideosAndDownload(beforeKeys, promptIndex) {
    if (!CONFIG.autoDownloadAfterPrompt) return;

    const start = Date.now();
    const expectedCount = CONFIG.generatedItemsPerPrompt || 4;
    const stableMs = 3000;
    let stableSince = 0;
    let lastCount = 0;
    addLog(`Đang chờ video mới cho prompt ${promptIndex + 1}...`);

    while (Date.now() - start < CONFIG.maxWaitPerPromptMs) {
      await keepFlowTabActive("wait-new-video");
      const snapshot = collectVisibleSnapshot();
      const newItems = getSnapshotItemsNotIn(snapshot, beforeKeys)
        .filter((item) => !state.downloadedPromptVideoKeys.has(item.key));
      const enoughItems = newItems.length >= expectedCount;

      if (newItems.length !== lastCount) {
        lastCount = newItems.length;
        stableSince = enoughItems ? Date.now() : 0;
      } else if (enoughItems && !stableSince) {
        stableSince = Date.now();
      }

      if (enoughItems && !isComposerGenerating() && Date.now() - stableSince >= stableMs) {
        addLog(`Tìm thấy ${newItems.length} video mới. Bắt đầu tải.`);

        const itemsToDownload = newItems.slice(0, expectedCount);
        itemsToDownload.forEach((item) => state.downloadedPromptVideoKeys.add(item.key));
        await downloadAll(itemsToDownload, promptIndex * expectedCount, true);

        updateStats();
        return;
      }

      updateStatus(`Đang chờ video mới cho prompt ${promptIndex + 1}...`);
      await sleep(1500);
    }

    addLog(`Không phát hiện video mới cho prompt ${promptIndex + 1} trong thời gian chờ.`, "warn");
  }

  async function scanByScrolling() {
    await keepFlowTabActive("scan-start");
    const scroller = getScroller();
    if (!scroller) throw new Error("Không tìm thấy vùng cuộn.");

    scroller.scrollTop = 0;
    window.scrollTo(0, 0);
    await sleep(1000);
    collectVisible();

    let noNew = 0;
    let lastTop = -1;

    for (let round = 1; round <= 1000; round++) {
      await keepFlowTabActive("scan-loop");
      if (state.scanStopRequested) {
        addLog("Đã dừng quét theo yêu cầu.");
        break;
      }

      if (state.items.size >= CONFIG.expectedTotal) {
        addLog(`Đã đạt ${CONFIG.expectedTotal} video. Dừng quét.`);
        break;
      }

      const before = state.items.size;
      scroller.scrollTop += CONFIG.scrollStepPx;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(CONFIG.scrollDelayMs);
      collectVisible();

      if (state.items.size === before) noNew++;
      else noNew = 0;

      const currentTop = scroller.scrollTop;
      if (currentTop === lastTop) noNew++;
      lastTop = currentTop;

      const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 20;
      updateStatus(`Đang quét: ${state.items.size}/${CONFIG.expectedTotal} | vòng ${round}`);
      updateStats();

      if (nearBottom && noNew >= 8) {
        addLog("Đã tới cuối danh sách.");
        break;
      }

      if (noNew >= CONFIG.noNewLimit) {
        addLog(`Không thấy video mới sau ${CONFIG.noNewLimit} lần cuộn. Dừng.`, "warn");
        break;
      }
    }

    for (let index = 0; index < 5; index++) {
      if (state.scanStopRequested) break;
      await sleep(500);
      collectVisible();
    }

    addLog(`Quét xong: ${state.items.size} video.`);
    updateStats();
  }

  async function autoScanAndDownload() {
    if (state.autoVideoRunning || state.scanning || state.downloading) {
      addLog("Tác vụ tải video đang chạy rồi.", "warn");
      return;
    }

    state.autoVideoRunning = true;
    state.scanStopRequested = false;
    state.downloadStopRequested = false;
    state.items.clear();
    state.promptItems.clear();
    state.downloadedPromptVideoKeys.clear();
    state.failed = [];
    updateAutoVideoButton();
    updateStats();
    await keepFlowTabActive("auto-video-start");

    try {
      state.scanning = true;
      updateStatus("Đang quét lại video từ đầu...");
      addLog("Bắt đầu quét lại danh sách video từ đầu.");
      await scanByScrolling();
    } catch (error) {
      addLog(`Lỗi quét video: ${error.message}`, "error");
      updateStatus("Quét video lỗi. Xem nhật ký.");
    } finally {
      state.scanning = false;
      updateStats();
    }

    if (state.scanStopRequested || state.downloadStopRequested) {
      state.autoVideoRunning = false;
      state.scanStopRequested = false;
      state.downloadStopRequested = false;
      updateAutoVideoButton();
      updateStats();
      updateStatus("Đã dừng tải video.");
      return;
    }

    const items = [...state.items.values()];
    if (!items.length) {
      state.autoVideoRunning = false;
      updateAutoVideoButton();
      updateStats();
      updateStatus("Không tìm thấy video để tải.");
      addLog("Không tìm thấy video để tải.", "warn");
      return;
    }

    try {
      await downloadAll(items);
    } finally {
      state.autoVideoRunning = false;
      state.scanStopRequested = false;
      state.downloadStopRequested = false;
      updateAutoVideoButton();
      updateStats();
    }
  }

  function clearLog() {
    if (state.logBox) state.logBox.textContent = "";
    updateStatus("Đã xóa nhật ký.");
  }

  async function downloadOne(item, index) {
    const safeTitle = sanitizeFilename(item.title || item.key || `video-${index + 1}`);
    const filename = `${CONFIG.filePrefix}-${String(index + 1).padStart(3, "0")}-${safeTitle}${getVideoExtension(item.url)}`;
    const response = await sendRuntimeMessage({
      type: "FLOW_TOOLS_DOWNLOAD",
      url: item.url,
      filename
    });

    if (!response?.ok) throw new Error(response?.error || "Chrome không thể tải file.");
  }

  function getVideoExtension(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.(mp4|mov|webm|m4v)(?:$|[?#])/i);
      return match ? `.${match[1].toLowerCase()}` : ".mp4";
    } catch {
      return ".mp4";
    }
  }

  async function downloadAll(items, startIndex = 0, downloadTogether = false) {
    if (state.downloading && !state.autoVideoRunning) {
      addLog("Đang tải rồi.", "warn");
      return;
    }

    if (!items.length) {
      addLog("Không có video để tải.", "warn");
      return;
    }

    state.downloading = true;
    state.downloadStopRequested = false;
    state.failed = [];
    let ok = 0;
    let stoppedEarly = false;
    addLog(`Bắt đầu tải ${items.length} video bằng Chrome Downloads.`);
    await keepFlowTabActive("download-start");

    try {
      if (downloadTogether) {
        updateStatus(`Đang gửi lệnh tải ${items.length} video cùng lúc...`);
        const results = await Promise.all(
          items.map(async (item, index) => {
            if (state.downloadStopRequested) return false;

            try {
              await downloadOne(item, startIndex + index);
              addLog(`Tải xong ${index + 1}/${items.length}: ${item.title}`);
              return true;
            } catch (error) {
              state.failed.push(item);
              addLog(`Lỗi tải ${index + 1}/${items.length}: ${item.title} | ${error.message}`, "error");
              return false;
            }
          })
        );
        ok = results.filter(Boolean).length;
        updateStats();
        return;
      }

      for (let index = 0; index < items.length; index++) {
        await keepFlowTabActive("download-loop");
        if (state.downloadStopRequested) {
          addLog("Đã dừng tải theo yêu cầu.");
          stoppedEarly = true;
          break;
        }

        const item = items[index];
        try {
          updateStatus(`Đang tải ${index + 1}/${items.length}: ${item.title}`);
          await downloadOne(item, startIndex + index);
          ok++;
          addLog(`Tải xong ${index + 1}/${items.length}: ${item.title}`);
        } catch (error) {
          state.failed.push(item);
          addLog(`Lỗi tải ${index + 1}/${items.length}: ${item.title} | ${error.message}`, "error");
        }

        updateStats();
        await sleep(CONFIG.downloadDelayMs);
      }
    } finally {
      state.downloading = false;
      state.downloadStopRequested = false;
      updateStatus(`${stoppedEarly ? "Đã dừng" : "Xong"}. Thành công ${ok}/${items.length}, lỗi ${state.failed.length}.`);
      updateAutoVideoButton();
      updateStats();
    }
  }

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function findPromptInput() {
    const exact = document.querySelector(CONFIG.promptSelector);
    if (exact && visible(exact)) return exact;

    return [
      ...document.querySelectorAll('[data-testid="composer-input"][contenteditable="true"]'),
      ...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]'),
      ...document.querySelectorAll('[data-testid="composer-input"] textarea'),
      ...document.querySelectorAll('textarea[data-testid="composer-input"]'),
      ...document.querySelectorAll('[data-slate-editor="true"][contenteditable="true"]'),
      ...document.querySelectorAll('[role="textbox"][contenteditable="true"]'),
      ...document.querySelectorAll('div[contenteditable="true"]'),
      ...document.querySelectorAll("textarea")
    ].filter(visible)[0] || null;
  }

  function findSubmitButton() {
    const metaButton = findComposerButton();
    if (metaButton && visible(metaButton) && !isStopGenerationButton(metaButton)) return metaButton;

    const accessibleButton = [...document.querySelectorAll("button[aria-label], button[title]")]
      .filter(visible)
      .find((button) => /(^|\s)(send|gui)(\s|$)/i.test(getButtonText(button)) && !isStopGenerationButton(button));
    if (accessibleButton) return accessibleButton;

    const labelledButton = [...document.querySelectorAll('button[aria-label]')]
      .filter(visible)
      .find((button) => /^(send|gửi)$/i.test(button.getAttribute("aria-label")?.trim() || ""));
    if (
      labelledButton &&
      !isStopGenerationButton(labelledButton) &&
      (labelledButton.getAttribute("data-testid") !== "composer-send-button" || !isStopIconButton(labelledButton))
    ) return labelledButton;

    const buttons = [...document.querySelectorAll("button")].filter(visible);
    const textButton = buttons.find((button) => {
      if (button.getAttribute("data-testid") === "composer-send-button" && isStopIconButton(button)) return false;
      return /(^|\s)(send|gui)(\s|$)/i.test(getButtonText(button)) && !isStopGenerationButton(button);
    });
    if (textButton) return textButton;

    const svgArrowButton = buttons.find((button) => isSendArrowButton(button) && !isStopGenerationButton(button));
    if (svgArrowButton) return svgArrowButton;

    const arrowButton = buttons.find((button) => {
      const icons = [...button.querySelectorAll("i")].map((icon) => icon.textContent?.trim()).filter(Boolean);
      return icons.includes("arrow_forward");
    });

    if (arrowButton && !isStopGenerationButton(arrowButton)) return arrowButton;

    const byClass = document.querySelector("button.sc-e5032833-5");
    if (byClass && visible(byClass) && !isStopGenerationButton(byClass)) return byClass;
    return null;
  }

  function findComposerButton() {
    const button = document.querySelector('[data-testid="composer-send-button"]');
    return button && visible(button) ? button : null;
  }

  function isComposerGenerating() {
    const button = findComposerButton();
    return Boolean(button && isStopGenerationButton(button));
  }

  function getButtonText(button) {
    return [
      button?.getAttribute("aria-label"),
      button?.getAttribute("title"),
      button?.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function isSendArrowButton(button) {
    const paths = [...(button?.querySelectorAll("svg path") || [])]
      .map((path) => path.getAttribute("d") || "");
    return paths.some((d) => d.includes("7.5 7.5") && d.includes("V25"));
  }

  function isStopIconButton(button) {
    const paths = [...(button?.querySelectorAll("svg path") || [])]
      .map((path) => path.getAttribute("d") || "");
    return paths.some((d) => d.includes("M19.1 5.625") && d.includes("H12.9"));
  }

  function isStopGenerationButton(button) {
    const text = getButtonText(button);
    return /(^|\s)(stop|cancel|dung|huy|ngung)(\s|$)/i.test(text) || isStopIconButton(button);
  }

  function findStopGenerationButton() {
    return [...document.querySelectorAll("button")]
      .filter(visible)
      .filter((button) => !button.closest("#flow-tools-panel"))
      .find((button) => isStopGenerationButton(button)) || null;
  }

  function isButtonDisabled(button) {
    return (
      !button ||
      button.disabled ||
      button.matches("[disabled]") ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("data-disabled") === "true" ||
      getComputedStyle(button).pointerEvents === "none"
    );
  }

  function selectAllInEditor(editor) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.select();
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function clearEditor(editor) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.value = "";
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "deleteContentBackward",
        data: null
      }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      await batchDelay(300);
      return;
    }

    selectAllInEditor(editor);
    document.execCommand("delete", false, null);

    editor.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
      data: null
    }));
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
      data: null
    }));
    await batchDelay(300);
  }

  async function insertTextIntoSlate(editor, text) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.value = text;
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: text
      }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      await batchDelay(500);
      return;
    }

    const beforeText = getEditorText(editor);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    editor.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: text
    }));
    await batchDelay(100);

    const insertedByBeforeInput = getEditorText(editor) !== beforeText;
    if (!insertedByBeforeInput) {
      document.execCommand("insertText", false, text);
    }

    await batchDelay(200);

    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: insertedByBeforeInput ? null : text
    }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    await batchDelay(500);
  }

  async function pasteIntoSlate(editor, text) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.value = text;
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertFromPaste",
        data: text
      }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      await batchDelay(500);
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    editor.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: dataTransfer
    }));
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertFromPaste",
      data: text
    }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    await batchDelay(500);
  }

  function getEditorText(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return (editor.value || "").replace(/\uFEFF/g, "").replace(/\u200B/g, "").trim();
    }

    return (editor?.innerText || "").replace(/\uFEFF/g, "").replace(/\u200B/g, "").trim();
  }

  async function setFlowPrompt(editor, text) {
    await clearEditor(editor);
    await insertTextIntoSlate(editor, text);
    let current = getEditorText(editor);

    if (!current.includes(text.slice(0, 20))) {
      await clearEditor(editor);
      await pasteIntoSlate(editor, text);
      current = getEditorText(editor);
    }

    if (!current.includes(text.slice(0, 20))) {
      await clearEditor(editor);
      const chunks = text.match(/.{1,200}/g) || [text];
      for (const chunk of chunks) {
        await insertTextIntoSlate(editor, chunk);
        await batchDelay(80);
      }
      current = getEditorText(editor);
    }

    editor.focus();
    let node = editor;
    for (let index = 0; index < 4 && node; index++) {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node = node.parentElement;
    }

    await batchDelay(CONFIG.afterInputDelayMs);
    current = getEditorText(editor);
    if (!current.includes(text.slice(0, 20))) {
      throw new Error("Không nhập được prompt vào Slate editor.");
    }

    addLog("Đã nhập prompt vào ô Meta AI.");
  }

  async function waitForInputAndButton() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitPerPromptMs) {
      if (state.stopped) throw new Error("Đã dừng.");
      await waitWhilePaused();

      if (isComposerGenerating()) {
        updateStatus("Meta AI vẫn đang tạo video, chờ xong trước khi gửi prompt tiếp...");
        await batchDelay(2000);
        continue;
      }

      const input = findPromptInput();
      const button = findSubmitButton();
      if (input && button) return { input, button };

      updateStatus("Đang chờ ô nhập và nút gửi...");
      await batchDelay(1000);
    }

    throw new Error("Không tìm thấy ô nhập hoặc nút gửi.");
  }

  async function waitButtonReady(button) {
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const currentButton = findSubmitButton() || (button && !isStopGenerationButton(button) ? button : null);
      if (currentButton && !isButtonDisabled(currentButton)) return currentButton;
      await batchDelay(500);
    }
    return null;
  }

  async function clickSubmit(button) {
    if (!button) throw new Error("Không có nút gửi.");

    if (isStopGenerationButton(button)) throw new Error("Meta AI vẫn đang tạo video, không bấm nút dừng.");

    if (isButtonDisabled(button)) throw new Error("Nút gửi chưa sẵn sàng.");

    button.scrollIntoView({ block: "center", inline: "center" });
    await batchDelay(250);

    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventBase = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0,
      buttons: 1
    };

    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      if (isStopGenerationButton(button)) {
        throw new Error("Meta AI đã chuyển sang nút dừng, không bấm thêm.");
      }
      if (isButtonDisabled(button)) {
        throw new Error("Nút gửi bị vô hiệu hóa trước khi bấm.");
      }
      button.dispatchEvent(new MouseEvent(type, eventBase));
      await batchDelay(25);
    }

    await batchDelay(500);
  }

  async function waitAfterSubmit(prompt) {
    const start = Date.now();
    await batchDelay(CONFIG.afterClickDelayMs);

    while (Date.now() - start < CONFIG.maxWaitPerPromptMs) {
      if (state.stopped) throw new Error("Đã dừng.");
      await waitWhilePaused();

      const input = findPromptInput();
      const text = getEditorText(input);
      if (!text || !text.includes(prompt.slice(0, 25))) return true;

      if (Date.now() - start > 45000) {
        addLog("Không xác định được Meta AI đã nhận chưa, chuyển prompt tiếp.", "warn");
        return true;
      }

      updateStatus("Đang chờ Meta AI nhận prompt...");
      await batchDelay(1500);
    }

    return true;
  }

  async function waitForGenerationComplete(promptIndex) {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitPerPromptMs) {
      await keepFlowTabActive("wait-generation-complete");

      const sendButton = findSubmitButton();

      if (sendButton) {
        addLog(`Meta AI đã tạo xong video cho prompt ${promptIndex + 1}.`);
        return true;
      }

      updateStatus(`Đang chờ Meta AI tạo xong video cho prompt ${promptIndex + 1}...`);
      await batchDelay(1000);
    }

    addLog(`Hết thời gian chờ tạo video cho prompt ${promptIndex + 1}, chuyển prompt tiếp.`, "warn");
    return true;
  }

  async function runOnePrompt(prompt, index, total) {
    const promptToSend = buildPromptToSend(prompt);
    await keepFlowTabActive("prompt-start");
    const beforeVideoKeys = new Set(collectVisibleSnapshot().keys());
    updateStatus(`Đang chạy ${index + 1}/${total}`);
    updateStats();
    addLog(`Prompt ${index + 1}/${total}: ${promptToSend.slice(0, 120)}${promptToSend.length > 120 ? "..." : ""}`);
    const { input, button } = await waitForInputAndButton();

    await setFlowPrompt(input, promptToSend);
    if (!getEditorText(input).includes(promptToSend.slice(0, 20))) {
      throw new Error("Prompt chưa nằm trong ô trước khi gửi.");
    }

    const readyButton = await waitButtonReady(button);
    if (!readyButton) throw new Error("Không tìm thấy nút gửi.");

    await clickSubmit(readyButton);
    addLog(`Đã bấm gửi prompt ${index + 1}/${total}`);
    await waitAfterSubmit(promptToSend);
    await waitForGenerationComplete(index);
    await waitForNewVideosAndDownload(beforeVideoKeys, index);
    await batchDelay(CONFIG.delayBetweenPromptsMs);
  }

  async function loadPromptFile(input) {
    const file = input.files?.[0];
    if (!file) return;

    const text = await file.text();
    state.prompts = parsePromptText(text);
    state.index = 0;
    state.stopped = false;
    state.paused = false;
    updateStatus(`Đã nạp ${state.prompts.length} prompt từ ${file.name}`);
    addLog(`Đã nạp file: ${file.name}`);
    updateStats();
  }

  function parsePromptText(text) {
    return String(text || "")
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function buildPromptToSend(prompt) {
    const basePrompt = String(prompt || "").trim();
    const prefix = String(CONFIG.promptSuffix || "").trim();
    if (!CONFIG.autoAppendVideo169 || !prefix) return basePrompt;

    const prefixPattern = new RegExp(`^\\s*${escapeRegExp(prefix)}(\\s|\\n|$)`, "i");
    if (prefixPattern.test(basePrompt)) return basePrompt;

    return `${prefix}\n${basePrompt}`;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function togglePause() {
    state.paused = !state.paused;
    updateStatus(state.paused ? "Đang tạm dừng" : "Đang chạy tiếp");
    addLog(state.paused ? "Đã tạm dừng." : "Tiếp tục.");
    updateBatchActionButton();
    updateStats();
  }

  function stopBatch() {
    if (!state.running) {
      state.stopped = true;
      state.paused = false;
      updateStatus("Đã dừng");
      addLog("Đã dừng.");
      updateBatchActionButton();
      updateStats();
      return;
    }

    state.stopped = true;
    state.paused = false;
    updateStatus("Đang dừng...");
    addLog("Đã yêu cầu dừng.");
    updateBatchActionButton();
    updateStats();
  }

  async function startBatch() {
    if (!state.prompts.length) {
      const manualPrompts = parsePromptText(state.manualPromptBox?.value || "");
      if (manualPrompts.length) {
        state.prompts = manualPrompts;
        state.index = 0;
        state.stopped = false;
        state.paused = false;
        updateStatus(`Đã nạp ${state.prompts.length} prompt từ ô nhập.`);
        addLog(`Đã nạp ${state.prompts.length} prompt từ ô nhập.`);
        updateStats();
      } else {
        updateStatus("Bạn chưa chọn file TXT hoặc nhập prompt.");
        return;
      }
    }

    if (state.running) {
      addLog("Batch đang chạy rồi.", "warn");
      return;
    }

    if (state.index >= state.prompts.length) {
      state.index = 0;
    }

    state.running = true;
    state.stopped = false;
    state.paused = false;
    state.items.clear();
    state.promptItems.clear();
    state.downloadedPromptVideoKeys.clear();
    state.failed = [];
    updateBatchActionButton();
    await keepFlowTabActive("batch-start");

    const total = state.prompts.length;
    addLog(`Bắt đầu chạy từ prompt ${state.index + 1}/${total}`);
    updateStats();

    try {
      for (; state.index < total; state.index++) {
        await keepFlowTabActive("batch-loop");
        if (state.stopped) break;
        await waitWhilePaused();

        try {
          await runOnePrompt(state.prompts[state.index], state.index, total);
        } catch (error) {
          addLog(`Lỗi prompt ${state.index + 1}: ${error.message}`, "error");
          if (state.stopped) break;
          await batchDelay(3000);
        }
      }

      if (state.stopped) {
        updateStatus(`Đã dừng tại prompt ${Math.min(state.index + 1, total)}/${total}`);
        addLog(`Đã dừng tại prompt ${Math.min(state.index + 1, total)}/${total}`);
      } else {
        updateStatus(`Hoàn tất ${total}/${total} prompt`);
        addLog("Hoàn tất toàn bộ prompt.");
        state.index = 0;
      }
    } finally {
      state.running = false;
      state.paused = false;
      updateBatchActionButton();
      updateStats();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "FLOW_TOOLS_TOGGLE") togglePanel();
  });
})();

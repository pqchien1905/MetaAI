const DEVICE_STORAGE_KEY = "flowToolsDeviceId";

function getStoredValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result?.[key]);
    });
  });
}

function setStoredValue(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

function createDeviceId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateDeviceId() {
  const current = String(await getStoredValue(DEVICE_STORAGE_KEY) || "").trim();
  if (current) return current;

  const next = createDeviceId();
  await setStoredValue(DEVICE_STORAGE_KEY, next);
  return next;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  await chrome.tabs.sendMessage(tab.id, { type: "FLOW_TOOLS_TOGGLE" }).catch(async () => {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles.css"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "FLOW_TOOLS_TOGGLE" });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FLOW_TOOLS_VERIFY_LICENSE" || message?.type === "FLOW_TOOLS_UNLINK_LICENSE") {
    getOrCreateDeviceId().then((deviceId) => fetch(message.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        licenseKey: message.licenseKey,
        deviceId,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      })
    }))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        sendResponse({
          ok: response.ok,
          status: response.status,
          data
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message
        });
      });

    return true;
  }

  if (message?.type === "FLOW_TOOLS_FOCUS_FLOW_TAB") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (!tabId || !windowId) {
      sendResponse({ ok: false, error: "Không xác định được tab Flow." });
      return false;
    }

    chrome.windows.update(windowId, { focused: true }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      chrome.tabs.update(tabId, { active: true }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        sendResponse({ ok: true });
      });
    });

    return true;
  }

  if (message?.type === "FLOW_TOOLS_OPEN_DOWNLOAD_SETTINGS") {
    chrome.tabs.create({ url: "chrome://settings/downloads" }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true });
    });

    return true;
  }

  if (message?.type !== "FLOW_TOOLS_DOWNLOAD") return false;

  chrome.downloads.download(
    {
      url: message.url,
      filename: message.filename,
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true, downloadId });
    }
  );

  return true;
});

globalThis.__HS_NAV_PREVIEW_ERRORS__ = [];
document.documentElement.dataset.hsNavErrors = "0";
function recordPreviewError(value) {
  globalThis.__HS_NAV_PREVIEW_ERRORS__.push(String(value));
  document.documentElement.dataset.hsNavErrors = String(globalThis.__HS_NAV_PREVIEW_ERRORS__.length);
}
const originalConsoleError = console.error;
console.error = (...values) => {
  recordPreviewError(values.map(String).join(" "));
  originalConsoleError(...values);
};
addEventListener("error", (event) => recordPreviewError(event.message));
addEventListener("unhandledrejection", (event) => {
  setTimeout(() => {
    if (!event.defaultPrevented) recordPreviewError(event.reason);
  });
});

const response = await fetch("../dist/navigation.json");
const { navigation } = await response.json();
const listeners = [];
const localValues = {
  hsNavDefaultsV2: navigation,
  hsNavRecents: ["home", "workflows", "campaigns", "seo", "sales-workspace"].map((id, index) => ({
    id,
    keyword: navigation.find((route) => route.id === id)?.keyword ?? id,
    usedAt: Date.now() - index * 60_000
  }))
};
const syncValues = {
  hsNavFavoriteIds: ["reports", "deals", "contacts"],
  "hsNavCustom:preview-contacts": {
    id: "preview-contacts",
    keyword: "Contacts",
    path: "/contacts/INSTANCE_ID/objects/0-1/views/all/list",
    source: "custom"
  }
};
let storageDenied = false;

function createStorageArea(values) {
  return {
    get(keys, callback) {
      if (storageDenied) {
        globalThis.chrome.runtime.lastError = { message: "Access to storage is not allowed from this context." };
        callback({});
        globalThis.chrome.runtime.lastError = null;
        return;
      }
      if (keys == null) {
        callback({ ...values });
        return;
      }
      const selected = Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(selected.filter((key) => key in values).map((key) => [key, values[key]])));
    },
    set(next, callback) {
      if (storageDenied) {
        globalThis.chrome.runtime.lastError = { message: "Access to storage is not allowed from this context." };
        callback?.();
        globalThis.chrome.runtime.lastError = null;
        return;
      }
      Object.assign(values, next);
      callback?.();
    },
    remove(keys, callback) {
      if (storageDenied) {
        globalThis.chrome.runtime.lastError = { message: "Access to storage is not allowed from this context." };
        callback?.();
        globalThis.chrome.runtime.lastError = null;
        return;
      }
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      callback?.();
    }
  };
}

globalThis.chrome = {
  runtime: {
    lastError: null,
    async sendMessage(request) {
      if (request.action === "ensure-storage") return { ok: true };
      if (request.action === "consume-route-attempt") return {};
      if (request.action === "open-options") {
        location.assign("../dist/options.html?preview=1");
        return { ok: true };
      }
      return { ok: true };
    },
    onMessage: { addListener(listener) { listeners.push(listener); } },
  },
  storage: {
    local: createStorageArea(localValues),
    sync: createStorageArea(syncValues),
    session: createStorageArea({}),
    onChanged: { addListener() {} }
  }
};

globalThis.__HS_NAV_PREVIEW__ = true;
globalThis.__HS_NAV_PREVIEW_URL__ = "https://app.hubspot.com/contacts/12345678/objects/0-1";
await import("../dist/contentScript.js?v=10");
const parameters = new URLSearchParams(location.search);
const togglePreview = () => {
  for (const listener of listeners) listener({ action: "toggle-search-bar" });
};
globalThis.__HS_NAV_TOGGLE__ = togglePreview;
setTimeout(() => {
  storageDenied = parameters.has("recovery");
  if (!parameters.has("manual")) togglePreview();
  if (parameters.has("unhandled")) {
    new Promise((resolve, reject) => {
      chrome.storage.local.get("probe", () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }
}, 50);

// Runs on extension install or update
chrome.runtime.onInstalled.addListener(async (details) => {
  // 1. Always overwrite the extension defaults (hubspotNavDataDefaults)
  //    with whatever is in navigation.json
  const res = await fetch(chrome.runtime.getURL("navigation.json"));
  const data = await res.json();  // e.g. { "navigation": [ ... ] }
  const newDefaults = data.navigation;

  // Overwrite defaults in storage
  await chrome.storage.sync.set({ hubspotNavDataDefaults: newDefaults });
  console.log("[HubSpotNav] Updated extension defaults in storage.");

  // 2. If this is a fresh install, initialize the user's custom data if absent
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
      if (!items.hubspotNavDataCustom) {
        chrome.storage.sync.set({ hubspotNavDataCustom: [] }, () => {
          console.log("[HubSpotNav] Initialized empty custom data array.");
        });
      }
    });
  }
});

// Listen for the keyboard shortcut command and toggle the search bar
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open_search_bar") {
    // Find the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https:\/\/(app\.hubspot\.com|app-eu1\.hubspot\.com)\//.test(tab.url)) {
      chrome.tabs.sendMessage(tab.id, { action: "toggle-search-bar" });
    }
  }
});

// Listen for the browser action click and toggle the search bar
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.url && /^https:\/\/(app\.hubspot\.com|app-eu1\.hubspot\.com)\//.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { action: "toggle-search-bar" });
  } else {
    // Optionally, let the user know they need to be on a HubSpot page.
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "HS Nav",
      message: "Please navigate to a HubSpot page before using the search."
    });
  }
});

import { getStorage, initializeStorage, removeStorage, setStorage } from "../platform/storage.mjs";
import { createActionHandler } from "./action.mjs";
import { createMessageHandler } from "./messages.mjs";

chrome.runtime.onInstalled.addListener(() => initializeStorage().catch(console.error));
chrome.runtime.onStartup.addListener(() => initializeStorage().catch(console.error));
initializeStorage().catch(console.error);

function openOptionsTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

chrome.runtime.onMessage.addListener(createMessageHandler({
  getStorage,
  initializeStorage,
  openOptionsTab,
  removeStorage,
  setStorage
}));

async function showActionFeedback(tab, { color, text, title }) {
  const scope = tab?.id ? { tabId: tab.id } : {};
  await chrome.action.setBadgeBackgroundColor({ color, ...scope });
  await chrome.action.setBadgeText({ text, ...scope });
  await chrome.action.setTitle({ title, ...scope });
}

const toggleSearch = createActionHandler({
  clearFeedback: async (tab) => {
    const scope = tab?.id ? { tabId: tab.id } : {};
    await chrome.action.setBadgeText({ text: "", ...scope });
    await chrome.action.setTitle({ title: "Open HS Nav", ...scope });
  },
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  showFeedback: showActionFeedback
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_search_bar") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleSearch(tab);
});

chrome.action.onClicked.addListener(toggleSearch);

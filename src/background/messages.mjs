import { KEYS } from "../platform/storage.mjs";

export function createMessageHandler({ getStorage, initializeStorage, openOptionsTab, removeStorage, setStorage }) {
  return (message, sender, sendResponse) => {
    let operation;
    if (message?.action === "ensure-storage") {
      operation = initializeStorage().then(() => ({ ok: true }));
    } else if (message?.action === "record-route-attempt") {
      operation = withTabId(sender, (tabId) => setStorage("session", {
        [`${KEYS.attemptPrefix}${tabId}`]: message.attempt
      }).then(() => ({ ok: true })));
    } else if (message?.action === "consume-route-attempt") {
      operation = withTabId(sender, async (tabId) => {
        const tabKey = `${KEYS.attemptPrefix}${tabId}`;
        const session = await getStorage("session", [tabKey, KEYS.attempt]);
        await removeStorage("session", [tabKey, KEYS.attempt]);
        return { ok: true, attempt: session[tabKey] ?? session[KEYS.attempt] };
      });
    } else if (message?.action === "open-options") {
      operation = openOptionsTab().then(() => ({ ok: true }));
    } else {
      return false;
    }
    operation.then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };
}

function withTabId(sender, operation) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return Promise.reject(new Error("The sending HubSpot tab could not be identified."));
  return operation(tabId);
}

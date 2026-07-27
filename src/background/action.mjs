import { isSupportedHubSpotContext } from "../shared/routes.mjs";

export function createActionHandler({ clearFeedback = async () => {}, sendMessage, showFeedback }) {
  return async function toggleSearch(tab) {
    if (tab?.id && isSupportedHubSpotContext(tab.url ?? "")) {
      try {
        await sendMessage(tab.id, { action: "toggle-search-bar" });
        await clearFeedback(tab);
      } catch {
        await showFeedback(tab, {
          color: "#b4232c",
          text: "!",
          title: "Reload this HubSpot tab to reconnect HS Nav"
        });
      }
      return;
    }
    await showFeedback(tab, {
      color: "#425b76",
      text: "HS",
      title: "Open a HubSpot tab to use HS Nav"
    });
  };
}

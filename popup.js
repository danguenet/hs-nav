document.getElementById("searchHubSpot").addEventListener("click", async () => {
  // Query the active tab in the current window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && /^https:\/\/(app\.hubspot\.com|app-eu1\.hubspot\.com)\//.test(tab.url)) {
    // Send a message to the content script to toggle the search bar
    chrome.tabs.sendMessage(tab.id, { action: "toggle-search-bar" });
  } else {
    // If they're not on a HubSpot page, optionally alert them
    alert("Please navigate to a HubSpot page to use the search bar.");
  }
});

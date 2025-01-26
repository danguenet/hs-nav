let overlay = null;
let container = null;
let inputElement = null;
let suggestionBox = null;
let isVisible = false;

function initUI() {
  if (overlay && container) return; // Already created

  // === 1) Inject styles for focusing suggestions, etc.
  const style = document.createElement("style");
  style.textContent = `
    .hs-nav-suggestion-item:focus {
      outline: none;
      background-color: #eaf2fe;
      border-radius: 4px;
    }
    /* Make sure we handle overflow in container if it gets large */
    .hs-nav-container {
      display: flex;
      flex-direction: column;
      max-height: 80vh;     /* So it never exceeds viewport height */
      overflow-y: auto;     /* Scroll within the container if necessary */
    }
  `;
  document.head.appendChild(style);

  // === 2) Create an overlay (behind the search bar) ===
  overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.background = "rgba(0, 0, 0, 0.2)";
  overlay.style.backdropFilter = "blur(5px)";
  overlay.style.zIndex = "999998";
  overlay.style.display = "none";
  document.body.appendChild(overlay);

  // Close if user clicks outside the container
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      toggleUI(false);
    }
  });

  // === 3) Create the container (white box) in the absolute center ===
  container = document.createElement("div");
  container.classList.add("hs-nav-container");
  container.style.position = "fixed";
  container.style.top = "50%";
  container.style.left = "50%";
  container.style.transform = "translate(-50%, -50%)";
  container.style.zIndex = "999999";
  container.style.width = "500px";
  container.style.border = "1px solid #ccc";
  container.style.borderRadius = "8px";
  container.style.boxShadow = "0px 4px 12px rgba(0,0,0,0.1)";
  container.style.background = "#fff";
  container.style.display = "none";
  container.style.fontFamily = "sans-serif";
  container.style.padding = "1rem";
  container.style.boxSizing = "border-box";
  container.style.textAlign = "left";

  // === 4) Create the input field ===
  inputElement = document.createElement("input");
  inputElement.type = "text";
  inputElement.setAttribute("tabindex", "0");
  inputElement.style.width = "100%";
  inputElement.style.fontSize = "16px";
  inputElement.style.padding = "8px";
  inputElement.style.boxSizing = "border-box";
  inputElement.placeholder = "Search HubSpot...";

  container.appendChild(inputElement);

  // === 5) Create the suggestion box (normal flow, so container grows) ===
  suggestionBox = document.createElement("div");
  suggestionBox.style.marginTop = "8px";
  suggestionBox.style.border = "1px solid #ddd";
  suggestionBox.style.background = "#fff";
  suggestionBox.style.borderRadius = "4px";
  suggestionBox.style.display = "none";

  container.appendChild(suggestionBox);

  // Add container to body
  document.body.appendChild(container);

  // === 6) Event listeners for input, etc.
  inputElement.addEventListener("input", onSearchInput);

  // Handle Enter/Escape/ArrowDown/Tab from the input
  inputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSelection();
    } else if (event.key === "Escape") {
      event.preventDefault();
      toggleUI(false);
    } else if (event.key === "ArrowDown") {
      // Move focus to the first suggestion item (if any)
      const items = suggestionBox.querySelectorAll(".hs-nav-suggestion-item");
      if (items.length > 0) {
        event.preventDefault();
        items[0].focus();
      }
    } else if (event.key === "Tab") {
      // We want to keep focus cycling through suggestions
      const items = suggestionBox.querySelectorAll(".hs-nav-suggestion-item");
      if (items.length > 0) {
        event.preventDefault();

        // If SHIFT + Tab, go to the last item, else go to the first item
        if (event.shiftKey) {
          items[items.length - 1].focus();
        } else {
          items[0].focus();
        }
      }
    }
  });

  // Close if user presses Escape anywhere (and is visible)
  document.addEventListener("keydown", (e) => {
    if (isVisible && e.key === "Escape") {
      toggleUI(false);
    }
  });
}

/**
 * Show/hide the UI
 * @param {boolean} [forceState] - If provided, explicitly sets the visibility to true/false
 */
function toggleUI(forceState) {
  initUI();

  if (typeof forceState === "boolean") {
    isVisible = forceState;
  } else {
    isVisible = !isVisible;
  }

  overlay.style.display = isVisible ? "block" : "none";
  container.style.display = isVisible ? "block" : "none";

  if (isVisible) {
    // Clear input & suggestions
    inputElement.value = "";
    inputElement.focus();
    suggestionBox.innerHTML = "";
    suggestionBox.style.display = "none";
  }
}

function onSearchInput(e) {
  const value = e.target.value.trim().toLowerCase();

  // If empty, hide suggestions
  if (!value) {
    suggestionBox.innerHTML = "";
    suggestionBox.style.display = "none";
    return;
  }

  // Retrieve combined data (defaults + custom) or just one set
  chrome.storage.sync.get(["hubspotNavDataDefaults", "hubspotNavDataCustom"], (items) => {
    const defaults = items.hubspotNavDataDefaults || [];
    const custom = items.hubspotNavDataCustom || [];
    const combined = [...defaults, ...custom];

    // Filter
    const results = combined.filter(item =>
      item.keyword.toLowerCase().includes(value)
    );
    renderSuggestions(results);
  });
}

function renderSuggestions(results) {
  suggestionBox.innerHTML = "";

  if (results.length === 0) {
    suggestionBox.style.display = "none";
    return;
  }
  suggestionBox.style.display = "block";

  results.forEach(result => {
    const div = document.createElement("div");
    div.classList.add("hs-nav-suggestion-item");
    div.style.padding = "8px";
    div.style.cursor = "pointer";
    div.setAttribute("tabindex", "0");

    div.textContent = result.keyword;

    // Click or Enter key selects
    div.addEventListener("click", () => selectSuggestion(result.keyword));
    div.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        selectSuggestion(result.keyword);
      } else if (evt.key === "Escape") {
        toggleUI(false);
      } 
      // Up/Down arrow cycling
      else if (evt.key === "ArrowDown") {
        evt.preventDefault();
        focusNextSuggestion(div);
      } else if (evt.key === "ArrowUp") {
        evt.preventDefault();
        focusPrevSuggestion(div);
      }
      // Tab/Shift+Tab cycling
      else if (evt.key === "Tab") {
        evt.preventDefault();
        if (evt.shiftKey) {
          focusPrevSuggestion(div);
        } else {
          focusNextSuggestion(div);
        }
      }
    });

    suggestionBox.appendChild(div);
  });
}

/** 
 * Move focus to the next suggestion item, or wrap back to the first 
 */
function focusNextSuggestion(currentItem) {
  const items = Array.from(suggestionBox.querySelectorAll(".hs-nav-suggestion-item"));
  const currentIndex = items.indexOf(currentItem);
  let nextIndex = currentIndex + 1;
  if (nextIndex >= items.length) {
    nextIndex = 0; // wrap around if at the bottom
  }
  items[nextIndex].focus();
}

/** 
 * Move focus to the previous suggestion item, or go back to input if at the first 
 */
function focusPrevSuggestion(currentItem) {
  const items = Array.from(suggestionBox.querySelectorAll(".hs-nav-suggestion-item"));
  const currentIndex = items.indexOf(currentItem);
  let prevIndex = currentIndex - 1;

  // If user presses up or Shift+Tab on the first item, focus goes back to the input
  if (prevIndex < 0) {
    inputElement.focus();
    return;
  }
  items[prevIndex].focus();
}

function selectSuggestion(keyword) {
  inputElement.value = keyword;
  handleSelection();
}

function handleSelection() {
  const value = inputElement.value.trim().toLowerCase();

  chrome.storage.sync.get(["hubspotNavDataDefaults", "hubspotNavDataCustom"], (items) => {
    const defaults = items.hubspotNavDataDefaults || [];
    const custom = items.hubspotNavDataCustom || [];
    const combined = [...defaults, ...custom];

    const match = combined.find(item => item.keyword.toLowerCase() === value);
    if (match) {
      const instanceId = getInstanceIdFromUrl(window.location.href);
      let newUrl;

      if (instanceId) {
        // Replace INSTANCE_ID in the matched path
        newUrl = `https://app.hubspot.com${match.path.replace("INSTANCE_ID", instanceId)}`;
      } else {
        // Redirect to /myaccounts-beta if no instance ID is found
        newUrl = `https://app.hubspot.com/myaccounts-beta`;
      }

      window.location.href = newUrl;
    }
    toggleUI(false);
  });
}

function getInstanceIdFromUrl(url) {
  // Extract instance ID from the URL
  const parts = url.split("/");
  for (let part of parts) {
    if (/^\d+$/.test(part)) {
      return part;
    }
  }
  return null; // Return null if no instance ID is found
}

// Listen for messages from background (icon click or keyboard shortcut)
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "toggle-search-bar") {
    toggleUI();
  }
});

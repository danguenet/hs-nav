const navPairsContainer = document.getElementById("navPairs");
const newKeywordEl = document.getElementById("newKeyword");
const newPathEl = document.getElementById("newPath");
const addBtn = document.getElementById("addBtn");

// Load existing user custom links from storage
function loadCustomLinks() {
  chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
    const customLinks = items.hubspotNavDataCustom || [];
    renderNavPairs(customLinks);
  });
}

// Render the custom links in the Options page
function renderNavPairs(customLinks) {
  navPairsContainer.innerHTML = "";
  customLinks.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "pair";
    div.innerHTML = `
      <label>Keyword:</label>
      <input type="text" data-index="${index}" data-field="keyword" value="${item.keyword}"/>
      <label>Path:</label>
      <input type="text" data-index="${index}" data-field="path" value="${item.path}"/>
      <button data-index="${index}" class="updateBtn">Update</button>
      <button data-index="${index}" class="deleteBtn">Delete</button>
    `;
    navPairsContainer.appendChild(div);
  });

  // Attach event listeners to inputs, update, and delete buttons
  const inputs = navPairsContainer.querySelectorAll("input");
  inputs.forEach(input => {
    input.addEventListener("change", onPairChange);
  });

  const updateButtons = navPairsContainer.querySelectorAll(".updateBtn");
  updateButtons.forEach(btn => {
    btn.addEventListener("click", onUpdatePair);
  });

  const delButtons = navPairsContainer.querySelectorAll(".deleteBtn");
  delButtons.forEach(btn => {
    btn.addEventListener("click", onDeletePair);
  });
}

// When user edits a field (keyword or path), update storage
function onPairChange(e) {
  const index = e.target.getAttribute("data-index");
  const field = e.target.getAttribute("data-field");
  const newValue = e.target.value;

  chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
    const customLinks = items.hubspotNavDataCustom || [];
    customLinks[index][field] = newValue;
    chrome.storage.sync.set({ hubspotNavDataCustom: customLinks });
  });
}

// When user clicks "Update"
function onUpdatePair(e) {
  const index = e.target.getAttribute("data-index");
  const keywordInput = navPairsContainer.querySelector(`input[data-index="${index}"][data-field="keyword"]`);
  const pathInput = navPairsContainer.querySelector(`input[data-index="${index}"][data-field="path"]`);
  
  const updatedKeyword = keywordInput.value.trim();
  const updatedPath = pathInput.value.trim();

  if (!updatedKeyword || !updatedPath) return;

  chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
    const customLinks = items.hubspotNavDataCustom || [];
    customLinks[index] = { keyword: updatedKeyword, path: updatedPath };
    chrome.storage.sync.set({ hubspotNavDataCustom: customLinks }, () => {
      loadCustomLinks(); // refresh the list
    });
  });
}

// When user clicks "Delete"
function onDeletePair(e) {
  const index = e.target.getAttribute("data-index");
  chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
    let customLinks = items.hubspotNavDataCustom || [];
    customLinks.splice(index, 1);
    chrome.storage.sync.set({ hubspotNavDataCustom: customLinks }, () => {
      loadCustomLinks(); // re-render
    });
  });
}

// Handle "Add" button
addBtn.addEventListener("click", () => {
  const keyword = newKeywordEl.value.trim();
  const path = newPathEl.value.trim();
  if (!keyword || !path) return;

  chrome.storage.sync.get("hubspotNavDataCustom", (items) => {
    const customLinks = items.hubspotNavDataCustom || [];
    customLinks.push({ keyword, path });
    chrome.storage.sync.set({ hubspotNavDataCustom: customLinks }, () => {
      newKeywordEl.value = "";
      newPathEl.value = "";
      loadCustomLinks(); // refresh list
    });
  });
});

// Load existing custom links on page load
document.addEventListener("DOMContentLoaded", loadCustomLinks);

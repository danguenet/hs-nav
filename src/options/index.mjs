import { hydrateRoute, mergeRoutes, validateCustomRoute } from "../shared/routes.mjs";
import { validateFavoriteIds } from "../shared/favorites.mjs";
import {
  KEYS,
  deleteCustomRoute,
  initializeStorage,
  loadState,
  removeStorage,
  replaceCustomRoutes,
  replaceSettings as replaceStoredSettings,
  saveCustomRoute,
  setStorage
} from "../platform/storage.mjs";
import { mountBackupView } from "./backup.mjs";
import { createDestinationsView } from "./destinations.mjs";
import { createPersonalizationView } from "./personalization.mjs";

const elementIds = [
  "addRoute", "applicationStatus", "applicationStatusMessage", "cancelEdit", "drawerLayer", "drawerScrim", "drawerTitle",
  "downloadFile", "exportData", "favoriteList", "formStatus", "importData", "importMode", "insertInstanceId", "keyword", "path", "pathMode", "pathPreview", "pathPreviewValue", "personalizationStatus", "replaceInstanceId",
  "resetCustom", "resetFavorites", "resetRecents", "retryStart", "routeDrawer", "routeForm",
  "routeId", "routeList", "routeSearch", "routeTypeFilter", "transferData", "transferStatus", "uploadFile", "uploadInput", "useCurrentSubdomain", "visibleCount"
];
const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));
const isPreview = !globalThis.chrome?.storage?.local;
let state;
let previewState;

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

async function withBusy(target, operation) {
  const controls = target.matches?.("button, input, select, textarea")
    ? [target]
    : [...target.querySelectorAll("button, input, select, textarea")];
  const previousDisabled = controls.map((control) => control.disabled);
  target.setAttribute("aria-busy", "true");
  controls.forEach((control) => { control.disabled = true; });
  try {
    return await operation();
  } finally {
    target.removeAttribute("aria-busy");
    controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
  }
}

function rebuildPreviewState() {
  previewState.routes = mergeRoutes(previewState.defaults, previewState.custom);
  return previewState;
}

async function initializeData() {
  if (!isPreview) {
    await initializeStorage();
    return;
  }
  const response = await fetch("navigation.json");
  if (!response.ok) throw new Error(`Could not load the navigation catalog (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload.navigation)) throw new Error("The navigation catalog is invalid.");
  const defaults = payload.navigation.map((route) => hydrateRoute(route));
  const custom = [
    validateCustomRoute({
      id: "preview-contacts",
      keyword: "Contacts",
      path: "/contacts/INSTANCE_ID/objects/0-1/views/all/list"
    }),
    validateCustomRoute({
      id: "preview-success",
      keyword: "Customer success workspace",
      path: "/service/INSTANCE_ID/customer-success"
    })
  ];
  previewState = {
    defaults,
    custom,
    favoriteIds: ["reports", "deals", "contacts"],
    recents: [],
    portals: {}
  };
  rebuildPreviewState();
}

async function readState() {
  return isPreview ? rebuildPreviewState() : loadState();
}

async function persistRoute(route) {
  if (isPreview) {
    previewState.custom = [...previewState.custom.filter((item) => item.id !== route.id), route];
    rebuildPreviewState();
    return;
  }
  await saveCustomRoute(route);
}

async function removeRoute(id) {
  if (isPreview) {
    previewState.custom = previewState.custom.filter((item) => item.id !== id);
    rebuildPreviewState();
    return;
  }
  await deleteCustomRoute(id);
}

async function persistRoutes(routes) {
  if (isPreview) {
    previewState.custom = routes;
    rebuildPreviewState();
    return;
  }
  await replaceCustomRoutes(routes);
}

async function persistFavorites(favoriteIds) {
  const validatedFavoriteIds = validateFavoriteIds(favoriteIds);
  if (isPreview) {
    previewState.favoriteIds = validatedFavoriteIds;
    return;
  }
  await setStorage("sync", { [KEYS.favorites]: validatedFavoriteIds });
}

async function replaceSettings(routes, favoriteIds) {
  const validatedFavoriteIds = validateFavoriteIds(favoriteIds);
  if (isPreview) {
    previewState.custom = routes;
    previewState.favoriteIds = validatedFavoriteIds;
    rebuildPreviewState();
    return;
  }
  await replaceStoredSettings(routes, validatedFavoriteIds);
}

async function clearStored(area, key) {
  if (isPreview) {
    if (key === KEYS.favorites) previewState.favoriteIds = [];
    if (key === KEYS.recents) previewState.recents = [];
    return;
  }
  await removeStorage(area, key);
}

const actions = {
  clearStored,
  persistFavorites,
  persistRoute,
  persistRoutes,
  replaceSettings,
  refresh,
  removeRoute,
  setStatus,
  showToast,
  withBusy
};

const destinationsView = createDestinationsView({ elements, getState: () => state, actions });
const personalizationView = createPersonalizationView({ elements, getState: () => state, actions });
mountBackupView({ elements, getState: () => state, actions });

async function refresh() {
  state = await readState();
  destinationsView.render();
  personalizationView.render();
}

function activateView(name) {
  for (const button of document.querySelectorAll(".nav-item")) {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const view of document.querySelectorAll(".view")) {
    const active = view.id === `view-${name}`;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

async function start() {
  elements.applicationStatus.hidden = true;
  document.querySelector(".settings-main").setAttribute("aria-busy", "true");
  elements.retryStart.disabled = true;
  try {
    await initializeData();
    await refresh();
  } finally {
    document.querySelector(".settings-main").removeAttribute("aria-busy");
    elements.retryStart.disabled = false;
  }
}

start().catch((error) => {
  elements.applicationStatusMessage.textContent = `HS Nav settings could not load: ${error.message}`;
  elements.applicationStatus.hidden = false;
});

elements.retryStart.addEventListener("click", () => start().catch((error) => {
  elements.applicationStatusMessage.textContent = `HS Nav settings could not load: ${error.message}`;
  elements.applicationStatus.hidden = false;
}));

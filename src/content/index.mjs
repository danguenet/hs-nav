import {
  buildDestination,
  isExtensionContextUnavailable,
  portalFromUrl
} from "../shared/routes.mjs";
import {
  loadState,
  recordRecent,
  rememberPortal,
  toggleFavorite
} from "../platform/storage.mjs";
import { createOverlay } from "./overlay.mjs";
import { showRouteOutcome } from "./route-outcome.mjs";

let state = { routes: [], favoriteIds: [], recents: [], portals: {} };

const overlay = createOverlay({
  getState: () => state,
  onNavigate: navigate,
  onOpenOptions: async () => {
    const response = await chrome.runtime.sendMessage({ action: "open-options" });
    if (!response?.ok) throw new Error(response?.error || "Could not open HS Nav settings.");
  },
  onRetry: refreshState,
  onToggleFavorite: async (id) => {
    state.favoriteIds = await toggleFavorite(id);
  },
  onError: reportRuntimeError
});

async function refreshState() {
  state = await loadState();
  overlay.refresh();
}

function reportRuntimeError(error) {
  if (isExtensionContextUnavailable(error)) {
    overlay.showReconnectNotice();
    return;
  }
  console.error(error);
  overlay.showError(error);
}

addEventListener("unhandledrejection", (event) => {
  if (!isExtensionContextUnavailable(event.reason)) return;
  event.preventDefault();
  reportRuntimeError(event.reason);
});

async function navigate(route) {
  const currentUrl = globalThis.__HS_NAV_PREVIEW_URL__ ?? location.href;
  const portal = portalFromUrl(currentUrl, state.routes);
  const remembered = portal || state.portals[location.origin];
  const destination = buildDestination(route, currentUrl, remembered, state.routes);
  const attempt = { id: route.id, keyword: route.keyword, path: route.path, source: route.source, destination, requestedAt: Date.now() };
  await Promise.allSettled([
    portal ? rememberPortal(location.origin, portal) : Promise.resolve(),
    recordRecent(route),
    Promise.resolve().then(() => chrome.runtime.sendMessage({ action: "record-route-attempt", attempt }))
  ]);
  if (globalThis.__HS_NAV_PREVIEW__) {
    globalThis.__HS_NAV_LAST_DESTINATION__ = destination;
    overlay.close();
  } else {
    location.assign(destination);
  }
}

async function start() {
  const initialized = await chrome.runtime.sendMessage({ action: "ensure-storage" });
  if (!initialized?.ok) throw new Error(initialized?.error || "Could not initialize HS Nav storage.");
  await refreshState();
  const currentPortal = portalFromUrl(location.href, state.routes);
  if (currentPortal) await rememberPortal(location.origin, currentPortal);
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action !== "toggle-search-bar") return;
    refreshState().then(overlay.open).catch(reportRuntimeError);
  });
  showRouteOutcome({
    ensureRoot: overlay.ensureRoot,
    sendMessage: (message) => chrome.runtime.sendMessage(message)
  }).catch(reportRuntimeError);
}

start().catch(reportRuntimeError);

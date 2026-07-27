import { rankRoutes, routeIdentity } from "../shared/routes.mjs";
import { overlayStyles } from "./styles.mjs";

export function createOverlay({ getState, onNavigate, onOpenOptions, onRetry, onToggleFavorite, onError }) {
  let results = [];
  let activeIndex = 0;
  let host;
  let shadow;
  let dialog;
  let input;
  let resultsList;
  let status;
  let previousFocus;
  let favoriteCount = 0;
  let navigating = false;

  function ensureRoot() {
    if (host) return shadow;
    host = document.createElement("hs-nav-root");
    shadow = host.attachShadow({ mode: globalThis.__HS_NAV_PREVIEW__ ? "open" : "closed" });
    const style = document.createElement("style");
    style.textContent = overlayStyles;
    shadow.append(style);
    document.documentElement.append(host);
    return shadow;
  }

  function showReconnectNotice() {
    showNotice({
      className: "reconnect-notice",
      message: "HS Nav was updated. Reload this HubSpot tab to reconnect it to the extension.",
      role: "alert",
      actionLabel: "Reload HubSpot",
      onAction: () => location.reload()
    });
  }

  function showError(error) {
    showNotice({
      className: "error-notice",
      message: `HS Nav could not load: ${error?.message ?? error}`,
      role: "alert",
      actionLabel: "Try again",
      onAction: async (notice) => {
        const button = notice.querySelector("button");
        button.disabled = true;
        button.textContent = "Retrying…";
        try {
          await onRetry();
          notice.remove();
          open();
        } catch (retryError) {
          button.disabled = false;
          button.textContent = "Try again";
          notice.querySelector(".notice-message").textContent = `HS Nav could not load: ${retryError.message}`;
        }
      }
    });
  }

  function showNotice({ className, message, role, actionLabel, onAction }) {
    const root = ensureRoot();
    root.querySelector(`.${className}`)?.remove();
    const notice = document.createElement("aside");
    notice.className = `notice ${className}`;
    notice.setAttribute("role", role);
    const messageElement = document.createElement("div");
    messageElement.className = "notice-message";
    messageElement.textContent = message;
    const actions = document.createElement("div");
    actions.className = "notice-actions";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = actionLabel;
    action.addEventListener("click", () => onAction(notice));
    actions.append(action);
    notice.append(messageElement, actions);
    root.append(notice);
  }

  function open() {
    const root = ensureRoot();
    if (dialog) return close();
    previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) close(); });

    dialog = document.createElement("section");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Navigate HubSpot");
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll('input, button:not([tabindex="-1"])')].filter((element) => !element.disabled);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && shadow.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && shadow.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const row = document.createElement("div");
    row.className = "search-row";
    input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search destinations…";
    input.setAttribute("aria-label", "Search destinations");
    input.setAttribute("aria-controls", "hs-nav-results");
    input.setAttribute("aria-describedby", "hs-nav-status");
    input.addEventListener("input", updateResults);
    input.addEventListener("keydown", handleSearchKeys);
    row.append(input);

    resultsList = document.createElement("div");
    resultsList.id = "hs-nav-results";
    resultsList.className = "results";
    resultsList.setAttribute("role", "list");
    resultsList.setAttribute("aria-label", "HubSpot destinations");

    status = document.createElement("div");
    status.id = "hs-nav-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.className = "status";

    const footer = document.createElement("div");
    footer.className = "footer";
    const hints = document.createElement("span");
    hints.className = "hints";
    hints.setAttribute("aria-label", "Keyboard shortcuts: Up and Down to navigate, Tab for actions, Enter to open, Escape to close");
    addHint(hints, [["↑", "↓"]], "Navigate");
    addHint(hints, [["Tab"]], "Actions");
    addHint(hints, [["Enter"]], "Open");
    addHint(hints, [["Esc"]], "Close");
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "settings";
    settings.textContent = "Settings";
    settings.addEventListener("click", async () => {
      settings.disabled = true;
      try {
        await onOpenOptions();
        close();
      } catch (error) {
        settings.disabled = false;
        onError(error);
      }
    });
    footer.append(hints, settings);

    dialog.append(row, resultsList, footer, status);
    backdrop.append(dialog);
    root.append(backdrop);
    updateResults();
    input.focus();
  }

  function close() {
    shadow?.querySelector(".backdrop")?.remove();
    dialog = input = resultsList = status = null;
    navigating = false;
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function handleSearchKeys(event) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
      event.preventDefault();
      focusRoute(event.key === "ArrowDown" ? 0 : results.length - 1);
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      navigate(results[activeIndex]);
    }
  }

  function handleResultKeys(event, index) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? results.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    focusRoute(nextIndex);
  }

  function focusRoute(index) {
    activeIndex = index;
    updateActiveResult();
    resultsList?.querySelectorAll(".option-open")[index]?.focus();
  }

  function updateActiveResult() {
    resultsList?.querySelectorAll(".option").forEach((element, index) => {
      element.dataset.active = String(index === activeIndex);
    });
  }

  function updateResults() {
    if (!input) return;
    const state = getState();
    const query = input.value.trim();
    if (query) {
      results = rankRoutes(state.routes, query, state);
      favoriteCount = 0;
    } else {
      const byId = new Map(state.routes.map((route) => [routeIdentity(route), route]));
      const favorites = state.favoriteIds.map((id) => byId.get(id)).filter(Boolean);
      const included = new Set(favorites.map(routeIdentity));
      const recent = state.recents.map((item) => byId.get(item.id))
        .filter((route) => route && !included.has(routeIdentity(route)));
      results = [...favorites, ...recent].slice(0, 8);
      favoriteCount = Math.min(favorites.length, results.length);
    }
    activeIndex = 0;
    renderResults();
  }

  function renderResults() {
    if (!resultsList) return;
    const state = getState();
    resultsList.replaceChildren();
    const addGroupLabel = (text) => {
      const heading = document.createElement("div");
      heading.className = "group-label";
      heading.setAttribute("role", "presentation");
      heading.textContent = text;
      resultsList.append(heading);
    };
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = input.value.trim()
        ? "No matching destinations"
        : "No favorites or recent destinations yet. Start typing to search.";
      resultsList.append(empty);
    } else if (input.value.trim()) {
      addGroupLabel("Results");
    } else if (favoriteCount) {
      addGroupLabel("Favorites");
    } else {
      addGroupLabel("Recents");
    }
    results.forEach((route, index) => {
      if (!input.value.trim() && favoriteCount && index === favoriteCount) addGroupLabel("Recents");
      const option = document.createElement("div");
      option.className = "option";
      option.dataset.active = String(index === activeIndex);
      option.dataset.groupEnd = String(
        !input.value.trim() && (index === favoriteCount - 1 || index === results.length - 1)
      );
      option.setAttribute("role", "listitem");
      option.addEventListener("mousemove", () => {
        if (activeIndex !== index) {
          activeIndex = index;
          updateActiveResult();
        }
      });
      option.addEventListener("keydown", (event) => handleResultKeys(event, index));

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "option-open";
      openButton.textContent = route.keyword;
      openButton.setAttribute("aria-label", `Open ${route.keyword}`);
      openButton.addEventListener("focus", () => {
        activeIndex = index;
        updateActiveResult();
      });
      openButton.addEventListener("click", () => navigate(route));

      const favorite = document.createElement("button");
      favorite.className = "favorite";
      favorite.type = "button";
      favorite.tabIndex = 0;
      const id = routeIdentity(route);
      const isFavorite = state.favoriteIds.includes(id);
      favorite.textContent = isFavorite ? "★" : "☆";
      favorite.dataset.active = String(isFavorite);
      favorite.setAttribute("aria-pressed", String(isFavorite));
      favorite.setAttribute("aria-label", `${isFavorite ? "Remove" : "Add"} ${route.keyword} ${isFavorite ? "from" : "to"} favorites`);
      favorite.title = isFavorite ? "Remove from favorites" : "Add to favorites";
      favorite.addEventListener("focus", () => {
        activeIndex = index;
        updateActiveResult();
      });
      favorite.addEventListener("click", async () => {
        favorite.disabled = true;
        try {
          await onToggleFavorite(id);
          updateResults();
          resultsList.querySelectorAll(".favorite")[index]?.focus();
        } catch (error) {
          favorite.disabled = false;
          onError(error);
        }
      });
      option.append(openButton, favorite);
      resultsList.append(option);
    });
    status.textContent = `${results.length} destination${results.length === 1 ? "" : "s"} available.`;
  }

  async function navigate(route) {
    if (navigating) return;
    navigating = true;
    dialog?.setAttribute("aria-busy", "true");
    dialog?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await onNavigate(route);
    } catch (error) {
      navigating = false;
      dialog?.removeAttribute("aria-busy");
      dialog?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      onError(error);
    }
  }

  return { close, ensureRoot, open, refresh: updateResults, showError, showReconnectNotice };
}

function addHint(container, keyGroups, label) {
  const hint = document.createElement("span");
  hint.className = "hint";
  keyGroups.forEach((keys, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.textContent = "/";
      separator.setAttribute("aria-hidden", "true");
      hint.append(separator);
    }
    const keyGroup = document.createElement("span");
    keyGroup.className = "keys";
    keyGroup.setAttribute("aria-hidden", "true");
    for (const key of keys) {
      const keycap = document.createElement("kbd");
      keycap.textContent = key;
      keyGroup.append(keycap);
    }
    hint.append(keyGroup);
  });
  const text = document.createElement("span");
  text.className = "hint-label";
  text.textContent = label;
  hint.append(text);
  container.append(hint);
}

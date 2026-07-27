import {
  filterRouteCatalog,
  insertInstanceId,
  normalizeCustomPath,
  normalizeText,
  routeCatalogType,
  useCurrentAccount,
  useCurrentSubdomain,
  validateCustomRoute
} from "../shared/routes.mjs";

export function createDestinationsView({ elements, getState, actions }) {
  let lastFocusedElement;
  let drawerTimer;

  function routeType(route) {
    const key = routeCatalogType(route, getState().defaults);
    return {
      key,
      label: key === "override" ? "Overrides default" : key === "custom" ? "Custom" : "Default",
      className: key === "default" ? "" : "custom"
    };
  }

  function createTextButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function openDrawer(route = null) {
    clearTimeout(drawerTimer);
    lastFocusedElement = document.activeElement;
    elements.routeForm.reset();
    elements.routeId.value = route?.source === "custom" ? route.id : "";
    elements.keyword.value = route?.keyword ?? "";
    elements.path.value = route?.path ?? "";
    elements.drawerTitle.textContent = route?.source === "custom"
      ? "Edit destination"
      : route
        ? "Override destination"
        : "Add destination";
    actions.setStatus(elements.formStatus, "");
    updatePathPreview();
    elements.drawerLayer.hidden = false;
    requestAnimationFrame(() => {
      elements.drawerLayer.classList.add("is-open");
      elements.keyword.focus();
    });
  }

  function closeDrawer() {
    elements.drawerLayer.classList.remove("is-open");
    drawerTimer = setTimeout(() => {
      elements.drawerLayer.hidden = true;
      lastFocusedElement?.focus?.();
    }, 190);
  }

  function updatePathPreview() {
    elements.pathPreview.classList.remove("valid", "error");
    const value = elements.path.value.trim();
    if (!value) {
      elements.pathMode.hidden = true;
      elements.pathMode.textContent = "";
      elements.pathPreviewValue.textContent = "Enter a HubSpot URL or path to preview it.";
      elements.useCurrentSubdomain.disabled = false;
      elements.replaceInstanceId.disabled = false;
      elements.useCurrentSubdomain.setAttribute("aria-pressed", "false");
      elements.replaceInstanceId.setAttribute("aria-pressed", "false");
      return;
    }
    try {
      const normalized = normalizeCustomPath(value);
      const followsSubdomain = !normalized.startsWith("https://");
      const followsAccount = normalized.includes("INSTANCE_ID");
      elements.pathMode.hidden = false;
      elements.pathMode.textContent = [
        followsSubdomain ? "Path" : "Fixed subdomain",
        followsAccount ? "Account" : ""
      ].filter(Boolean).join(" · ");
      elements.pathPreviewValue.textContent = normalized;
      elements.pathPreview.classList.add("valid");
      elements.useCurrentSubdomain.disabled = followsSubdomain;
      elements.replaceInstanceId.disabled = followsAccount;
      elements.useCurrentSubdomain.setAttribute("aria-pressed", String(followsSubdomain));
      elements.replaceInstanceId.setAttribute("aria-pressed", String(followsAccount));
    } catch (error) {
      elements.pathMode.hidden = false;
      elements.pathMode.textContent = "Needs attention";
      elements.pathPreviewValue.textContent = error.message;
      elements.pathPreview.classList.add("error");
      elements.useCurrentSubdomain.disabled = false;
      elements.replaceInstanceId.disabled = false;
      elements.useCurrentSubdomain.setAttribute("aria-pressed", "false");
      elements.replaceInstanceId.setAttribute("aria-pressed", "false");
    }
  }

  function replaceAccountId() {
    try {
      const result = useCurrentAccount(elements.path.value, elements.path.selectionStart, elements.path.selectionEnd);
      elements.path.value = result.value;
      elements.path.focus();
      elements.path.setSelectionRange(result.selectionStart, result.selectionEnd);
      actions.setStatus(elements.formStatus, "");
    } catch (error) {
      actions.setStatus(elements.formStatus, error.message, true);
    }
    updatePathPreview();
  }

  function insertInstanceIdAtCursor() {
    const result = insertInstanceId(elements.path.value, elements.path.selectionStart, elements.path.selectionEnd);
    elements.path.value = result.value;
    elements.path.focus();
    elements.path.setSelectionRange(result.selectionStart, result.selectionEnd);
    updatePathPreview();
  }

  function followCurrentSubdomain() {
    try {
      elements.path.value = useCurrentSubdomain(elements.path.value);
      elements.path.focus();
      elements.path.setSelectionRange(elements.path.value.length, elements.path.value.length);
    } catch {}
    updatePathPreview();
  }

  function renderEmptyState() {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "No destinations match";
    const copy = document.createElement("p");
    copy.textContent = "Try a different search or type filter.";
    empty.append(title, copy);
    elements.routeList.append(empty);
  }

  function render() {
    const state = getState();
    elements.routeList.replaceChildren();
    const query = normalizeText(elements.routeSearch.value);
    const routes = filterRouteCatalog(state.routes, state.defaults, {
      query,
      type: elements.routeTypeFilter.value
    }).sort((a, b) => a.keyword.localeCompare(b.keyword));

    for (const route of routes) {
      const row = document.createElement("div");
      row.className = "route-row";

      const keyword = document.createElement("span");
      keyword.className = "route-keyword";
      keyword.textContent = route.keyword;
      keyword.title = route.keyword;

      const path = document.createElement("code");
      path.className = "route-path";
      path.textContent = route.path;
      path.title = route.path;

      const typeInfo = routeType(route);
      const type = document.createElement("span");
      type.className = `route-type ${typeInfo.className}`.trim();
      type.textContent = typeInfo.label;

      const rowActions = document.createElement("div");
      rowActions.className = "route-actions";
      rowActions.append(createTextButton(route.source === "custom" ? "Edit" : "Override", "text-button", () => openDrawer(route)));
      if (route.source === "custom") {
        const resetsOverride = typeInfo.key === "override";
        rowActions.append(createTextButton(resetsOverride ? "Reset override" : "Delete", "text-button delete", async (event) => {
          const confirmation = resetsOverride
            ? `Reset “${route.keyword}” to its maintained default destination?`
            : `Delete “${route.keyword}”?`;
          if (!confirm(confirmation)) return;
          try {
            await actions.withBusy(event.currentTarget, async () => {
              await actions.removeRoute(route.id);
              await actions.refresh();
            });
            actions.showToast(resetsOverride
              ? `Reset override for “${route.keyword}”.`
              : `Deleted “${route.keyword}”.`);
          } catch (error) {
            actions.showToast(`Could not update “${route.keyword}”: ${error.message}`);
          }
        }));
      }

      row.append(keyword, path, type, rowActions);
      elements.routeList.append(row);
    }

    if (!routes.length) renderEmptyState();
    elements.visibleCount.textContent = `${routes.length} destination${routes.length === 1 ? "" : "s"}`;
  }

  elements.addRoute.addEventListener("click", () => openDrawer());
  elements.cancelEdit.addEventListener("click", closeDrawer);
  elements.drawerScrim.addEventListener("click", closeDrawer);
  elements.path.addEventListener("input", updatePathPreview);
  elements.useCurrentSubdomain.addEventListener("click", followCurrentSubdomain);
  elements.replaceInstanceId.addEventListener("click", replaceAccountId);
  elements.insertInstanceId.addEventListener("click", insertInstanceIdAtCursor);
  elements.routeSearch.addEventListener("input", render);
  elements.routeTypeFilter.addEventListener("change", render);

  elements.routeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      let route;
      await actions.withBusy(elements.routeForm, async () => {
        const state = getState();
        const id = elements.routeId.value || uniqueId();
        route = validateCustomRoute({
          id,
          keyword: elements.keyword.value,
          path: elements.path.value
        }, state.custom);
        await actions.persistRoute(route);
        await actions.refresh();
      });
      closeDrawer();
      actions.showToast(`Saved “${route.keyword}”.`);
    } catch (error) {
      actions.setStatus(elements.formStatus, error.message, true);
    }
  });

  elements.resetCustom.addEventListener("click", async (event) => {
    if (!getState().custom.length) {
      actions.setStatus(elements.transferStatus, "There are no custom destinations to reset.");
      return;
    }
    if (!confirm("Delete every custom destination? Maintained destinations will remain.")) return;
    try {
      await actions.withBusy(event.currentTarget, async () => {
        await actions.persistRoutes([]);
        await actions.refresh();
      });
      actions.setStatus(elements.transferStatus, "Custom destinations reset.");
    } catch (error) {
      actions.setStatus(elements.transferStatus, error.message, true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.drawerLayer.hidden) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab" || elements.drawerLayer.hidden) return;
    const focusable = [...elements.routeDrawer.querySelectorAll("button, input, textarea")]
      .filter((element) => element.type !== "hidden" && !element.disabled && !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return { render };
}

function uniqueId() {
  return globalThis.crypto?.randomUUID?.() ?? `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

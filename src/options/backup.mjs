import { mergeImportedRoutes, mergeRoutes, validateCustomRoute } from "../shared/routes.mjs";
import { validateFavoriteIds } from "../shared/favorites.mjs";

const IMPORT_MODES = new Set(["append", "overwrite"]);

function routeSnapshot(route) {
  return JSON.stringify([String(route.id), route.keyword, route.path]);
}

function differenceCount(values, otherValues, identify = String) {
  const other = new Set(otherValues.map(identify));
  return values.filter((value) => !other.has(identify(value))).length;
}

function summarizeImport(state, routes, favoriteIds) {
  return {
    customAdded: differenceCount(routes, state.custom, routeSnapshot),
    customRemoved: differenceCount(state.custom, routes, routeSnapshot),
    favoritesAdded: differenceCount(favoriteIds, state.favoriteIds),
    favoritesRemoved: differenceCount(state.favoriteIds, favoriteIds)
  };
}

export function buildImportPlan(state, payload, mode = "append") {
  if (!IMPORT_MODES.has(mode)) throw new Error("Choose append or overwrite before restoring the backup.");
  if (payload?.version !== 1 || !Array.isArray(payload.customRoutes) || !Array.isArray(payload.favoriteIds)) {
    throw new Error("Expected an HS Nav version 1 export with custom routes and favorites.");
  }

  const importedFavoriteIds = validateFavoriteIds(payload.favoriteIds);
  const importedRoutes = [];
  const importedRouteIds = new Set();
  for (const raw of payload.customRoutes) {
    const id = String(raw?.id ?? "").trim();
    if (importedRouteIds.has(id)) throw new Error(`Duplicate route ID in backup: ${id}`);
    importedRouteIds.add(id);
    importedRoutes.push(validateCustomRoute(raw, importedRoutes));
  }
  const routes = mode === "append"
    ? mergeImportedRoutes(state.custom, importedRoutes).routes
    : importedRoutes;
  const favoriteIds = mode === "append"
    ? validateFavoriteIds([...state.favoriteIds, ...importedFavoriteIds])
    : importedFavoriteIds;
  if (Array.isArray(state.defaults) || Array.isArray(state.routes)) {
    const availableIds = new Set(mergeRoutes(state.defaults ?? [], routes).map((route) => route.logicalId ?? route.id));
    const missing = favoriteIds.filter((id) => !availableIds.has(id));
    if (missing.length) throw new Error(`Backup references unknown favorite destination${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }

  return {
    mode,
    routes,
    favoriteIds,
    summary: summarizeImport(state, routes, favoriteIds)
  };
}

export function buildImportPreview(plan) {
  const { mode, summary } = plan;
  return [
    `Restore behavior: ${mode === "append" ? "Append" : "Overwrite"}`,
    `Custom routes: ${summary.customAdded} added, ${summary.customRemoved} removed`,
    `Favorites: ${summary.favoritesAdded} added, ${summary.favoritesRemoved} removed`,
    "",
    "Apply this import?"
  ].join("\n");
}

function importStatus(plan) {
  const { mode, summary } = plan;
  return `${mode === "append" ? "Append" : "Overwrite"} import applied — custom routes: ${summary.customAdded} added, ${summary.customRemoved} removed; favorites: ${summary.favoritesAdded} added, ${summary.favoritesRemoved} removed.`;
}

export function mountBackupView({ elements, getState, actions }) {
  function syncImportAvailability() {
    elements.importData.disabled = !elements.transferData.value.trim();
  }

  function serializeExport() {
    const state = getState();
    return JSON.stringify({
      version: 1,
      customRoutes: state.custom,
      favoriteIds: state.favoriteIds
    }, null, 2);
  }

  elements.exportData.addEventListener("click", () => {
    const state = getState();
    elements.transferData.value = serializeExport();
    syncImportAvailability();
    elements.transferData.select();
    actions.setStatus(elements.transferStatus, `Export JSON is ready with ${state.custom.length} custom destination${state.custom.length === 1 ? "" : "s"}.`);
  });

  elements.downloadFile.addEventListener("click", () => {
    const state = getState();
    const blobUrl = URL.createObjectURL(new Blob([serializeExport()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `hs-nav-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    actions.setStatus(elements.transferStatus, `Downloaded ${state.custom.length} custom destination${state.custom.length === 1 ? "" : "s"}.`);
  });

  elements.uploadFile.addEventListener("click", () => elements.uploadInput.click());

  elements.uploadInput.addEventListener("change", async () => {
    const file = elements.uploadInput.files?.[0];
    if (!file) return;
    try {
      await actions.withBusy(elements.uploadFile, async () => {
        if (file.size > 1_000_000) throw new Error("Choose a backup file smaller than 1 MB.");
        elements.transferData.value = await file.text();
        syncImportAvailability();
      });
      actions.setStatus(elements.transferStatus, `Loaded “${file.name}”. Next, preview the changes before applying them.`);
      elements.importData.focus({ preventScroll: true });
    } catch (error) {
      actions.setStatus(elements.transferStatus, error.message, true);
    } finally {
      elements.uploadInput.value = "";
    }
  });

  elements.transferData.addEventListener("input", syncImportAvailability);
  syncImportAvailability();

  elements.importData.addEventListener("click", async (event) => {
    try {
      await actions.withBusy(event.currentTarget, async () => {
        const payload = JSON.parse(elements.transferData.value);
        const state = getState();
        const plan = buildImportPlan(state, payload, elements.importMode.value);
        if (!confirm(buildImportPreview(plan))) {
          actions.setStatus(elements.transferStatus, "Import cancelled after preview.");
          return;
        }
        await actions.replaceSettings(plan.routes, plan.favoriteIds);
        await actions.refresh();
        actions.setStatus(elements.transferStatus, importStatus(plan));
      });
    } catch (error) {
      actions.setStatus(elements.transferStatus, error.message, true);
    }
  });
}

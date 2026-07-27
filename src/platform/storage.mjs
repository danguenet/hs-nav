import { hydrateRoute, mergeRoutes, routeIdentity, validateCustomRoute } from "../shared/routes.mjs";
import { validateFavoriteIds } from "../shared/favorites.mjs";
import { isHubSpotUrl } from "../shared/hubspot.mjs";

export const KEYS = {
  defaults: "hsNavDefaultsV2",
  defaultsVersion: "hsNavDefaultsVersion",
  schema: "hsNavSchemaVersion",
  favorites: "hsNavFavoriteIds",
  recents: "hsNavRecents",
  portals: "hsNavPortalsByOrigin",
  attempt: "hsNavLastAttempt",
  attemptPrefix: "hsNavLastAttempt:",
  legacyDefaults: "hubspotNavDataDefaults",
  legacyCustom: "hubspotNavDataCustom",
  customPrefix: "hsNavCustom:"
};

const SCHEMA_VERSION = 2;

export function createStorageRepository({
  chromeApi = globalThis.chrome,
  fetchFn = globalThis.fetch,
  now = () => Date.now(),
  idFactory = () => globalThis.crypto?.randomUUID?.() ?? `legacy-${now()}-${Math.random().toString(16).slice(2)}`
} = {}) {
  const storage = (area, method, argument) => new Promise((resolve, reject) => {
    chromeApi.storage[area][method](argument, (result) => {
      const error = chromeApi.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });

  const getStorage = (area, keys) => storage(area, "get", keys);
  const setStorage = (area, values) => storage(area, "set", values);
  const removeStorage = (area, keys) => storage(area, "remove", keys);

  async function initializeStorage() {
    const defaultsVersion = chromeApi.runtime.getManifest?.().version ?? "unknown";
    const local = await getStorage("local", [KEYS.defaults, KEYS.defaultsVersion, KEYS.schema]);
    const needsDefaults = !Array.isArray(local[KEYS.defaults]) || local[KEYS.defaultsVersion] !== defaultsVersion;

    if (needsDefaults) {
      const response = await fetchFn(chromeApi.runtime.getURL("navigation.json"));
      if (!response?.ok) throw new Error(`Could not load the navigation catalog (HTTP ${response?.status ?? "unknown"}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.navigation)) throw new Error("The navigation catalog is invalid.");
      const defaults = payload.navigation.map((route) => hydrateRoute(route));
      await setStorage("local", {
        [KEYS.defaults]: defaults,
        [KEYS.defaultsVersion]: defaultsVersion
      });
    }

    if (local[KEYS.schema] === SCHEMA_VERSION) return;
    const allSync = await getStorage("sync", null);
    const hasV2Custom = Object.keys(allSync).some((key) => key.startsWith(KEYS.customPrefix));
    if (!hasV2Custom && Array.isArray(allSync[KEYS.legacyCustom])) {
      const migrated = {};
      for (const entry of allSync[KEYS.legacyCustom]) {
        const id = idFactory();
        try {
          const route = validateCustomRoute({ ...entry, id }, Object.values(migrated));
          migrated[`${KEYS.customPrefix}${id}`] = route;
        } catch (error) {
          console.warn(`[HS Nav] Skipped an invalid legacy custom route: ${error.message}`);
        }
      }
      if (Object.keys(migrated).length) await setStorage("sync", migrated);
    }
    await removeStorage("sync", [KEYS.legacyDefaults, KEYS.legacyCustom]);
    await setStorage("local", { [KEYS.schema]: SCHEMA_VERSION });
  }

  async function loadState() {
    const [local, sync] = await Promise.all([
      getStorage("local", [KEYS.defaults, KEYS.recents, KEYS.portals]),
      getStorage("sync", null)
    ]);
    const defaults = Array.isArray(local[KEYS.defaults]) ? local[KEYS.defaults] : [];
    const custom = [];
    const invalidCustomKeys = [];
    const normalizedCustom = {};
    for (const [key, value] of Object.entries(sync)) {
      if (!key.startsWith(KEYS.customPrefix)) continue;
      try {
        const route = validateCustomRoute(value, custom);
        if (key !== `${KEYS.customPrefix}${route.id}`) {
          throw new Error("The storage key does not match the route ID.");
        }
        custom.push(route);
        if (JSON.stringify(value) !== JSON.stringify(route)) normalizedCustom[key] = route;
      } catch (error) {
        invalidCustomKeys.push(key);
        console.warn(`[HS Nav] Removed invalid synced route ${key}: ${error.message}`);
      }
    }
    if (Object.keys(normalizedCustom).length) await setStorage("sync", normalizedCustom);
    if (invalidCustomKeys.length) await removeStorage("sync", invalidCustomKeys);

    const routes = mergeRoutes(defaults, custom);
    const logicalIdByStoredId = new Map(routes.flatMap((route) => [
      [route.id, routeIdentity(route)],
      [routeIdentity(route), routeIdentity(route)]
    ]));
    const favoriteIds = normalizeIds(sync[KEYS.favorites] ?? [], logicalIdByStoredId);
    const recents = normalizeRecents(local[KEYS.recents] ?? [], logicalIdByStoredId);
    const portals = normalizePortals(local[KEYS.portals]);
    if (JSON.stringify(favoriteIds) !== JSON.stringify(sync[KEYS.favorites] ?? [])) {
      await setStorage("sync", { [KEYS.favorites]: favoriteIds });
    }
    if (JSON.stringify(recents) !== JSON.stringify(local[KEYS.recents] ?? [])) {
      await setStorage("local", { [KEYS.recents]: recents });
    }
    if (JSON.stringify(portals) !== JSON.stringify(local[KEYS.portals] ?? {})) {
      await setStorage("local", { [KEYS.portals]: portals });
    }

    return {
      defaults,
      custom,
      routes,
      favoriteIds,
      recents,
      portals
    };
  }

  async function saveCustomRoute(route) {
    await setStorage("sync", { [`${KEYS.customPrefix}${route.id}`]: route });
  }

  async function deleteCustomRoute(id) {
    await removeStorage("sync", `${KEYS.customPrefix}${id}`);
  }

  async function replaceCustomRoutes(routes) {
    const sync = await getStorage("sync", null);
    const oldKeys = Object.keys(sync).filter((key) => key.startsWith(KEYS.customPrefix));
    const values = Object.fromEntries(routes.map((route) => [`${KEYS.customPrefix}${route.id}`, route]));
    if (Object.keys(values).length) await setStorage("sync", values);
    const retained = new Set(Object.keys(values));
    const removed = oldKeys.filter((key) => !retained.has(key));
    if (removed.length) await removeStorage("sync", removed);
  }

  async function replaceSettings(routes, favoriteIds) {
    const before = await getStorage("sync", null);
    try {
      await replaceCustomRoutes(routes);
      await setStorage("sync", { [KEYS.favorites]: validateFavoriteIds(favoriteIds) });
    } catch (error) {
      try {
        const current = await getStorage("sync", null);
        const currentCustomKeys = Object.keys(current).filter((key) => key.startsWith(KEYS.customPrefix));
        if (currentCustomKeys.length) await removeStorage("sync", currentCustomKeys);
        const priorCustom = Object.fromEntries(Object.entries(before).filter(([key]) => key.startsWith(KEYS.customPrefix)));
        if (Object.keys(priorCustom).length) await setStorage("sync", priorCustom);
        if (Object.hasOwn(before, KEYS.favorites)) {
          await setStorage("sync", { [KEYS.favorites]: before[KEYS.favorites] });
        } else {
          await removeStorage("sync", KEYS.favorites);
        }
      } catch (rollbackError) {
        throw new Error(`${error.message} Settings rollback also failed: ${rollbackError.message}`);
      }
      throw error;
    }
  }

  async function toggleFavorite(id) {
    const sync = await getStorage("sync", KEYS.favorites);
    const favorites = new Set(Array.isArray(sync[KEYS.favorites]) ? sync[KEYS.favorites] : []);
    let favoriteIds;
    if (favorites.has(id)) {
      favorites.delete(id);
      favoriteIds = [...favorites];
    } else {
      favoriteIds = validateFavoriteIds([...favorites, id]);
    }
    await setStorage("sync", { [KEYS.favorites]: favoriteIds });
    return favoriteIds;
  }

  async function recordRecent(route) {
    const id = routeIdentity(route);
    const local = await getStorage("local", KEYS.recents);
    const existing = Array.isArray(local[KEYS.recents]) ? local[KEYS.recents] : [];
    const recents = [
      { id, keyword: route.keyword, usedAt: now() },
      ...existing.filter((item) => isRecord(item) && item.id !== id)
    ].slice(0, 20);
    await setStorage("local", { [KEYS.recents]: recents });
    return recents;
  }

  async function rememberPortal(origin, portalId) {
    if (!portalId) return;
    const local = await getStorage("local", KEYS.portals);
    const portals = isRecord(local[KEYS.portals]) ? local[KEYS.portals] : {};
    const next = normalizePortals({ ...portals, [origin]: portalId });
    if (Object.hasOwn(next, origin)) await setStorage("local", { [KEYS.portals]: next });
  }

  return {
    deleteCustomRoute,
    getStorage,
    initializeStorage,
    loadState,
    recordRecent,
    rememberPortal,
    removeStorage,
    replaceCustomRoutes,
    replaceSettings,
    saveCustomRoute,
    setStorage,
    toggleFavorite
  };
}

function normalizeIds(ids, logicalIdByStoredId) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.flatMap((id) => {
    const logicalId = logicalIdByStoredId.get(String(id));
    return logicalId ? [logicalId] : [];
  }))];
}

function normalizeRecents(recents, logicalIdByStoredId) {
  if (!Array.isArray(recents)) return [];
  const seen = new Set();
  return recents.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = logicalIdByStoredId.get(String(item.id));
    if (!id) return [];
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, keyword: String(item.keyword ?? ""), usedAt: Number.isFinite(item.usedAt) ? item.usedAt : 0 }];
  }).slice(0, 20);
}

function normalizePortals(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([origin, portalId]) => {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || !isHubSpotUrl(url) || !/^\d{5,}$/.test(String(portalId))) return [];
      return [[origin, String(portalId)]];
    } catch {
      return [];
    }
  }));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

let defaultRepository;
const repository = () => defaultRepository ??= createStorageRepository();

export const getStorage = (...arguments_) => repository().getStorage(...arguments_);
export const setStorage = (...arguments_) => repository().setStorage(...arguments_);
export const removeStorage = (...arguments_) => repository().removeStorage(...arguments_);
export const initializeStorage = (...arguments_) => repository().initializeStorage(...arguments_);
export const loadState = (...arguments_) => repository().loadState(...arguments_);
export const saveCustomRoute = (...arguments_) => repository().saveCustomRoute(...arguments_);
export const deleteCustomRoute = (...arguments_) => repository().deleteCustomRoute(...arguments_);
export const replaceCustomRoutes = (...arguments_) => repository().replaceCustomRoutes(...arguments_);
export const replaceSettings = (...arguments_) => repository().replaceSettings(...arguments_);
export const toggleFavorite = (...arguments_) => repository().toggleFavorite(...arguments_);
export const recordRecent = (...arguments_) => repository().recordRecent(...arguments_);
export const rememberPortal = (...arguments_) => repository().rememberPortal(...arguments_);

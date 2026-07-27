import { isHubSpotAppHostname, isHubSpotUrl } from "./hubspot.mjs";

const FORBIDDEN = /(?:^|\/)(?:pricing|upgrade|login|logout)(?:\/|$)|upgradeSource=/i;
const TRACKING_PARAMETER = /^(?:utm_|_hs|hs_|referrer$)/i;
const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACCOUNT_PARAMETER = /([?&](?:portal|portalId|accountId)=)(\d{5,})(?=&|#|$)/gi;

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isExtensionContextUnavailable(error) {
  const message = String(error?.message ?? error ?? "");
  return /extension context invalidated|access to storage is not allowed from this context/i.test(message);
}

export function insertInstanceId(value, selectionStart, selectionEnd = selectionStart) {
  const input = String(value ?? "");
  const start = Number.isInteger(selectionStart) ? Math.max(0, Math.min(selectionStart, input.length)) : input.length;
  const end = Number.isInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, input.length)) : start;
  const token = "INSTANCE_ID";
  return {
    value: `${input.slice(0, start)}${token}${input.slice(end)}`,
    selectionStart: start + token.length,
    selectionEnd: start + token.length
  };
}

export function useCurrentAccount(value, selectionStart, selectionEnd = selectionStart) {
  const input = String(value ?? "");
  const start = Number.isInteger(selectionStart) ? Math.max(0, Math.min(selectionStart, input.length)) : input.length;
  const end = Number.isInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, input.length)) : start;
  if (end > start) return insertInstanceId(input, start, end);

  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (absolute && !isHubSpotUrl(input)) throw new Error("Use a secure hubspot.com URL without sign-in credentials.");
  const routeEnd = [input.indexOf("?"), input.indexOf("#")]
    .filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), input.length);
  const originEnd = absolute ? input.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i)?.[0].length ?? 0 : 0;
  const pathname = input.slice(originEnd, routeEnd);
  let firstReplacement = -1;
  const replacedPath = pathname.replace(/^(\/?[^/?#]+\/)(\d{5,})(?=\/|$)/, (match, prefix) => {
    firstReplacement = originEnd + prefix.length;
    return `${prefix}INSTANCE_ID`;
  });
  let output = `${input.slice(0, originEnd)}${replacedPath}${input.slice(routeEnd)}`;
  output = output.replace(ACCOUNT_PARAMETER, (match, prefix, accountId, offset) => {
    if (firstReplacement < 0) firstReplacement = offset + prefix.length;
    return `${prefix}INSTANCE_ID`;
  });

  if (firstReplacement < 0) {
    const existingToken = output.indexOf("INSTANCE_ID");
    if (existingToken < 0) throw new Error("No HubSpot account ID was found. Select an ID or use Insert INSTANCE_ID.");
    firstReplacement = existingToken;
  }
  return {
    value: output,
    selectionStart: firstReplacement + "INSTANCE_ID".length,
    selectionEnd: firstReplacement + "INSTANCE_ID".length
  };
}

export function useCurrentSubdomain(value) {
  const raw = String(value ?? "").trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  const url = new URL(raw);
  if (!isHubSpotUrl(url)) throw new Error("Use a secure hubspot.com URL without sign-in credentials.");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-") || "route";
}

export function hydrateRoute(entry, source = "default") {
  const keyword = String(entry.keyword ?? "").replace(/\s+/g, " ").trim();
  return {
    id: String(entry.id || `${source}-${slugify(keyword)}`),
    keyword,
    path: String(entry.path ?? "").trim(),
    source
  };
}

export function routeIdentity(route) {
  return String(route.logicalId ?? route.id);
}

export function mergeRoutes(defaults, custom) {
  const hydratedDefaults = defaults.map((item) => hydrateRoute(item));
  const defaultsByKeyword = new Map(hydratedDefaults.map((item) => [normalizeText(item.keyword), item]));
  const customKeywords = new Set(custom.map((item) => normalizeText(item.keyword)));
  return [
    ...custom.map((item) => {
      const route = hydrateRoute(item, "custom");
      const replacedDefault = defaultsByKeyword.get(normalizeText(route.keyword));
      return { ...route, logicalId: replacedDefault?.id ?? route.id };
    }),
    ...hydratedDefaults
      .filter((item) => !customKeywords.has(normalizeText(item.keyword)))
      .map((item) => ({ ...item, logicalId: item.id }))
  ];
}

export function routeCatalogType(route, defaults = []) {
  if (route.source !== "custom") return "default";
  const replacesDefault = defaults.some((item) => normalizeText(item.keyword) === normalizeText(route.keyword));
  return replacesDefault ? "override" : "custom";
}

export function filterRouteCatalog(routes, defaults, { query = "", type = "all" } = {}) {
  const normalizedQuery = normalizeText(query);
  return routes.filter((route) => {
    const matchesSearch = !normalizedQuery || normalizeText(`${route.keyword} ${route.path}`).includes(normalizedQuery);
    const matchesType = type === "all" || routeCatalogType(route, defaults) === type;
    return matchesSearch && matchesType;
  });
}

export function mergeImportedRoutes(existing, imported) {
  const existingById = new Map(existing.map((route) => [route.id, route]));
  const existingKeywordOwners = new Map(existing.map((route) => [normalizeText(route.keyword), route.id]));
  const importedIds = new Set(imported.map((route) => route.id));
  const importedKeywords = new Set(imported.map((route) => normalizeText(route.keyword)));
  const changes = { added: [], unchanged: [], updated: [], replacements: [] };

  for (const route of imported) {
    const current = existingById.get(route.id);
    const keywordOwner = existingKeywordOwners.get(normalizeText(route.keyword));
    const replaced = keywordOwner && keywordOwner !== route.id ? existingById.get(keywordOwner) : null;

    if (!current && !replaced) changes.added.push(route);
    else if (current?.keyword === route.keyword && current.path === route.path) changes.unchanged.push(route);
    else if (current) changes.updated.push({ before: current, after: route });

    if (replaced) changes.replacements.push({ before: replaced, after: route });
  }

  const retained = existing.filter((route) =>
    !importedIds.has(route.id) && !importedKeywords.has(normalizeText(route.keyword)));
  changes.retained = retained;

  return {
    routes: [...retained, ...imported],
    changes,
    counts: {
      added: changes.added.length,
      unchanged: changes.unchanged.length,
      updated: changes.updated.length,
      replacements: changes.replacements.length,
      retained: retained.length,
      imported: imported.length,
      total: retained.length + imported.length
    }
  };
}

function fuzzySubsequenceScore(query, candidate) {
  let cursor = 0;
  let gaps = 0;
  for (const character of query) {
    const found = candidate.indexOf(character, cursor);
    if (found < 0) return 0;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return Math.max(1, 200 - gaps);
}

export function rankRoutes(routes, query, { favoriteIds = [], recents = [], limit = 8 } = {}) {
  const normalizedQuery = normalizeText(query);
  const favorites = new Set(favoriteIds);
  const recentRank = new Map(recents.map((item, index) => [item.id, recents.length - index]));

  if (!normalizedQuery) {
    return [...routes]
      .filter((route) => favorites.has(routeIdentity(route)) || recentRank.has(routeIdentity(route)))
      .sort((a, b) => Number(favorites.has(routeIdentity(b))) - Number(favorites.has(routeIdentity(a))) ||
        (recentRank.get(routeIdentity(b)) ?? 0) - (recentRank.get(routeIdentity(a)) ?? 0) || a.keyword.localeCompare(b.keyword))
      .slice(0, limit);
  }

  const queryTokens = normalizedQuery.split(" ");
  return routes.map((route) => {
    const candidate = normalizeText(route.keyword);
    const tokens = candidate.split(" ");
    let score;
    if (candidate === normalizedQuery) score = 1000;
    else if (candidate.startsWith(normalizedQuery)) score = 850;
    else if (queryTokens.every((queryToken) => tokens.some((token) => token.startsWith(queryToken)))) score = 700;
    else if (candidate.includes(normalizedQuery)) score = 550;
    else score = fuzzySubsequenceScore(normalizedQuery.replaceAll(" ", ""), candidate.replaceAll(" ", ""));
    if (!score) return null;
    if (favorites.has(routeIdentity(route))) score += 30;
    score += Math.min(recentRank.get(routeIdentity(route)) ?? 0, 20);
    return { route, score };
  }).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.route.keyword.localeCompare(b.route.keyword))
    .slice(0, limit)
    .map(({ route }) => route);
}

export function portalFromUrl(value, routes = []) {
  const url = new URL(value);
  if (!isHubSpotUrl(url)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (!Array.isArray(routes)) return null;

  for (const route of routes) {
    const rawTemplate = String(route?.path ?? "");
    if (!rawTemplate.includes("INSTANCE_ID")) continue;
    try {
      const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(rawTemplate);
      const template = new URL(rawTemplate, url.origin);
      if (absolute && template.origin !== url.origin) continue;
      const templateSegments = template.pathname.split("/").filter(Boolean);
      for (const [index, segment] of templateSegments.entries()) {
        if (segment !== "INSTANCE_ID" || !/^\d{5,}$/.test(segments[index] ?? "")) continue;
        const prefixMatches = templateSegments.slice(0, index).every((part, prefixIndex) => part === segments[prefixIndex]);
        if (prefixMatches) return segments[index];
      }
    } catch {
      // Invalid route templates are rejected when they are loaded; ignore one here defensively.
    }
  }
  return null;
}

export function isSupportedHubSpotContext(value, rememberedPortal, routes = []) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const productHost = !["hubspot.com", "www.hubspot.com"].includes(url.hostname);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const hasAccountShapedPath = /^\d{5,}$/.test(pathSegments[1] ?? "");
    return isHubSpotUrl(url) && Boolean(
      isHubSpotAppHostname(url.hostname) || productHost && (
        portalFromUrl(url, routes) || hasAccountShapedPath || /^\d{5,}$/.test(String(rememberedPortal ?? ""))
      )
    );
  } catch {
    return false;
  }
}

export function buildDestination(route, currentUrl, rememberedPortal, routes = []) {
  const current = new URL(currentUrl);
  if (!isSupportedHubSpotContext(current, rememberedPortal, routes)) {
    throw new Error("Open a HubSpot app page before using HS Nav.");
  }
  const target = String(route.path ?? "");
  if (!target.includes("INSTANCE_ID")) {
    const destination = new URL(target, current.origin);
    if (!isHubSpotUrl(destination)) throw new Error("HS Nav only opens secure hubspot.com destinations.");
    return destination.toString();
  }
  const portalId = portalFromUrl(currentUrl, routes) || rememberedPortal;
  if (!portalId) {
    const chooserOrigin = isHubSpotAppHostname(current.hostname) ? current.origin : "https://app.hubspot.com";
    return new URL("/myaccounts-beta", chooserOrigin).toString();
  }
  const destination = new URL(target.replaceAll("INSTANCE_ID", portalId), current.origin);
  if (!isHubSpotUrl(destination)) throw new Error("HS Nav only opens secure hubspot.com destinations.");
  return destination.toString();
}

export function normalizeCustomPath(value) {
  let raw = String(value ?? "").trim();
  let origin = "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!isHubSpotUrl(url)) throw new Error("Use a secure hubspot.com URL without sign-in credentials.");
    origin = url.origin;
    raw = `${url.pathname}${url.search}${url.hash}`;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) throw new Error("Enter a HubSpot URL or a path beginning with /.");
  const parsed = new URL(raw, "https://app.hubspot.com");
  for (const [key] of [...parsed.searchParams]) {
    if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key);
  }
  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (FORBIDDEN.test(normalized)) throw new Error("Pricing, upgrade, and sign-in destinations cannot be saved.");
  return `${origin}${normalized}`;
}

export function validateCustomRoute(value, existing = []) {
  const id = String(value.id ?? "").trim();
  if (!ROUTE_ID.test(id)) throw new Error("Route ID must be 1–128 letters, numbers, periods, underscores, or hyphens.");
  const keyword = String(value.keyword ?? "").replace(/\s+/g, " ").trim();
  if (!keyword) throw new Error("Keyword is required.");
  if (keyword.length > 80) throw new Error("Keyword must be 80 characters or fewer.");
  const duplicate = existing.find((item) => item.id !== value.id && normalizeText(item.keyword) === normalizeText(keyword));
  if (duplicate) throw new Error(`“${keyword}” already exists.`);
  const path = normalizeCustomPath(value.path);
  if (path.length > 4096) throw new Error("Destination must be 4,096 characters or fewer.");
  return hydrateRoute({ id, keyword, path }, "custom");
}

export function sanitizeDiagnosticValue(value) {
  const raw = String(value ?? "");
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  try {
    const url = new URL(raw, "https://app.hubspot.com");
    if (absolute && !isHubSpotUrl(url)) return "[redacted]";
    const pathname = url.pathname
      .split("/")
      .map((segment) => /^\d{5,}$/.test(segment) ? "INSTANCE_ID" : segment)
      .join("/");
    return absolute ? `${url.origin}${pathname}` : pathname;
  } catch {
    return "[redacted]";
  }
}

export function classifyDestination(value) {
  const url = new URL(value);
  const target = `${url.pathname}${url.search}`;
  if (/pricing|upgrade|upgradeSource=/i.test(target)) return "unavailable";
  if (/login|logout|portal-recommend|myaccounts/i.test(target)) return "account";
  if (/(?:^|\/)(?:error|404)(?:\/|$)/i.test(url.pathname)) return "stale";
  return "ok";
}

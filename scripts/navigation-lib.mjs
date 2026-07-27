import { isHubSpotUrl } from "../src/shared/hubspot.mjs";
import { portalFromUrl } from "../src/shared/routes.mjs";

const FORBIDDEN = [
  /(^|\/)pricing(?:\/|$)/i,
  /(^|\/)upgrade(?:\/|$)/i,
  /upgradeSource=/i,
  /(^|\/)login(?:\/|$)/i,
  /(^|\/)logout(?:\/|$)/i
];

const TRACKING_PARAMS = [/^utm_/i, /^_hs/i, /^hs_/i, /^referrer$/i];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return ["catalog must be an object"];
  if (catalog.version !== 1) errors.push("catalog.version must be 1");
  if (!isIsoDate(catalog.reviewedAt)) errors.push("catalog.reviewedAt must be a valid YYYY-MM-DD date");
  const hasEntries = Array.isArray(catalog.entries);
  const hasUnresolved = Array.isArray(catalog.unresolved);
  if (!hasEntries) errors.push("catalog.entries must be an array");
  if (!hasUnresolved) errors.push("catalog.unresolved must be an array");
  if (!hasEntries || !hasUnresolved) return errors;

  const allowedEntryKeys = new Set(["id", "keyword", "path", "navIds", "probe"]);
  const allowedUnresolvedKeys = new Set(["id", "keyword", "navIds", "resolver", "reason"]);
  const allIds = new Set();
  const allNavIds = new Set();

  for (const [index, entry] of catalog.entries.entries()) {
    validateMetadata(entry, `entries[${index}]`, allowedEntryKeys, errors);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    validateId(entry.id, `entries[${index}].id`, allIds, errors);
    validateNavIds(entry.navIds, `entries[${index}].navIds`, allNavIds, errors);
    if (entry.probe !== undefined && typeof entry.probe !== "boolean") errors.push(`entries[${index}].probe must be a boolean`);
  }
  for (const [index, entry] of catalog.unresolved.entries()) {
    validateMetadata(entry, `unresolved[${index}]`, allowedUnresolvedKeys, errors);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    validateId(entry.id, `unresolved[${index}].id`, allIds, errors);
    validateNavIds(entry.navIds, `unresolved[${index}].navIds`, allNavIds, errors);
    if (!normalizeKeyword(entry.keyword)) errors.push(`unresolved[${index}].keyword is required`);
    if (!String(entry.resolver ?? "").trim()) errors.push(`unresolved[${index}].resolver is required`);
    if (!String(entry.reason ?? "").trim()) errors.push(`unresolved[${index}].reason is required`);
  }
  errors.push(...validateNavigation(catalog.entries));
  return errors;
}

export function normalizeKeyword(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+(locked|upgrade required)$/i, "")
    .trim();
}

export function normalizePath(value, portalId) {
  if (!value) throw new Error("path is empty");
  let raw = String(value).trim();

  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!isHubSpotUrl(url)) {
      throw new Error("external URL");
    }
    raw = `${url.pathname}${url.search}${url.hash}`;
  }

  if (!raw.startsWith("/") || raw.startsWith("//")) {
    throw new Error("path must be relative to the HubSpot app");
  }

  const parsed = new URL(raw, "https://app.hubspot.com");
  const portal = String(portalId ?? "");
  if (portal) {
    const segments = parsed.pathname.split("/");
    if (segments[2] === portal) {
      segments[2] = "INSTANCE_ID";
      parsed.pathname = segments.join("/");
    }
  }
  for (const [key, value] of [...parsed.searchParams.entries()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      parsed.searchParams.delete(key);
      continue;
    }
    if (/^(portal|portalId|accountId)$/i.test(key) && portal && value === portal) {
      parsed.searchParams.set(key, "INSTANCE_ID");
      continue;
    }
    if (/^\d{5,}$/.test(value)) {
      throw new Error("unexpected numeric query value");
    }
  }
  const query = parsed.searchParams.toString();
  const normalized = `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;

  if (FORBIDDEN.some((pattern) => pattern.test(normalized))) {
    throw new Error("upsell or authentication destination");
  }
  if (/(^|\/)\d{5,}(?=\/|$|\?|#)/.test(normalized)) {
    throw new Error("unexpected numeric path segment");
  }
  return normalized;
}

export function assessProbeResponse(status, location, portalId) {
  if (!Number.isInteger(status) || status < 200 || status >= 400) {
    return { ok: false, reason: `HTTP ${status}` };
  }
  if (status < 300) return { ok: true };
  if (!REDIRECT_STATUSES.has(status)) {
    return { ok: false, reason: `HTTP ${status} is not a supported redirect` };
  }
  if (!location) return { ok: false, reason: `HTTP ${status} did not include a Location header` };
  try {
    return { ok: true, path: normalizePath(location, portalId) };
  } catch (error) {
    return { ok: false, reason: `HTTP ${status} redirect was rejected: ${error.message}` };
  }
}

export function validateNavigation(navigation) {
  const errors = [];
  if (!Array.isArray(navigation)) return ["navigation must be an array"];
  const keywords = new Set();
  const ids = new Set();
  for (const [index, item] of navigation.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`navigation[${index}] must be an object`);
      continue;
    }
    if (!item.id) errors.push(`navigation[${index}] has no stable ID`);
    if (ids.has(item.id)) errors.push(`duplicate ID: ${item.id}`);
    ids.add(item.id);
    const keyword = normalizeKeyword(item.keyword);
    if (!keyword) errors.push(`navigation[${index}] has an empty keyword`);
    const key = keyword.toLocaleLowerCase("en-US");
    if (keywords.has(key)) errors.push(`duplicate keyword: ${keyword}`);
    keywords.add(key);
    try {
      const normalized = normalizePath(item.path);
      if (normalized !== item.path) errors.push(`${keyword}: path is not normalized`);
    } catch (error) {
      errors.push(`${keyword}: ${error.message}`);
    }
  }
  return errors;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) =>
    a.keyword.localeCompare(b.keyword, "en-US", { sensitivity: "base" }) || a.path.localeCompare(b.path)
  );
}

export function mergeCatalog(overrides, discovered) {
  const entries = overrides.entries.map((entry) => ({ ...entry, navIds: [...(entry.navIds ?? [])] }));
  const unresolved = overrides.unresolved.map((entry) => ({ ...entry, navIds: [...(entry.navIds ?? [])] }));
  const unknownLocked = [];
  const conflicts = [];
  const observedPaths = new Map();

  const findMatch = (candidate, normalizedPath) => {
    const keyword = normalizeKeyword(candidate.keyword).toLocaleLowerCase("en-US");
    return entries.find((entry) =>
      entry.keyword.toLocaleLowerCase("en-US") === keyword ||
      (candidate.navId && entry.navIds?.includes(candidate.navId)) ||
      (normalizedPath && entry.path === normalizedPath)
    );
  };

  for (const candidate of discovered) {
    const keyword = normalizeKeyword(candidate.keyword);
    if (keyword.length < 2 || keyword.length > 80) continue;

    let path;
    try {
      path = normalizePath(candidate.path, candidate.portalId);
    } catch {
      const known = findMatch(candidate);
      if (!known && (candidate.locked || /pricing|upgrade/i.test(String(candidate.path)))) {
        unknownLocked.push({ ...candidate, keyword });
      }
      continue;
    }

    const resolvedIndex = unresolved.findIndex((entry) =>
      entry.keyword.toLocaleLowerCase("en-US") === keyword.toLocaleLowerCase("en-US") ||
      (candidate.navId && entry.navIds?.includes(candidate.navId))
    );
    if (resolvedIndex >= 0) unresolved.splice(resolvedIndex, 1);

    const known = findMatch(candidate, path);
    if (known) {
      const observed = observedPaths.get(known.id);
      if (observed && observed !== path) {
        conflicts.push(`${known.id}: discovered both ${observed} and ${path}`);
      } else {
        known.path = path;
        observedPaths.set(known.id, path);
      }
      if (candidate.source === "navconfig" && !known.keyword.startsWith("Partner -")) known.keyword = keyword;
      if (candidate.navId && !known.navIds.includes(candidate.navId)) known.navIds.push(candidate.navId);
      continue;
    }

    entries.push({
      id: uniqueId(slugify(keyword), entries),
      keyword,
      path,
      ...(candidate.navId ? { navIds: [candidate.navId] } : {})
    });
  }

  const deduped = new Map();
  for (const entry of sortEntries(entries)) {
    const clean = {
      id: entry.id,
      keyword: normalizeKeyword(entry.keyword),
      path: normalizePath(entry.path),
      ...(entry.navIds?.length ? { navIds: [...new Set(entry.navIds)].sort() } : {}),
      ...(entry.probe ? { probe: true } : {})
    };
    deduped.set(clean.keyword.toLocaleLowerCase("en-US"), clean);
  }

  return {
    entries: sortEntries([...deduped.values()]),
    unresolved: [...unresolved].sort((a, b) => a.keyword.localeCompare(b.keyword)),
    unknownLocked,
    conflicts
  };
}

export function portalContextFromUrl(value, routes = []) {
  try {
    const url = new URL(value);
    const id = portalFromUrl(url, routes);
    return id ? { id, host: url.hostname } : null;
  } catch {
    return null;
  }
}

export function extractNavConfigCandidates(value, portalId) {
  const results = [];
  const seen = new Set();
  const labelKeys = ["label", "title", "name", "text"];
  const pathKeys = ["href", "url", "path", "link", "destination"];
  const idKeys = ["navItemId", "itemId", "id", "key", "upgradeSource"];

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }

    const label = firstString(node, labelKeys);
    const path = firstString(node, pathKeys);
    const navId = firstString(node, idKeys);
    if (label && path && isHubSpotDestination(path)) {
      const key = `${label}|${path}|${navId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ keyword: label, path, navId, portalId, source: "navconfig", locked: /pricing|upgrade/i.test(path) });
      }
    }

    for (const child of Object.values(node)) visit(child);
  };

  visit(value);
  return results;
}

function isHubSpotDestination(value) {
  if (/^\/(?!\/)/.test(value)) return true;
  return isHubSpotUrl(value);
}

export function renderNavigation(entries) {
  return `${JSON.stringify({ navigation: sortEntries(entries).map((entry) => ({
    id: entry.id,
    keyword: entry.keyword,
    path: entry.path
  })) }, null, 2)}\n`;
}

export function renderUnresolved(unresolved, reviewedAt) {
  const lines = [
    "# Unresolved HubSpot routes",
    "",
    `Last audited: ${reviewedAt}`,
    "",
    "These items are intentionally excluded from `navigation.json`. HubSpot exposed only an account-aware resolver or an upsell destination, not a concrete product route.",
    "",
    "| Tool | Navigation ID | Resolver | Reason |",
    "| --- | --- | --- | --- |"
  ];
  for (const item of unresolved) {
    lines.push(`| ${escapeCell(item.keyword)} | ${escapeCell((item.navIds ?? []).join(", ") || "Unknown")} | ${escapeCell(item.resolver ?? "Unknown")} | ${escapeCell(item.reason)} |`);
  }
  lines.push("", "A route can be added after an explicitly approved, logged-in portal exposes a concrete non-upsell destination.", "");
  return lines.join("\n");
}

function firstString(object, keys) {
  for (const key of keys) if (typeof object[key] === "string") return object[key];
  return "";
}

function slugify(value) {
  return value.toLocaleLowerCase("en-US").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "route";
}

function uniqueId(base, entries) {
  const used = new Set(entries.map((entry) => entry.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}


function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  try {
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}

function validateMetadata(entry, label, allowedKeys, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(entry)) if (!allowedKeys.has(key)) errors.push(`${label} has unsupported field: ${key}`);
}

function validateId(value, label, used, errors) {
  const id = String(value ?? "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) errors.push(`${label} must be a lowercase kebab-case ID`);
  if (used.has(id)) errors.push(`duplicate catalog ID: ${id}`);
  used.add(id);
}

function validateNavIds(value, label, used, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must contain non-empty strings`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${label} contains duplicates`);
  for (const id of value) {
    if (used.has(id)) errors.push(`duplicate navigation ID: ${id}`);
    used.add(id);
  }
}

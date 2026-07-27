import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDestination,
  classifyDestination,
  filterRouteCatalog,
  insertInstanceId,
  isExtensionContextUnavailable,
  mergeImportedRoutes,
  mergeRoutes,
  normalizeCustomPath,
  normalizeText,
  portalFromUrl,
  rankRoutes,
  routeIdentity,
  routeCatalogType,
  sanitizeDiagnosticValue,
  useCurrentAccount,
  useCurrentSubdomain,
  validateCustomRoute
} from "../src/shared/routes.mjs";
import { isHubSpotHostname, isHubSpotUrl } from "../src/shared/hubspot.mjs";
import { MAX_FAVORITES } from "../src/shared/favorites.mjs";
import { buildImportPlan, buildImportPreview } from "../src/options/backup.mjs";

const routes = [
  { id: "contacts", keyword: "Contacts", path: "/contacts/INSTANCE_ID/objects/0-1" },
  { id: "contracts", keyword: "Contracts", path: "/contacts/INSTANCE_ID/objects/0-721" },
  { id: "campaigns", keyword: "Campaigns", path: "/marketing/INSTANCE_ID/campaigns" }
];

test("normalizes search text and ranks exact, prefix, token, substring, and fuzzy matches", () => {
  assert.equal(normalizeText("  Càmpaigns! "), "campaigns");
  assert.equal(rankRoutes(routes, "contacts")[0].id, "contacts");
  assert.deepEqual(rankRoutes(routes, "cont").map(({ id }) => id), ["contacts", "contracts"]);
  assert.equal(rankRoutes(routes, "cmpgn")[0].id, "campaigns");
});

test("shows favorites before recents for an empty query and caps results", () => {
  const ranked = rankRoutes(routes, "", { favoriteIds: ["campaigns"], recents: [{ id: "contacts" }], limit: 1 });
  assert.deepEqual(ranked.map(({ id }) => id), ["campaigns"]);
});

test("recognizes secure HubSpot hosts without trusting lookalike domains", () => {
  assert.equal(isHubSpotHostname("app-na2.hubspot.com"), true);
  assert.equal(isHubSpotHostname("tools.eu1.hubspot.com"), true);
  assert.equal(isHubSpotUrl("https://app-na2.hubspot.com/path"), true);
  assert.equal(isHubSpotUrl("http://app-na2.hubspot.com/path"), false);
  assert.equal(isHubSpotUrl("https://hubspot.com.evil.example/path"), false);
  assert.equal(isHubSpotUrl("https://user@app-na2.hubspot.com/path"), false);
  assert.equal(isHubSpotUrl("https://app-na2.hubspot.com:8443/path"), false);
});

test("custom routes preserve exact HubSpot accounts unless the user opts in", () => {
  assert.equal(
    normalizeCustomPath("https://tools.eu1.hubspot.com/contacts/12345678/objects/0-1?utm_source=x&portalId=12345678"),
    "https://tools.eu1.hubspot.com/contacts/12345678/objects/0-1?portalId=12345678"
  );
  assert.equal(normalizeCustomPath("/contacts/12345678/objects/0-1?referrer=nav"), "/contacts/12345678/objects/0-1");
  for (const value of [
    "https://example.com/path",
    "http://app.hubspot.com/path",
    "https://app.hubspot.com.evil.example/path",
    "https://user@app.hubspot.com/path",
    "https://app.hubspot.com:8443/path"
  ]) assert.throws(() => normalizeCustomPath(value));
  assert.throws(() => normalizeCustomPath("/pricing/INSTANCE_ID"));
  assert.throws(() => validateCustomRoute({ id: "two", keyword: "CONTACTS", path: "/contacts/INSTANCE_ID" }, [{ id: "one", keyword: "Contacts" }]));
});

test("destination behavior options can follow the current subdomain, account, or both", () => {
  const fixed = "https://app-eu1.hubspot.com/global-home/12345678?portalId=12345678";
  assert.equal(useCurrentSubdomain(fixed), "/global-home/12345678?portalId=12345678");
  const fixedAccount = useCurrentAccount(fixed, fixed.length, fixed.length);
  assert.equal(fixedAccount.value, "https://app-eu1.hubspot.com/global-home/INSTANCE_ID?portalId=INSTANCE_ID");
  assert.equal(fixedAccount.selectionStart, fixedAccount.value.indexOf("INSTANCE_ID") + "INSTANCE_ID".length);
  assert.equal(fixedAccount.selectionEnd, fixedAccount.selectionStart);
  const path = useCurrentSubdomain(fixed);
  assert.equal(useCurrentAccount(path, path.length, path.length).value, "/global-home/INSTANCE_ID?portalId=INSTANCE_ID");
  assert.equal(useCurrentSubdomain("/global-home/12345678"), "/global-home/12345678");

  const record = "https://app.hubspot.com/contacts/46998751/record/0-2/25131587252?eschref=%2Fcontacts%2F46998751%2Fobjects%2F0-2%2Fviews%2Fall%2Flist";
  assert.equal(
    useCurrentAccount(record, record.length, record.length).value,
    "https://app.hubspot.com/contacts/INSTANCE_ID/record/0-2/25131587252?eschref=%2Fcontacts%2F46998751%2Fobjects%2F0-2%2Fviews%2Fall%2Flist"
  );
  assert.equal(
    useCurrentAccount("/contacts/46998751/view?return=/contacts/INSTANCE_ID", 55, 55).value,
    "/contacts/INSTANCE_ID/view?return=/contacts/INSTANCE_ID"
  );
  assert.throws(() => useCurrentAccount("/contacts/all", 13, 13), /No HubSpot account ID was found/);
});

test("inserts the instance placeholder at the caret or over a selection", () => {
  assert.deepEqual(insertInstanceId("/contacts", 0, 0), {
    value: "INSTANCE_ID/contacts", selectionStart: 11, selectionEnd: 11
  });
  assert.deepEqual(insertInstanceId("//", 1, 1), {
    value: "/INSTANCE_ID/", selectionStart: 12, selectionEnd: 12
  });
  assert.deepEqual(insertInstanceId("/123/path", 1, 4), {
    value: "/INSTANCE_ID/path", selectionStart: 12, selectionEnd: 12
  });
  assert.deepEqual(insertInstanceId("/path", 5, 5), {
    value: "/pathINSTANCE_ID", selectionStart: 16, selectionEnd: 16
  });
});

test("custom destinations override defaults by normalized keyword", () => {
  const merged = mergeRoutes(routes, [
    { id: "custom", keyword: "contacts", path: "/custom/INSTANCE_ID" },
    { id: "standalone", keyword: "Customer success", path: "/service/INSTANCE_ID" }
  ]);
  assert.equal(merged.filter((route) => normalizeText(route.keyword) === "contacts").length, 1);
  assert.equal(merged[0].source, "custom");
  assert.equal(routeIdentity(merged[0]), "contacts");
  assert.equal(routeIdentity(merged[1]), "standalone");
  assert.equal(merged.find((route) => route.id === "campaigns").logicalId, "campaigns");
});

test("catalog filters distinguish defaults, custom destinations, and overrides", () => {
  const defaults = routes.map((route) => ({ ...route, source: "default" }));
  const catalog = [
    defaults[1],
    defaults[2],
    { id: "custom-contacts", keyword: "contacts", path: "/custom/INSTANCE_ID", source: "custom" },
    { id: "custom-success", keyword: "Customer success", path: "/service/INSTANCE_ID", source: "custom" }
  ];

  assert.equal(routeCatalogType(catalog[0], defaults), "default");
  assert.equal(routeCatalogType(catalog[2], defaults), "override");
  assert.equal(routeCatalogType(catalog[3], defaults), "custom");
  assert.deepEqual(filterRouteCatalog(catalog, defaults, { type: "default" }).map(({ id }) => id), ["contracts", "campaigns"]);
  assert.deepEqual(filterRouteCatalog(catalog, defaults, { type: "custom" }).map(({ id }) => id), ["custom-success"]);
  assert.deepEqual(filterRouteCatalog(catalog, defaults, { type: "override" }).map(({ id }) => id), ["custom-contacts"]);
  assert.deepEqual(filterRouteCatalog(catalog, defaults, { query: "service", type: "custom" }).map(({ id }) => id), ["custom-success"]);
});

test("import preview distinguishes unchanged, updated, added, and conflicting routes", () => {
  const existing = [
    { id: "one", keyword: "One", path: "/one", source: "custom" },
    { id: "two", keyword: "Two", path: "/two", source: "custom" },
    { id: "old-three", keyword: "Three", path: "/old-three", source: "custom" }
  ];
  const imported = [
    { ...existing[0] },
    { ...existing[1], path: "/two-updated" },
    { id: "four", keyword: "Four", path: "/four", source: "custom" },
    { id: "new-three", keyword: "Three", path: "/three", source: "custom" }
  ];
  const result = mergeImportedRoutes(existing, imported);

  assert.deepEqual(result.counts, {
    added: 1,
    unchanged: 1,
    updated: 1,
    replacements: 1,
    retained: 0,
    imported: 4,
    total: 4
  });
  assert.deepEqual(result.changes.added, [imported[2]]);
  assert.deepEqual(result.changes.updated, [{ before: existing[1], after: imported[1] }]);
  assert.deepEqual(result.changes.replacements, [{ before: existing[2], after: imported[3] }]);
  assert.deepEqual(result.changes.unchanged, [imported[0]]);
  assert.deepEqual(result.changes.retained, []);
  assert.deepEqual(result.routes, imported);
});

test("re-importing an export reports every route as unchanged", () => {
  const existing = [
    { id: "one", keyword: "One", path: "/one", source: "custom" },
    { id: "two", keyword: "Two", path: "/two", source: "custom" }
  ];
  const result = mergeImportedRoutes(existing, existing.map((route) => ({ ...route })));

  assert.deepEqual(result.counts, {
    added: 0,
    unchanged: 2,
    updated: 0,
    replacements: 0,
    retained: 0,
    imported: 2,
    total: 2
  });
});

test("append imports preserve unmatched custom routes and existing favorites", () => {
  const existing = [
    { id: "one", keyword: "One", path: "/one", source: "custom" },
    { id: "two", keyword: "Two", path: "/two", source: "custom" }
  ];
  const state = {
    custom: existing,
    defaults: routes,
    routes: mergeRoutes(routes, existing),
    favoriteIds: ["contacts", "campaigns"]
  };
  const plan = buildImportPlan(state, {
    version: 1,
    customRoutes: [],
    favoriteIds: ["contacts", "contracts"]
  }, "append");

  assert.deepEqual(plan.routes, existing);
  assert.deepEqual(plan.favoriteIds, ["contacts", "campaigns", "contracts"]);
  assert.equal(buildImportPreview(plan), [
    "Restore behavior: Append",
    "Custom routes: 0 added, 0 removed",
    "Favorites: 1 added, 0 removed",
    "",
    "Apply this import?"
  ].join("\n"));
});

test("overwrite imports replace both custom routes and favorites", () => {
  const existing = [
    { id: "one", keyword: "One", path: "/one", source: "custom" },
    { id: "two", keyword: "Two", path: "/two", source: "custom" }
  ];
  const state = { custom: existing, favoriteIds: ["contacts", "campaigns"] };
  const plan = buildImportPlan(state, {
    version: 1,
    customRoutes: [{ id: "three", keyword: "Three", path: "/three" }],
    favoriteIds: ["contacts", "contracts"]
  }, "overwrite");

  assert.deepEqual(plan.routes.map(({ id }) => id), ["three"]);
  assert.deepEqual(plan.favoriteIds, ["contacts", "contracts"]);
  assert.equal(buildImportPreview(plan), [
    "Restore behavior: Overwrite",
    "Custom routes: 1 added, 2 removed",
    "Favorites: 1 added, 1 removed",
    "",
    "Apply this import?"
  ].join("\n"));
});

test("overwrite reports matching current data as unchanged", () => {
  const route = { id: "one", keyword: "One", path: "/one", source: "custom" };
  const plan = buildImportPlan({ custom: [route], favoriteIds: ["one"] }, {
    version: 1,
    customRoutes: [route],
    favoriteIds: ["one"]
  }, "overwrite");

  assert.deepEqual(plan.summary, {
    customAdded: 0,
    customRemoved: 0,
    favoritesAdded: 0,
    favoritesRemoved: 0
  });
});

test("import preview counts appended route edits and replacements as additions and removals", () => {
  const existing = [
    { id: "one", keyword: "One", path: "/one", source: "custom" },
    { id: "two", keyword: "Two", path: "/two", source: "custom" }
  ];
  const imported = [
    { ...existing[0], path: "/one-updated" },
    { id: "new-two", keyword: "Two", path: "/two-new", source: "custom" },
    { id: "three", keyword: "Three", path: "/three", source: "custom" }
  ];
  const plan = buildImportPlan({
    custom: existing,
    favoriteIds: ["one"]
  }, { version: 1, customRoutes: imported, favoriteIds: [] }, "append");

  assert.equal(buildImportPreview(plan), [
    "Restore behavior: Append",
    "Custom routes: 3 added, 2 removed",
    "Favorites: 0 added, 0 removed",
    "",
    "Apply this import?"
  ].join("\n"));
});

test("backup imports reject final favorite sets above the launcher limit", () => {
  const favoriteIds = Array.from({ length: MAX_FAVORITES }, (_, index) => `favorite-${index}`);
  const payload = { version: 1, customRoutes: [], favoriteIds };

  assert.equal(buildImportPlan({ custom: [], favoriteIds: [] }, payload, "overwrite").favoriteIds.length, MAX_FAVORITES);
  assert.throws(() => buildImportPlan({ custom: [], favoriteIds }, {
    version: 1,
    customRoutes: [],
    favoriteIds: ["one-more"]
  }, "append"), /at most 8 favorites/);
  assert.throws(() => buildImportPlan({ custom: [], favoriteIds: [] }, {
    ...payload,
    favoriteIds: [...favoriteIds, "one-more"]
  }, "overwrite"), /at most 8 favorites/);
});

test("backup imports reject duplicate or unsafe route IDs before persistence", () => {
  assert.throws(() => buildImportPlan({ custom: [], favoriteIds: [] }, {
    version: 1,
    customRoutes: [
      { id: "duplicate", keyword: "One", path: "/one" },
      { id: "duplicate", keyword: "Two", path: "/two" }
    ],
    favoriteIds: []
  }, "overwrite"), /duplicate route ID/i);
  assert.throws(() => buildImportPlan({ custom: [], favoriteIds: [] }, {
    version: 1,
    customRoutes: [{ id: "../../unsafe", keyword: "Unsafe", path: "/unsafe" }],
    favoriteIds: []
  }, "overwrite"), /route ID/i);
});

test("backup imports reject favorites that do not exist after restore", () => {
  assert.throws(() => buildImportPlan({
    custom: [],
    defaults: routes,
    routes: mergeRoutes(routes, []),
    favoriteIds: []
  }, {
    version: 1,
    customRoutes: [],
    favoriteIds: ["missing"]
  }, "overwrite"), /unknown favorite destination/i);
});

test("route hydration discards unsupported metadata", () => {
  const merged = mergeRoutes([{ ...routes[0], legacyGroup: "CRM" }], []);
  assert.deepEqual(merged[0], { ...routes[0], source: "default", logicalId: "contacts" });
});

test("portal resolution only trusts known HubSpot structures and uses account chooser as fallback", () => {
  assert.equal(portalFromUrl("https://app.hubspot.com/contacts/12345678/objects/0-1", routes), "12345678");
  assert.equal(portalFromUrl("https://tools.eu1.hubspot.com/prospecting/12345678", [
    { path: "/prospecting/INSTANCE_ID" }
  ]), "12345678");
  assert.equal(portalFromUrl("https://app.hubspot.com/random/path/12345678", routes), null);
  assert.equal(portalFromUrl("https://app.hubspot.com/unrecognized/87654321", routes), null);
  assert.equal(portalFromUrl("https://app.hubspot.com/unrecognized?portalId=87654321", routes), null);
  assert.equal(buildDestination(routes[0], "https://app.hubspot.com/random", null), "https://app.hubspot.com/myaccounts-beta");
  assert.equal(buildDestination(routes[0], "https://app-na2.hubspot.com/random", "87654321"), "https://app-na2.hubspot.com/contacts/87654321/objects/0-1");
  assert.equal(buildDestination(
    { path: "https://reports.eu1.hubspot.com/view/INSTANCE_ID?portalId=INSTANCE_ID" },
    "https://app-na2.hubspot.com/contacts/87654321",
    null,
    routes
  ), "https://reports.eu1.hubspot.com/view/87654321?portalId=87654321");
  assert.equal(buildDestination(
    { path: "https://reports.eu1.hubspot.com/view/INSTANCE_ID" },
    "https://app-na2.hubspot.com/random",
    null
  ), "https://app-na2.hubspot.com/myaccounts-beta");
  assert.throws(() => buildDestination({ path: "https://example.com/path" }, "https://app.hubspot.com/contacts/12345678", null));
  assert.throws(
    () => buildDestination(routes[0], "https://www.hubspot.com/products", null),
    /Open a HubSpot app page/
  );
  assert.throws(
    () => buildDestination(routes[0], "https://www.hubspot.com/products?portalId=12345678", null),
    /Open a HubSpot app page/
  );
});

test("diagnostics redact identifiers, query values, and fragments", () => {
  assert.equal(
    sanitizeDiagnosticValue("https://app.hubspot.com/contacts/12345678/record/0-1/987654321?email=person%40example.com#private"),
    "https://app.hubspot.com/contacts/INSTANCE_ID/record/0-1/INSTANCE_ID"
  );
  assert.equal(
    sanitizeDiagnosticValue("/contacts/12345678/objects/0-1?portalId=12345678"),
    "/contacts/INSTANCE_ID/objects/0-1"
  );
});

test("classifies account, upsell, stale, and successful destinations", () => {
  assert.equal(classifyDestination("https://app.hubspot.com/pricing/123"), "unavailable");
  assert.equal(classifyDestination("https://app.hubspot.com/myaccounts-beta"), "account");
  assert.equal(classifyDestination("https://app.hubspot.com/error/404"), "stale");
  assert.equal(classifyDestination("https://app.hubspot.com/contacts/12345678"), "ok");
});

test("recognizes extension contexts invalidated by a reload", () => {
  assert.equal(isExtensionContextUnavailable(new Error("Access to storage is not allowed from this context.")), true);
  assert.equal(isExtensionContextUnavailable(new Error("Extension context invalidated.")), true);
  assert.equal(isExtensionContextUnavailable(new Error("Network request failed.")), false);
});

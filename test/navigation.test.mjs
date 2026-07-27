import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assessProbeResponse,
  extractNavConfigCandidates,
  mergeCatalog,
  normalizePath,
  portalContextFromUrl,
  renderNavigation,
  validateCatalog,
  validateNavigation
} from "../scripts/navigation-lib.mjs";

test("normalizes portal IDs and removes tracking parameters", () => {
  assert.equal(
    normalizePath("https://tools.eu1.hubspot.com/contacts/12345678/objects/0-1?utm_source=test", "12345678"),
    "/contacts/INSTANCE_ID/objects/0-1"
  );
  assert.equal(
    normalizePath("/reports/12345678?portalId=12345678", "12345678"),
    "/reports/INSTANCE_ID?portalId=INSTANCE_ID"
  );
});

test("rejects external, upsell, and authentication destinations", () => {
  for (const value of [
    "https://example.com/tool",
    "http://app-na2.hubspot.com/tool",
    "https://app.hubspot.com.evil.example/tool",
    "/pricing/INSTANCE_ID/tool",
    "/upgrade/INSTANCE_ID/partner-program",
    "/tool?upgradeSource=locked-nav-item",
    "/login"
  ]) assert.throws(() => normalizePath(value));
});

test("keeps a vetted route when a live item is locked", () => {
  const overrides = {
    entries: [{ id: "playbooks", keyword: "Playbooks", path: "/playbooks/INSTANCE_ID", navIds: ["playbooks"] }],
    unresolved: []
  };
  const merged = mergeCatalog(overrides, [{
    keyword: "Playbooks",
    path: "/pricing/12345678?upgradeSource=playbooks",
    navId: "playbooks",
    portalId: "12345678",
    locked: true
  }]);
  assert.equal(merged.entries[0].path, "/playbooks/INSTANCE_ID");
  assert.equal(merged.unknownLocked.length, 0);
});

test("menu scraping cannot rename a vetted keyword", () => {
  const overrides = {
    entries: [{ id: "home", keyword: "Home", path: "/global-home/INSTANCE_ID" }],
    unresolved: []
  };
  const merged = mergeCatalog(overrides, [{
    keyword: "HubSpot logo",
    path: "/global-home/12345678",
    portalId: "12345678",
    source: "menu"
  }]);
  assert.equal(merged.entries[0].keyword, "Home");
  assert.deepEqual(merged.conflicts, []);
});

test("audit portal detection rejects record IDs outside known portal positions", () => {
  const knownRoutes = [{ path: "/contacts/INSTANCE_ID/objects/0-1" }];
  assert.deepEqual(portalContextFromUrl("https://app.hubspot.com/contacts/12345678/objects/0-1", knownRoutes), {
    id: "12345678",
    host: "app.hubspot.com"
  });
  assert.equal(portalContextFromUrl("https://app.hubspot.com/random/path/987654321", knownRoutes), null);
});

test("rejects unrelated numeric resource IDs instead of converting them to account placeholders", () => {
  assert.throws(
    () => normalizePath("/reports/12345678/dashboards/987654321", "12345678"),
    /numeric path segment/i
  );
  assert.equal(
    normalizePath("/reports/12345678/dashboards/team-performance", "12345678"),
    "/reports/INSTANCE_ID/dashboards/team-performance"
  );
});

test("counts only successful and safe route probes as evidence", () => {
  assert.deepEqual(assessProbeResponse(200), { ok: true });
  for (const status of [401, 403, 404, 410, 429, 500]) {
    assert.deepEqual(assessProbeResponse(status), { ok: false, reason: `HTTP ${status}` });
  }
  assert.deepEqual(assessProbeResponse(304, "/reports/12345678", "12345678"), {
    ok: false,
    reason: "HTTP 304 is not a supported redirect"
  });
  assert.deepEqual(assessProbeResponse(302), { ok: false, reason: "HTTP 302 did not include a Location header" });
  assert.match(assessProbeResponse(302, "https://example.com/path", "12345678").reason, /external URL/i);
  assert.match(assessProbeResponse(302, "/login", "12345678").reason, /authentication destination/i);
  assert.deepEqual(assessProbeResponse(302, "/reports/12345678", "12345678"), {
    ok: true,
    path: "/reports/INSTANCE_ID"
  });
});

test("conflicting trusted audit paths are surfaced instead of using the last candidate", () => {
  const overrides = {
    entries: [{ id: "reports", keyword: "Reports", path: "/reports-list/INSTANCE_ID", navIds: ["reports"] }],
    unresolved: []
  };
  const merged = mergeCatalog(overrides, [
    { keyword: "Reports", path: "/reports/12345678", portalId: "12345678", navId: "reports", source: "navconfig" },
    { keyword: "Reports", path: "/reports-dashboard/12345678", portalId: "12345678", navId: "reports", source: "navconfig" }
  ]);

  assert.equal(merged.entries[0].path, "/reports/INSTANCE_ID");
  assert.equal(merged.conflicts.length, 1);
  assert.match(merged.conflicts[0], /reports-dashboard/);
});

test("an unlocked route resolves a previously unresolved item", () => {
  const overrides = {
    entries: [],
    unresolved: [{ id: "new-tool", keyword: "New Tool", navIds: ["newTool"], reason: "Locked" }]
  };
  const merged = mergeCatalog(overrides, [{
    keyword: "New Tool",
    path: "/new-tool/12345678",
    navId: "newTool",
    portalId: "12345678"
  }]);
  assert.deepEqual(merged.unresolved, []);
  assert.equal(merged.entries[0].path, "/new-tool/INSTANCE_ID");
});

test("extracts route candidates from nested nav configuration", () => {
  const candidates = extractNavConfigCandidates({
    sections: [{ name: "CRM", items: [
      { id: "contacts", label: "Contacts", href: "/contacts/12345678/objects/0-1" },
      { id: "reports", label: "Reports", href: "https://reports.eu1.hubspot.com/reports/12345678" },
      { id: "external", label: "External", href: "https://example.com/tool" }
    ] }]
  }, "12345678");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].navId, "contacts");
  assert.deepEqual(Object.keys(candidates[0]).sort(), ["keyword", "locked", "navId", "path", "portalId", "source"].sort());
});

test("the generated repository catalog is deterministic and valid", async () => {
  const source = JSON.parse(await readFile(new URL("../catalog/navigation-source.json", import.meta.url), "utf8"));
  assert.deepEqual(validateCatalog(source), []);
  const rendered = renderNavigation(source.entries);
  const navigation = JSON.parse(rendered);
  assert.deepEqual(validateNavigation(navigation.navigation), []);
  assert.equal(rendered, `${JSON.stringify(navigation, null, 2)}\n`);
});

test("catalog validation covers metadata, unresolved entries, and globally unique identifiers", () => {
  const invalid = {
    version: 2,
    reviewedAt: "2026-02-31",
    entries: [
      { id: "Bad ID", keyword: "Contacts", path: "/contacts/INSTANCE_ID", navIds: ["contacts", "contacts"], probe: "yes", extra: true },
      { id: "duplicate", keyword: "contacts", path: "/pricing/INSTANCE_ID", navIds: ["shared"] }
    ],
    unresolved: [
      { id: "duplicate", keyword: "", navIds: ["shared"], resolver: "", reason: "" }
    ]
  };
  const errors = validateCatalog(invalid).join("\n");
  for (const message of [
    "catalog.version must be 1",
    "catalog.reviewedAt must be a valid YYYY-MM-DD date",
    "unsupported field: extra",
    "lowercase kebab-case ID",
    "contains duplicates",
    "probe must be a boolean",
    "duplicate keyword",
    "upsell or authentication destination",
    "duplicate catalog ID",
    "duplicate navigation ID",
    "keyword is required",
    "resolver is required",
    "reason is required"
  ]) assert.match(errors, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("catalog validation reports malformed entries instead of throwing", () => {
  const errors = validateCatalog({ version: 1, reviewedAt: "9999-99-99", entries: [null], unresolved: [null] });
  assert.ok(errors.includes("catalog.reviewedAt must be a valid YYYY-MM-DD date"));
  assert.ok(errors.includes("entries[0] must be an object"));
  assert.ok(errors.includes("unresolved[0] must be an object"));
  assert.ok(errors.includes("navigation[0] must be an object"));
});

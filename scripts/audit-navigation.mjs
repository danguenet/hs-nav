import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assessProbeResponse,
  extractNavConfigCandidates,
  mergeCatalog,
  portalContextFromUrl,
  renderNavigation,
  renderUnresolved,
  validateCatalog,
  validateNavigation
} from "./navigation-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overridesPath = path.join(root, "catalog/navigation-source.json");
const unresolvedPath = path.join(root, "catalog/UNRESOLVED_ROUTES.md");
const profilePath = path.join(root, ".hs-nav-audit/chrome-profile");
const checkOnly = process.argv.includes("--check");
const dryRun = process.argv.includes("--dry-run");
const jsonOutput = process.argv.includes("--json");

const overrides = JSON.parse(await readFile(overridesPath, "utf8"));

if (checkOnly) {
  const catalogErrors = validateCatalog(overrides);
  if (catalogErrors.length) fail(catalogErrors.join("\n"));
  const navigation = JSON.parse(renderNavigation(overrides.entries)).navigation;
  const errors = validateNavigation(navigation);
  if (errors.length) fail(errors.join("\n"));
  await assertCurrent(unresolvedPath, renderUnresolved(overrides.unresolved, overrides.reviewedAt));
  console.log(`Navigation catalog is valid and current (${navigation.length} routes).`);
  process.exit(0);
}

if (!stdin.isTTY || !stdout.isTTY) {
  fail("The live audit must run in an interactive terminal so portal access can be explicitly approved.");
}

await mkdir(profilePath, { recursive: true });
const prompt = createInterface({ input: stdin, output: stdout });
const context = await chromium.launchPersistentContext(profilePath, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1440, height: 1000 }
});

const discovered = [];
const evidence = { approvedPortals: 0, candidates: 0, probesExpected: 0, probesChecked: 0, warnings: [] };
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://app.hubspot.com", { waitUntil: "domcontentloaded" });

  let auditAnother = true;
  while (auditAnother) {
    const portal = await requireApprovedPortal(page, prompt);
    evidence.approvedPortals += 1;
    console.log(`Collecting read-only navigation for portal ${portal.id}...`);
    const portalCandidates = await collectPortalNavigation(page, portal.id);
    const probeEntries = overrides.entries.filter((entry) => entry.probe);
    evidence.probesExpected += probeEntries.length;
    const probeResult = await probeVettedRoutes(context, portal, probeEntries);
    discovered.push(...portalCandidates, ...probeResult.candidates);
    evidence.candidates += portalCandidates.length;
    evidence.probesChecked += probeResult.checked;
    evidence.warnings.push(...probeResult.warnings);
    for (const warning of probeResult.warnings) console.warn(`Route probe warning: ${warning}`);
    const answer = (await prompt.question("Audit another portal? Switch the browser to it first, then type y; otherwise press Enter: ")).trim().toLowerCase();
    auditAnother = answer === "y" || answer === "yes";
  }
} finally {
  prompt.close();
  await context.close();
}

const merged = mergeCatalog(overrides, discovered);
if (!evidence.approvedPortals || !evidence.candidates) {
  fail("The audit did not collect navigation evidence from an approved portal; no files were changed.");
}
if (evidence.warnings.length) {
  fail(`The audit had incomplete route checks; no files were changed.\n${evidence.warnings.join("\n")}`);
}
if (evidence.probesChecked !== evidence.probesExpected) {
  fail(`The audit completed ${evidence.probesChecked} of ${evidence.probesExpected} required route probes; no files were changed.`);
}
if (merged.conflicts.length) {
  fail(`The audit discovered conflicting destinations; no files were changed.\n${merged.conflicts.join("\n")}`);
}
for (const item of merged.unknownLocked) {
  if (merged.unresolved.some((entry) => entry.keyword.toLowerCase() === item.keyword.toLowerCase())) continue;
  merged.unresolved.push({
    id: item.navId || item.keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    keyword: item.keyword,
    navIds: item.navId ? [item.navId] : [],
    resolver: "Unknown",
    reason: "All approved portals exposed only a locked pricing or upgrade destination."
  });
}

const reviewedAt = new Date().toISOString().slice(0, 10);
const nextOverrides = { version: overrides.version, reviewedAt, entries: merged.entries, unresolved: merged.unresolved };
const catalogErrors = validateCatalog(nextOverrides);
if (catalogErrors.length) fail(catalogErrors.join("\n"));
const navigation = merged.entries.map(({ id, keyword, path }) => ({ id, keyword, path }));
const errors = validateNavigation(navigation);
if (errors.length) fail(errors.join("\n"));

const summary = summarizeChanges(overrides.entries, merged.entries, merged.unresolved, reviewedAt);
if (!dryRun) {
  await writeFile(overridesPath, `${JSON.stringify(nextOverrides, null, 2)}\n`);
  await writeFile(unresolvedPath, renderUnresolved(merged.unresolved, reviewedAt));
}
console.log(`${dryRun ? "Dry run:" : "Updated"} ${navigation.length} routes; ${summary.added.length} added, ${summary.changed.length} changed, ${summary.removed.length} removed, ${summary.unresolved.length} unresolved.`);
if (jsonOutput) console.log(JSON.stringify(summary, null, 2));

async function requireApprovedPortal(page, promptInterface) {
  let portal = portalContextFromUrl(page.url(), overrides.entries);
  while (!portal) {
    console.log("Sign in manually in the audit-only Chrome window and open the HubSpot portal you want to audit.");
    await promptInterface.question("Press Enter after the logged-in portal is visible: ");
    portal = portalContextFromUrl(page.url(), overrides.entries);
  }

  const title = await page.title().catch(() => "HubSpot");
  console.log(`\nPortal: ${portal.id}\nPage: ${title}\nURL host: ${portal.host}`);
  console.log("This audit reads navigation links and configuration only. It does not create, edit, or delete HubSpot data.");
  const approval = await promptInterface.question(`Type AUDIT ${portal.id} to authorize read-only access to this logged-in portal: `);
  if (approval.trim() !== `AUDIT ${portal.id}`) throw new Error("Portal access was not approved; no files were changed.");
  return portal;
}

async function collectPortalNavigation(page, portalId) {
  const navConfigs = [];
  const onResponse = async (response) => {
    if (!/\/navconfig\/v\d+\/navconfig/i.test(response.url())) return;
    try { navConfigs.push(await response.json()); } catch { /* HubSpot may return a non-JSON error body. */ }
  };
  page.on("response", onResponse);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const candidates = [];
    for (const config of navConfigs) candidates.push(...extractNavConfigCandidates(config, portalId));
    candidates.push(...await scrapeVisibleNavigation(page, portalId));
    return candidates;
  } finally {
    page.off("response", onResponse);
  }
}

async function scrapeVisibleNavigation(page, portalId) {
  const results = [];
  const collect = async () => {
    const links = await page.locator("a[href]").evaluateAll((anchors) => anchors
      .filter((anchor) => anchor.closest("nav, header, [role=menu], [role=dialog]"))
      .map((anchor) => {
        const attributes = ["data-test-id", "data-testid", "data-selenium-test", "data-menu-id", "id"];
        const navId = attributes.map((name) => anchor.getAttribute(name)).find(Boolean) || "";
        return { keyword: anchor.innerText || anchor.getAttribute("aria-label") || anchor.title, path: anchor.href, navId };
      }));
    for (const link of links) results.push({ ...link, portalId, source: "menu", locked: /pricing|upgrade/i.test(link.path) });
  };

  await collect();
  for (const menuName of ["More", "Marketplace", "View profile and more"]) {
    const button = page.getByRole("button", { name: menuName, exact: false }).first();
    if (!await button.isVisible().catch(() => false)) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(500);
    await collect();
    await page.keyboard.press("Escape").catch(() => {});
  }
  return results;
}

async function probeVettedRoutes(context, portal, entries) {
  const candidates = [];
  const warnings = [];
  let checked = 0;
  for (const entry of entries) {
    const route = entry.path.replaceAll("INSTANCE_ID", portal.id);
    const url = new URL(route, `https://${portal.host}`);
    try {
      const response = await context.request.get(url.toString(), {
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: 15000
      });
      const assessment = assessProbeResponse(response.status(), response.headers().location, portal.id);
      if (!assessment.ok) {
        warnings.push(`${entry.keyword} ${assessment.reason} at ${entry.path}`);
        continue;
      }
      checked += 1;
      if (assessment.path) {
        candidates.push({ keyword: entry.keyword, path: assessment.path, portalId: portal.id, source: "probe" });
      }
    } catch (error) {
      warnings.push(`${entry.keyword} could not be checked (${error.message})`);
    }
  }
  return { candidates, warnings, checked };
}

async function assertCurrent(file, expected) {
  const actual = await readFile(file, "utf8").catch(() => "");
  if (actual !== expected) fail(`${path.relative(root, file)} is out of date. Run npm run audit:navigation.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function summarizeChanges(previous, next, unresolved, reviewedAt) {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  const after = new Map(next.map((entry) => [entry.id, entry]));
  return {
    reviewedAt,
    added: next.filter((entry) => !before.has(entry.id)).map(({ id, keyword, path }) => ({ id, keyword, path })),
    changed: next.filter((entry) => {
      const old = before.get(entry.id);
      return old && (old.keyword !== entry.keyword || old.path !== entry.path);
    }).map(({ id, keyword, path }) => ({ id, keyword, path })),
    removed: previous.filter((entry) => !after.has(entry.id)).map(({ id, keyword, path }) => ({ id, keyword, path })),
    unresolved: unresolved.map(({ id, keyword, reason }) => ({ id, keyword, reason }))
  };
}

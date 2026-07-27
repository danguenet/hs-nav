import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("release versions stay synchronized", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

  assert.equal(manifest.version, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
});

test("source manifest references package-root files and requests only the intended permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.minimum_chrome_version, "120");
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://*.hubspot.com/*"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.hubspot.com/*"]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts[0].js, ["contentScript.js"]);
  assert.equal(manifest.options_page, "options.html");
});

test("the overlay uses a search field followed by semantic, independently actionable results", async () => {
  const overlay = await readFile(new URL("../src/content/overlay.mjs", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/content/styles.mjs", import.meta.url), "utf8");
  const source = `${overlay}\n${styles}`;
  for (const contract of ["attachShadow", 'role\", \"dialog', 'role\", \"list', 'role\", \"listitem', "prefers-reduced-motion", "forced-colors"]) {
    assert.match(source, new RegExp(contract));
  }
  assert.doesNotMatch(source, /combobox|listbox|aria-activedescendant/);
  assert.match(source, /favorite\.textContent = isFavorite \? "★" : "☆"/);
  assert.match(source, /favorite\.tabIndex = 0/);
  assert.match(source, /openButton\.setAttribute\("aria-label", `Open \$\{route\.keyword\}`\)/);
  assert.match(source, /favorite\.setAttribute\("aria-pressed"/);
  assert.match(source, /focusRoute\(event\.key === "ArrowDown" \? 0 : results\.length - 1\)/);
  assert.match(source, /if \(previousFocus\?\.isConnected\) previousFocus\.focus\(\)/);
  assert.match(source, /Keyboard shortcuts: Up and Down to navigate, Tab for actions, Enter to open, Escape to close/);
  assert.match(source, /addGroupLabel\("Favorites"\)/);
  assert.match(source, /addGroupLabel\("Recents"\)/);
  assert.doesNotMatch(source, /\bPin(?:ned)?\b|\bUnpin\b|All destinations/);
});

test("custom-link rendering does not use HTML string insertion", async () => {
  const files = ["index.mjs", "destinations.mjs", "backup.mjs", "personalization.mjs"];
  const source = (await Promise.all(files.map((file) => readFile(new URL(`../src/options/${file}`, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test("destination editor exposes opt-in account and subdomain controls", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/options/destinations.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="closeDrawer"/);
  assert.match(html, /id="insertInstanceId"[^>]*>Insert INSTANCE_ID<\/button>/);
  assert.match(html, /id="useCurrentSubdomain"[^>]*>Turn into path<\/button>/);
  assert.match(html, /id="replaceInstanceId"[^>]*>Replace ID with variable<\/button>/);
  assert.ok(html.indexOf('class="destination-behavior"') < html.indexOf('class="path-preview"'));
  assert.match(html, /id="pathMode"/);
  assert.match(html, /aria-describedby="pathHelp pathPreview destinationBehaviorHelp"/);
  assert.match(html, /Optional: adapt the saved destination to the current HubSpot tab\./);
  assert.match(html, /A path uses the current HubSpot tab’s subdomain/);
  assert.match(html, /<code>INSTANCE_ID<\/code> uses that tab’s current account ID/);
  assert.match(source, /replaceInstanceId\.addEventListener\("click", replaceAccountId\)/);
  assert.match(source, /insertInstanceId\.addEventListener\("click", insertInstanceIdAtCursor\)/);
  assert.match(source, /useCurrentSubdomain\.addEventListener\("click", followCurrentSubdomain\)/);
  assert.match(source, /Fixed subdomain/);
  assert.match(source, /followsSubdomain \? "Path"/);
});

test("destination catalog exposes and wires every type filter", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/options/destinations.mjs", import.meta.url), "utf8");
  assert.match(html, /id="routeTypeFilter"/);
  for (const value of ["all", "default", "custom", "override"]) {
    assert.match(html, new RegExp(`<option value="${value}">`));
  }
  assert.match(source, /routeTypeFilter\.addEventListener\("change", render\)/);
  assert.match(source, /filterRouteCatalog\(state\.routes, state\.defaults/);
});

test("settings backups support file download and upload without extra permissions", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/options/backup.mjs", import.meta.url), "utf8");
  assert.match(html, /id="downloadFile"/);
  assert.match(html, /id="uploadFile"/);
  assert.match(html, /id="uploadInput"[^>]+type="file"|type="file"[^>]+id="uploadInput"/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /await file\.text\(\)/);
  assert.match(html, /Load backup data/);
  assert.match(html, /Review and apply/);
  assert.match(html, /id="importMode"/);
  assert.match(html, /value="append"/);
  assert.match(html, /value="overwrite"/);
  assert.match(html, /id="importData"[^>]+disabled/);
  assert.match(source, /syncImportAvailability/);
  assert.match(source, /elements\.importData\.focus/);
});

test("personalization lists active favorites and supports individual removal", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/options/personalization.mjs", import.meta.url), "utf8");
  assert.match(html, /id="favoriteList"/);
  assert.match(source, /createPersonalizationView/);
  assert.match(source, /createTextButton\("★", "favorite-remove"/);
  assert.match(source, /remove\.setAttribute\("aria-pressed", "true"\)/);
  assert.match(source, /state\.favoriteIds\.filter\(\(id\) => id !== route\.logicalId\)/);
});

test("shortcut settings show platform-specific keys and a non-link Chrome address", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  assert.match(html, /class="shortcut-platform">Mac</);
  assert.match(html, /class="shortcut-platform">Windows</);
  assert.match(html, /<code>chrome:\/\/extensions\/shortcuts<\/code>/);
  assert.doesNotMatch(html, /href="chrome:\/\/extensions\/shortcuts"/);
  assert.doesNotMatch(html, /⌘ \/ Ctrl/);
});

test("content navigation delegates session diagnostics to the background worker", async () => {
  const content = await readFile(new URL("../src/content/index.mjs", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background/index.mjs", import.meta.url), "utf8");
  const action = await readFile(new URL("../src/background/action.mjs", import.meta.url), "utf8");
  const messages = await readFile(new URL("../src/background/messages.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(content, /(?:get|set)Storage\("session"|chrome\.storage\.session/);
  assert.doesNotMatch(content, /chrome\.storage\.onChanged/);
  assert.match(content, /record-route-attempt/);
  assert.match(content, /action: "open-options"/);
  assert.match(content, /addEventListener\("unhandledrejection"[\s\S]*?isExtensionContextUnavailable[\s\S]*?event\.preventDefault\(\)/);
  assert.match(messages, /setStorage\("session"/);
  assert.match(messages, /consume-route-attempt/);
  assert.match(messages, /attemptPrefix/);
  assert.doesNotMatch(background, /chrome\.runtime\.openOptionsPage/);
  assert.match(background, /chrome\.tabs\.create/);
  assert.match(action, /Reload this HubSpot tab to reconnect HS Nav/);
});

test("settings styles are split by responsibility", async () => {
  const html = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  for (const file of ["base.css", "layout.css", "controls.css", "shortcut.css", "drawer.css", "responsive.css"]) {
    assert.match(html, new RegExp(`href="styles/${file.replace(".", "\\.")}"`));
  }
  assert.doesNotMatch(html, /styles\/components\.css/);
});

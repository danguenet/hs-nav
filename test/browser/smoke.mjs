import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (requestPath === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (requestPath === "/error/404") {
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      response.end("<!doctype html><html><body><main>Route outcome fixture</main></body></html>");
      return;
    }
    const file = path.resolve(root, `.${requestPath}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("unsafe path");
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": mimeType(file), "cache-control": "no-store" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  await testPopup(browser, origin);
  await testReconnect(browser, origin);
  await testClipboardFailure(browser, origin);
  await testSettings(browser, origin);
  await testSettingsRetry(browser, origin);
  console.log("Browser smoke tests passed for popup, recovery, settings, and responsive layouts.");
} finally {
  await browser?.close();
  await new Promise((resolve) => { server.close(resolve); });
}

async function testPopup(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${origin}/preview/popup.html?manual`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof globalThis.__HS_NAV_TOGGLE__ === "function");

  const returnTarget = page.getByRole("link", { name: "Contacts" });
  await returnTarget.focus();
  await page.evaluate(() => globalThis.__HS_NAV_TOGGLE__());
  const search = page.getByRole("searchbox", { name: "Search destinations" });
  await search.waitFor();
  assert.equal(await activeLabel(page), "Search destinations");

  const initialOptions = page.locator(".option");
  assert.equal(await initialOptions.nth(1).evaluate((option) => getComputedStyle(option).borderBottomWidth), "1px");
  assert.equal(await initialOptions.nth(2).evaluate((option) => getComputedStyle(option).borderBottomWidth), "0px");
  assert.equal(await initialOptions.last().evaluate((option) => getComputedStyle(option).borderBottomWidth), "0px");

  const initialOpenButtons = page.locator(".option-open");
  const initialFavoriteButtons = page.locator(".favorite");
  assert.equal(await initialFavoriteButtons.first().getAttribute("tabindex"), "-1");
  await search.press("Tab");
  assert.equal(await activeLabel(page), await initialOpenButtons.nth(0).getAttribute("aria-label"));
  await page.keyboard.press("Tab");
  assert.equal(await activeLabel(page), await initialOpenButtons.nth(1).getAttribute("aria-label"));
  await page.keyboard.press("Shift+Tab");
  assert.equal(await activeLabel(page), await initialOpenButtons.nth(0).getAttribute("aria-label"));

  await search.fill("contacts");
  const open = page.getByRole("button", { name: "Open contacts", exact: false });
  await open.waitFor();
  await search.press("ArrowDown");
  assert.match(await activeLabel(page), /^Open contacts$/i);

  await page.getByRole("button", { name: /Remove Contacts from favorites/i }).click();
  const addFavorite = page.getByRole("button", { name: /Add Contacts to favorites/i });
  await addFavorite.waitFor();
  assert.equal(await addFavorite.getAttribute("aria-pressed"), "false");

  for (let presses = 0; presses < 8 && await activeText(page) !== "Settings"; presses += 1) {
    await page.keyboard.press("Tab");
  }
  assert.equal(await activeText(page), "Settings");
  await page.keyboard.press("Tab");
  assert.equal(await activeLabel(page), "Search destinations");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await activeText(page), "Settings");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Navigate HubSpot" }).waitFor({ state: "detached" });
  assert.equal((await activeText(page)).trim(), "Contacts");

  await page.evaluate(() => globalThis.__HS_NAV_TOGGLE__());
  await page.getByRole("searchbox", { name: "Search destinations" }).fill("contacts");
  await page.getByRole("searchbox", { name: "Search destinations" }).press("Enter");
  await page.waitForFunction(() => globalThis.__HS_NAV_LAST_DESTINATION__);
  assert.equal(
    await page.evaluate(() => globalThis.__HS_NAV_LAST_DESTINATION__),
    "https://app.hubspot.com/contacts/12345678/objects/0-1/views/all/list"
  );

  await page.evaluate(() => globalThis.__HS_NAV_TOGGLE__());
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForURL("**/dist/options.html?preview=1");
  await page.getByRole("heading", { name: "Destinations" }).waitFor();
  assert.deepEqual(errors, []);
  await page.close();
}

async function testReconnect(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = collectErrors(page);
  await page.goto(`${origin}/preview/popup.html?recovery&unhandled`, { waitUntil: "networkidle" });
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.textContent(), /Reload this HubSpot tab/i);
  assert.equal(await page.getByRole("button", { name: "Reload HubSpot" }).isEnabled(), true);
  await page.waitForTimeout(25);
  assert.equal(await page.locator("html").getAttribute("data-hs-nav-errors"), "0");
  assert.deepEqual(errors, []);
  await page.close();
}

async function testClipboardFailure(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
  const errors = collectErrors(page);
  await page.goto(`${origin}/error/404`);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard denied"); } }
    });
    const { showRouteOutcome } = await import("/src/content/route-outcome.mjs");
    await showRouteOutcome({
      ensureRoot: () => document.body,
      sendMessage: async () => ({
        ok: true,
        attempt: {
          keyword: "Contacts",
          path: "/contacts/INSTANCE_ID",
          destination: "https://app.hubspot.com/contacts/12345678",
          requestedAt: Date.now()
        }
      }),
      wait: async () => {}
    });
  });
  const copy = page.getByRole("button", { name: "Copy diagnostics" });
  const report = page.getByRole("link", { name: "Report route" });
  const reportUrl = new URL(await report.getAttribute("href"));
  assert.equal(reportUrl.searchParams.get("template"), "route-report.md");
  assert.equal(reportUrl.searchParams.get("title"), "Route: Contacts");
  assert.match(reportUrl.searchParams.get("body"), /HS Nav route: Contacts/);
  assert.doesNotMatch(reportUrl.href, /12345678/);
  await copy.click();
  await page.getByRole("button", { name: "Copy failed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copy failed" }).isEnabled(), true);
  assert.deepEqual(errors, []);
  await page.close();
}

async function testSettings(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = collectErrors(page);
  await page.goto(`${origin}/dist/options.html?preview=1`, { waitUntil: "networkidle" });
  await page.getByText(/104 destinations/).waitFor();

  const add = page.getByRole("button", { name: "Add destination" });
  await add.click();
  const drawer = page.getByRole("dialog", { name: /Add destination/i });
  await drawer.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "keyword");
  assert.equal(await activeLabel(page), "Keyword");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await activeText(page), "Save destination");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(220);
  assert.equal(await add.evaluate((element) => element === document.activeElement), true);

  await page.locator("#routeTypeFilter").selectOption("custom");
  await page.getByText("Customer success workspace", { exact: true }).waitFor();
  assert.match(await page.locator("#visibleCount").textContent(), /^1 destination$/);

  await page.getByRole("button", { name: "Data & backup" }).click();
  const previewImport = page.getByRole("button", { name: "Preview changes" });
  assert.equal(await previewImport.isDisabled(), true);
  await page.getByRole("button", { name: "Show export JSON" }).click();
  const exported = JSON.parse(await page.locator("#transferData").inputValue());
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.customRoutes.map(({ id }) => id).sort(), ["preview-contacts", "preview-success"]);
  assert.equal(await page.locator("#importMode").inputValue(), "append");
  assert.equal(await previewImport.isEnabled(), true);
  await page.locator("#transferData").fill("");
  assert.equal(await previewImport.isDisabled(), true);
  await page.locator("#uploadInput").setInputFiles({
    name: "hs-nav-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported))
  });
  await page.getByText(/Loaded “hs-nav-backup\.json”\. Next, preview the changes/).waitFor();
  assert.equal(await previewImport.isEnabled(), true);
  assert.equal(await previewImport.evaluate((element) => element === document.activeElement), true);
  let importPreview = "";
  page.once("dialog", (dialog) => {
    importPreview = dialog.message();
    return dialog.accept();
  });
  await previewImport.click();
  await page.getByText(/Append import applied — custom routes: 0 added, 0 removed; favorites: 0 added, 0 removed/).waitFor();
  assert.equal(importPreview, [
    "Restore behavior: Append",
    "Custom routes: 0 added, 0 removed",
    "Favorites: 0 added, 0 removed",
    "",
    "Apply this import?"
  ].join("\n"));

  await page.getByRole("button", { name: "Personalization" }).click();
  const removeContacts = page.getByRole("button", { name: "Remove contacts from favorites", exact: false });
  await removeContacts.waitFor();
  assert.equal(await removeContacts.textContent(), "★");
  assert.equal(await removeContacts.evaluate((element) => getComputedStyle(element).color), "rgb(166, 75, 8)");
  await removeContacts.click();
  await page.getByText(/Removed “Contacts” from favorites/).waitFor();

  await page.getByRole("button", { name: "Data & backup" }).click();
  const overwritePayload = {
    ...exported,
    customRoutes: [exported.customRoutes.find(({ id }) => id === "preview-success")],
    favoriteIds: ["deals"]
  };
  await page.locator("#transferData").fill(JSON.stringify(overwritePayload));
  await page.locator("#importMode").selectOption("overwrite");
  let overwritePreview = "";
  page.once("dialog", (dialog) => {
    overwritePreview = dialog.message();
    return dialog.accept();
  });
  await previewImport.click();
  await page.getByText(/Overwrite import applied — custom routes: 0 added, 1 removed; favorites: 0 added, 1 removed/).waitFor();
  assert.equal(overwritePreview, [
    "Restore behavior: Overwrite",
    "Custom routes: 0 added, 1 removed",
    "Favorites: 0 added, 1 removed",
    "",
    "Apply this import?"
  ].join("\n"));
  await page.getByRole("button", { name: "Show export JSON" }).click();
  const overwritten = JSON.parse(await page.locator("#transferData").inputValue());
  assert.deepEqual(overwritten.customRoutes.map(({ id }) => id), ["preview-success"]);
  assert.deepEqual(overwritten.favoriteIds, ["deals"]);

  await page.getByRole("button", { name: "Destinations", exact: true }).click();
  await page.getByRole("heading", { name: "Destinations" }).waitFor();
  for (const width of [1100, 1024, 700, 640, 320]) {
    await page.setViewportSize({ width, height: 760 });
    const { sizes, layout } = await page.evaluate(() => ({
      sizes: { viewport: innerWidth, content: document.documentElement.scrollWidth },
      layout: {
        pageHeader: getComputedStyle(document.querySelector(".page-header")).display,
        tableHeader: getComputedStyle(document.querySelector(".route-table-header")).display,
        toolbarColumns: getComputedStyle(document.querySelector(".toolbar")).gridTemplateColumns.split(" ").length,
        routeColumns: getComputedStyle(document.querySelector(".route-row")).gridTemplateColumns.split(" ").length,
        routeTypeAlignment: getComputedStyle(document.querySelector(".route-type")).justifySelf
      }
    }));
    assert.ok(sizes.content <= sizes.viewport, `${width}px settings layout overflows by ${sizes.content - sizes.viewport}px`);
    assert.equal(layout.tableHeader, width > 1080 ? "grid" : "none");
    if (width <= 1080) assert.equal(layout.routeTypeAlignment, "end");
    if (width <= 700) {
      assert.equal(layout.pageHeader, "block");
      assert.equal(layout.toolbarColumns, 1);
      assert.equal(layout.routeColumns, 1);
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
}

async function testSettingsRetry(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  const errors = collectErrors(page);
  await page.route("**/navigation.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{\"navigation\":null}"
  }));
  await page.goto(`${origin}/dist/options.html?preview=1`, { waitUntil: "networkidle" });
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.textContent(), /catalog is invalid/i);
  await page.unroute("**/navigation.json");
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText(/104 destinations/).waitFor();
  assert.equal(await alert.isHidden(), true);
  assert.deepEqual(errors, []);
  await page.close();
}

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

function activeLabel(page) {
  return page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.getAttribute("aria-label") ?? active?.labels?.[0]?.textContent?.trim() ?? "";
  });
}

function activeText(page) {
  return page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.textContent ?? "";
  });
}

function mimeType(file) {
  return ({
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".png": "image/png"
  })[path.extname(file)] ?? "application/octet-stream";
}

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

assert.equal(manifest.version, packageJson.version, "manifest and package versions must match");

const expected = new Set(["manifest.json", "navigation.json"]);
const pending = [];
const addReference = (reference, parent = "manifest.json") => {
  if (!reference || isExternal(reference)) return;
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(parent), cleanReference));
  assert.ok(cleanReference && !path.posix.isAbsolute(cleanReference), `${parent} contains an absolute asset reference: ${reference}`);
  assert.ok(resolved !== ".." && !resolved.startsWith("../"), `${parent} contains an unsafe asset reference: ${reference}`);
  if (!expected.has(resolved)) {
    expected.add(resolved);
    pending.push(resolved);
  }
};

addReference(manifest.background?.service_worker);
addReference(manifest.options_page);
addReference(manifest.devtools_page);
addReference(manifest.side_panel?.default_path);
for (const reference of Object.values(manifest.chrome_url_overrides ?? {})) addReference(reference);
for (const reference of Object.values(manifest.icons ?? {})) addReference(reference);
for (const reference of Object.values(manifest.action?.default_icon ?? {})) addReference(reference);
addReference(manifest.action?.default_popup);
for (const script of manifest.content_scripts ?? []) {
  for (const reference of [...(script.js ?? []), ...(script.css ?? [])]) addReference(reference);
}
for (const resourceGroup of manifest.web_accessible_resources ?? []) {
  for (const reference of resourceGroup.resources ?? []) addReference(reference);
}

while (pending.length) {
  const reference = pending.shift();
  const contents = await readFile(path.join(dist, reference), "utf8");
  if (reference.endsWith(".html")) {
    for (const match of contents.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) addReference(match[1], reference);
  }
  if (reference.endsWith(".css")) {
    for (const match of contents.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) addReference(match[1], reference);
    for (const match of contents.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi)) addReference(match[1], reference);
  }
}

const actual = new Set(await listFiles(dist));
assert.deepEqual([...actual].sort(), [...expected].sort(), "dist must contain only referenced runtime files");

console.log(`Verified ${expected.size} runtime files in a self-contained dist/.`);

function isExternal(reference) {
  return reference.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference);
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else assert.fail(`dist contains an unsupported filesystem entry: ${relative}`);
  }
  return files;
}

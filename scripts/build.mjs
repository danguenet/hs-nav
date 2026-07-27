import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { renderNavigation, validateCatalog } from "./navigation-lib.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const catalog = JSON.parse(await readFile("catalog/navigation-source.json", "utf8"));
const navigation = catalog.entries.map(({ id, keyword, path }) => ({ id, keyword, path }));
const catalogErrors = validateCatalog(catalog);

if (manifest.version !== packageJson.version) {
  throw new Error(`Manifest version ${manifest.version} does not match package version ${packageJson.version}.`);
}
if (catalogErrors.length) {
  throw new Error(`Navigation catalog is invalid:\n${catalogErrors.join("\n")}`);
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("extension", "dist", { recursive: true });
await writeFile("dist/navigation.json", renderNavigation(catalog.entries));

await build({
  entryPoints: {
    background: "src/background/index.mjs",
    contentScript: "src/content/index.mjs",
    options: "src/options/index.mjs"
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  minify: false,
  logLevel: "info"
});

console.log(`Built HS Nav ${packageJson.version} with ${navigation.length} routes in dist/.`);

# Release Checklist

1. Confirm the release is being prepared from a clean, reviewed `main` commit.
2. Synchronize the version in `package.json`, `package-lock.json`, and `extension/manifest.json`.
3. Update `CHANGELOG.md` and confirm the privacy policy, Chrome Web Store disclosures, screenshots, permissions, and listing copy remain consistent.
4. Run `npm ci` and `npm run check` with Node.js 24 and Chrome 120 or newer.
5. Load `dist/` as an unpacked extension and manually verify the keyboard command, toolbar action, options page, one maintained route, and one custom route.
6. Inspect `dist/`, then create the store archive from its contents only: `cd dist && zip -r ../hs-nav.zip .`.
7. Confirm the ZIP contains extension files at its root, record `shasum -a 256 hs-nav.zip`, and retain the successful workflow artifact for the reviewed commit.
8. Tag the exact reviewed commit as `v<version>` and publish a GitHub Release with the matching changelog entry and `hs-nav.zip` asset.

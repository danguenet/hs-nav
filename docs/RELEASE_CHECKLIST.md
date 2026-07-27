# Release Checklist

1. Confirm the release is being prepared from a clean, reviewed `main` commit.
2. Synchronize the version in `package.json`, `package-lock.json`, and `extension/manifest.json`.
3. Update `CHANGELOG.md` and confirm the privacy policy, Chrome Web Store disclosures, screenshots, permissions, and listing copy remain consistent.
4. Run `npm ci` and `npm run check` with Node.js 22 and Chrome 120 or newer.
5. Load `dist/` as an unpacked extension and manually verify the keyboard command, toolbar action, options page, one maintained route, and one custom route.
6. Tag the exact reviewed commit as `v<version>` and push the tag.
7. Confirm the tag workflow succeeds. It rejects a tag that differs from `package.json`, tests and packages the tagged commit once, and publishes `hs-nav-v<version>.zip` plus its `.sha256` file as GitHub Release assets.
8. Download both release assets, run `shasum -a 256 --check hs-nav-v<version>.zip.sha256`, inspect the ZIP, and use that exact archive for the Chrome Web Store submission.

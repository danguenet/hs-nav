# Maintainer Guide

## Repository layout

- `src/` contains runtime modules.
- `extension/` contains static Manifest V3 files and icons.
- `catalog/navigation-source.json` is the canonical maintained route source.
- `scripts/` contains deterministic build, package, and route-audit tooling.
- `test/` contains unit and browser smoke tests.
- `dist/` is generated and must not be committed.

## Auditing HubSpot navigation

Install dependencies and start the audit from a logged-in HubSpot portal:

```bash
npm ci
npm run audit:navigation
```

The audit opens a headed Chrome window with an isolated profile in `.hs-nav-audit/`. Sign in manually, open the portal to inspect, and type the exact `AUDIT <portal ID>` phrase shown in the terminal. Authorization is required on every run.

The audit reads navigation links and configuration; it does not create, edit, or delete HubSpot data. It refuses to update the review date when no navigation evidence is collected, a route probe is incomplete, or approved portals disagree about a destination. Multiple portals can be approved during one run to cover different subscriptions and Partner tools.

Login state remains only in the ignored audit profile. Delete `.hs-nav-audit/` to revoke the retained session.

Preview an audit without changing files:

```bash
npm run audit:navigation -- --dry-run
npm run audit:navigation -- --dry-run --json
```

Run the audit quarterly, then review `catalog/navigation-source.json` and `catalog/UNRESOLVED_ROUTES.md`. Include locked routes only when a vetted product path is known. Never substitute pricing, upgrade, authentication, or promotional pages for product destinations.

A route probe is a read-only request using the explicitly approved audit session. It does not follow redirects automatically and accepts a redirect only when it points to a concrete HubSpot product path.

## Validation and releases

Run the full validation suite before every release:

```bash
npm ci
npm run check
```

Follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) to inspect and tag the reviewed commit. The tag workflow validates `v<version>` against the synchronized project versions, then promotes the tested workflow artifact into a GitHub Release without rebuilding it.

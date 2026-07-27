# Contributing to HS Nav

Thank you for helping improve HS Nav.

## Before you start

- Use a bug-report issue for reproducible extension problems.
- Use a route-report issue for missing, stale, or incorrect HubSpot destinations.
- Start a discussion before investing in a substantial UX or behavior change.
- Report security or privacy concerns privately as described in [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 24 and Chrome 120 or newer.

```bash
npm ci
npm run check
```

`npm run check` runs linting, unit tests, route-catalog validation, a clean build, package verification, and browser smoke tests.

## Making changes

1. Fork the repository and create a focused branch.
2. Keep runtime code in `src/`, static extension files in `extension/`, and tests in `test/`.
3. Update tests and documentation with behavior changes.
4. Run `npm run check` before opening a pull request.
5. Explain the user impact and validation performed in the pull request.

Do not commit `dist/`, browser profiles, release archives, credentials, or local test output.

## Route changes

`catalog/navigation-source.json` is the canonical source for maintained routes. Do not edit generated `dist/navigation.json` or guess paths for tools that are unavailable to your HubSpot account.

For a straightforward correction, update the canonical catalog and run:

```bash
npm run audit:navigation:check
npm test
```

Maintainers with an approved HubSpot portal can use the read-only audit workflow documented in [docs/MAINTAINING.md](docs/MAINTAINING.md).

## Pull requests

Pull requests should be small enough to review, pass CI, and avoid unrelated formatting or generated-file changes. By contributing, you agree that your contribution is licensed under the repository's MIT License.

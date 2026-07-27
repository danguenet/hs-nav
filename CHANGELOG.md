# Changelog

All notable changes to HS Nav are documented in this file.

## [2.0.0] - 2026-07-27

### Added

- Ranked, typo-tolerant destination search with favorites and recents.
- Custom destination editing with explicit subdomain and account behavior.
- Settings backup import and export with validation and conflict previews.
- Route-outcome feedback and sanitized GitHub route reporting.
- A maintained route catalog with an authorized, read-only audit workflow.
- Unit, catalog, package, and browser smoke-test coverage.

### Changed

- Reorganized extension sources into modular `src/`, `extension/`, and `catalog/` directories.
- Made `dist/` the only generated extension package and release input.
- Expanded support to secure regional and product-specific HubSpot subdomains.
- Raised the minimum supported browser version to Chrome 120.

[2.0.0]: https://github.com/danguenet/hs-nav/releases/tag/v2.0.0

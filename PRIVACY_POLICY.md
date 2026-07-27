# Privacy Policy

**Performance RevOps LLC dba HS Nav**

Last updated: July 27, 2026

HS Nav is a Chrome extension for navigating within HubSpot. This policy describes the data the extension processes, where it is stored, and when it leaves the browser.

## Data handling

HS Nav does not operate a server, include analytics or advertising, or send extension usage data to Performance RevOps LLC.

The extension processes the current HubSpot page URL to identify the active account and build the destination selected by the user. It stores:

- the bundled route catalog, recent destination identifiers, and remembered HubSpot account IDs in Chrome local storage;
- custom destinations and favorites in Chrome sync storage when browser sync is enabled; and
- a short-lived route attempt in Chrome session storage so the destination page can show navigation feedback.

Custom destinations are user-provided and can include a HubSpot account ID, query parameters, or other information contained in the pasted URL. Users should avoid saving secrets or unnecessary personal information in a custom destination. Chrome, not HS Nav, operates the browser sync service and controls its retention and transmission.

## Optional route reports

For a maintained route that appears stale, the extension can open a GitHub issue form after the user clicks **Report route**. Before opening GitHub, HS Nav removes query strings and fragments and replaces long numeric path segments with `INSTANCE_ID`. GitHub receives the sanitized route diagnostics in the issue-form URL when the report link is opened; the user can review or discard the issue before submitting it. HS Nav does not offer public issue reporting for custom destinations.

## Permissions

- **`storage`** stores the local, synced, and session data described above.
- **HubSpot host access** lets the launcher run on secure `hubspot.com` subdomains and navigate between HubSpot product pages. HS Nav does not request access to non-HubSpot sites.

## Control and deletion

Users can edit or reset custom destinations, favorites, and recents in HS Nav settings. Uninstalling the extension removes its local browser data; Chrome controls deletion and retention of any synced copy. Browser permissions can be reviewed or revoked in Chrome settings.

Performance RevOps LLC does not hold a separate copy of this data and therefore cannot retrieve or delete data stored only by the user's browser or Chrome account.

## Changes

Material changes will be published with an updated date in this policy and, where applicable, in the Chrome Web Store listing.

## Contact

Questions about this policy can be sent to [dan@performancerevops.com](mailto:dan@performancerevops.com).

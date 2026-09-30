# Changelog

## 1.0.4 (2026-09-30)

- Unify the visible product name as BackgroundChanger, retaining the existing
  backgroundchanger app ID, certificate, settings and update channel.
- Merge the published settings fixes with the previously missing collapsed
  attribution and print-hiding fix.
- Guard releases against stale/divergent source trees and add browser
  regression checks for attribution behavior.


## 1.0.3 (2026-09-30)

- Restore the previously approved collapsed attribution badge and print hiding.
- Preserve Nextcloud 35, Wikimedia hosting and 1.0.2 theme-settings fixes.

## 1.0.2 (2026-09-26)

- Display an accessible inline save error even when the deprecated
  `OC.Notification` API is unavailable, preserving the previous saved choice.
- Support arrow-key and space-key theme selection through the same validated
  save endpoint as mouse selection, without duplicate writes.
- Assert HTTP status, OCS status and persisted values in the declarative-settings
  contract check; add regression tests for rejected responses and persistence.
- Verify all themes, keyboard selection, visible HTTP/response/network failures
  and rejected unauthenticated/CSRF-free/invalid writes in a real isolated
  Nextcloud 35 installation for ordinary users and administrators.

## 1.0.1 (2026-09-25)

- Extend the supported Nextcloud version range to 34–35.
- Accept Wikimedia Commons' official `thumb.wikimedia.org` thumbnail endpoint,
  restoring cache refreshes while retaining exact-host, path, license and image
  validation. Add regression coverage for the endpoint and rejected lookalikes.
- Adapt the cache test double to Nextcloud 35's `ISimpleFolder` contract and
  verify that getting or creating a folder preserves an existing folder.
- Require an explicit browser target when tests connect to a shared browser.
- Adapt personal-background UI checks to Nextcloud 35's button labels and
  compare consecutive background selections rather than non-consecutive ones.

## ImageChanger 1.0.0 (unreleased)

- Introduce the independent `backgroundchanger` identifier and
  `OCA\BackgroundChanger` namespace.
- Add persistent personal choices for Default, Off, Landscapes, Animals, Space
  and Architecture in Nextcloud's appearance settings.
- Keep separate bounded local caches and Commons category allow-lists per
  visual theme.
- Rotate after page loads, same-origin links, internal router navigation,
  semantic non-link menu controls (including repeated current-route clicks),
  browser history changes and every five minutes, with local image delivery and
  complete attribution.
- Derive the app icon from the central `chrissi0285` symbol and display
  `designed by chrissi0285`.
- Use `chrissi0285` exclusively in public author and copyright metadata.

## Wechselbild predecessor history

- 1.0.3 added stable SPA and timed rotation.
- 1.0.2 decoded images before atomically switching image and attribution.
- 1.0.1 removed a duplicate initial background selection.
- 1.0.0 introduced the first independent Wikimedia Commons cache.

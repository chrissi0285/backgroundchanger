# Changelog

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

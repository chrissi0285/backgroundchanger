# Changelog

## Background Changer 1.0.0 (unreleased)

- Introduce the independent `backgroundchanger` identifier and
  `OCA\BackgroundChanger` namespace.
- Add persistent personal choices for Default, Off, Landscapes, Animals, Space
  and Architecture in Nextcloud's appearance settings.
- Keep separate bounded local caches and Commons category allow-lists per
  visual theme.
- Retain safe page-load, SPA-navigation and five-minute rotation with local
  image delivery and complete attribution.
- Derive the app icon from the central `chrissi0285` symbol and display
  `designed by chrissi0285`.
- Use `chrissi0285` exclusively in public author and copyright metadata.

## Wechselbild predecessor history

- 1.0.3 added stable SPA and timed rotation.
- 1.0.2 decoded images before atomically switching image and attribution.
- 1.0.1 removed a duplicate initial background selection.
- 1.0.0 introduced the first independent Wikimedia Commons cache.

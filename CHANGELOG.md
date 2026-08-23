# Changelog

## 1.0.0

- Introduce the independent `wechselbild` app identifier and namespace.
- Fetch curated landscape images through Nextcloud's protected HTTP client.
- Request fixed 1920-pixel Commons thumbnails to avoid oversized derivatives.
- Validate source hosts, licenses, metadata, response size and image content.
- Rotate a bounded local cache with a persistent offline fallback.
- Serve immutable same-origin images and show source attribution.
- Respect explicitly configured personal Nextcloud backgrounds.

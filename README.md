# BackgroundChanger

BackgroundChanger shows rotating Wikimedia Commons backgrounds on Nextcloud
34 and 35. It rotates on page loads, same-origin link clicks, internal router changes
(including semantic non-link menu controls), browser Back/Forward and every
five minutes while the page is visible. Clicking an already active Nextcloud
route also selects a new background. Images are validated and served from
small local caches; the browser never contacts an image provider. Cached images
remain available when the server is temporarily offline.

Attribution rests behind a small information badge. Hover, keyboard focus or a
click makes the author, source and licence accessible without a permanent box
over page content. The attribution is hidden when printing.

## Themes

Signed-in users can choose **Default**, **Off**, **Landscapes**, **Animals**,
**Space** or **Architecture** in Nextcloud's personal appearance settings.
Default and the anonymous login page use Landscapes. A personal background
chosen with Nextcloud's own theming controls always takes precedence.

Each curated theme has a separate cache with three to six images. The first
refresh fills missing offline fallbacks. Later six-hour refreshes rotate through
one theme at a time to limit provider traffic, storage and CPU use.

## Security and privacy

- App identifier `backgroundchanger` and namespace `OCA\BackgroundChanger`
- Nextcloud 34–35 and PHP 8.2–8.5 (subject to the server's PHP requirements)
- fixed 1920-pixel Wikimedia Commons thumbnails
- strict image host, MIME type, dimensions, response size and free-license
  allow-lists
- same-origin image delivery and no provider requests from visitors' browsers
- visible work title, author, license and Commons source attribution
- local fallback before the first successful refresh and during outages

Refresh the bounded caches as the web-server user:

```console
php occ backgroundchanger:refresh
```

## Design, provenance and license

The application symbol is derived from the central `chrissi0285` design source
and the interface carries the exact line `designed by chrissi0285`. Public
author and copyright metadata use `chrissi0285` exclusively.

This AGPL-3.0-or-later project is a cleanly renamed successor to
[`nextcloud/unsplash`](https://github.com/nextcloud/unsplash). Git history keeps
the upstream authorship. BackgroundChanger uses its own identifier and will
only be distributed with a certificate issued specifically for
`backgroundchanger`; no upstream or predecessor signing material is reused.

Every cached image keeps its Wikimedia Commons author, source and free-license
metadata. See [LICENSE.md](LICENSE.md) for the application license.


## Development and releases

Use BackgroundChanger as the product name and `backgroundchanger` as the
lowercase app, repository and package identifier. There is one maintained
`main` branch. See [RELEASE.md](RELEASE.md) for required regression checks,
clean-tag package construction, signing and publication of the same artifact.

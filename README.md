# Wechselbild

Wechselbild shows a different curated landscape background on each Nextcloud
page load. Images are fetched sparingly from Wikimedia Commons, validated and
served from a small local cache. Once at least one image was fetched, an
internet outage does not remove the background or impair the Nextcloud UI.

## Design

- Nextcloud 34 and PHP 8.2–8.5
- app identifier `wechselbild`
- curated `Featured pictures of landscapes` from Wikimedia Commons
- four images on the first refresh, then one every six hours, at most eight
- same-origin image delivery; visitors never contact an image provider
- visible work title, author, license and Commons source attribution
- users with an explicitly selected personal Nextcloud background are left
  untouched
- safe CSS gradient before the first successful refresh

Run a refresh as the web-server user:

```console
php occ wechselbild:refresh
```

## Provenance and license

This AGPL-3.0-or-later project is a cleanly renamed successor to
[`nextcloud/unsplash`](https://github.com/nextcloud/unsplash). Its Git history
retains the original authorship. The new cache and Wikimedia integration were
written for the independent identifier `wechselbild`; no upstream signing
material is included or reused.

Each cached image keeps its own Wikimedia Commons author, source and free
license metadata. The app accepts only an explicit allow-list of Commons
licenses and does not alter the downloaded image.

Only the server-side background job connects to Wikimedia Commons. Browser
requests remain on the Nextcloud origin, so visitors do not disclose their IP
address or navigation to the image provider.

See [LICENSE.md](LICENSE.md) for the application license.

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(() => {
	'use strict'

	const meta = document.querySelector('meta[name="wechselbild-endpoint"]')
	if (!meta) {
		return
	}

	const endpoint = sameOriginUrl(meta.content)
	if (!endpoint) {
		return
	}

	let lastRotation = 0
	let activeRequest = null

	function sameOriginUrl(value) {
		try {
			const url = new URL(value, window.location.origin)
			return url.origin === window.location.origin ? url : null
		} catch (error) {
			return null
		}
	}

	function externalUrl(value, allowedHost) {
		try {
			const url = new URL(value)
			return url.protocol === 'https:' && url.hostname === allowedHost ? url : null
		} catch (error) {
			return null
		}
	}

	function previousId() {
		try {
			return window.sessionStorage.getItem('wechselbild-last') || ''
		} catch (error) {
			return ''
		}
	}

	function rememberId(id) {
		try {
			window.sessionStorage.setItem('wechselbild-last', id)
		} catch (error) {
			// A blocked session store must never block the background itself.
		}
	}

	function link(text, url) {
		const anchor = document.createElement('a')
		anchor.textContent = text
		anchor.href = url.href
		anchor.target = '_blank'
		anchor.rel = 'noopener noreferrer'
		return anchor
	}

	function renderCredit(background) {
		const source = externalUrl(background.sourceUrl, 'commons.wikimedia.org')
		const licence = externalUrl(background.licenseUrl, 'creativecommons.org')
		if (!source || !licence) {
			return false
		}

		let credit = document.getElementById('wechselbild-credit')
		if (!credit) {
			credit = document.createElement('aside')
			credit.id = 'wechselbild-credit'
			credit.setAttribute('aria-label', 'Bildnachweis')
			document.body.appendChild(credit)
		}

		credit.replaceChildren(
			document.createTextNode('Bild: '),
			link(background.title, source),
			document.createTextNode(' · '),
			link(background.author, source),
			document.createTextNode(' · '),
			link(background.license, licence),
			document.createTextNode(' · '),
			link('Wikimedia Commons', source),
		)
		if (background.description) {
			credit.title = background.description
		} else {
			credit.removeAttribute('title')
		}
		return true
	}

	async function rotate() {
		const now = Date.now()
		if (now - lastRotation < 300) {
			return
		}
		lastRotation = now

		if (activeRequest) {
			activeRequest.abort()
		}
		const controller = new AbortController()
		activeRequest = controller
		const timeout = window.setTimeout(() => controller.abort(), 5000)

		try {
			const url = new URL(endpoint.href)
			const exclude = previousId()
			if (/^[a-f0-9]{32}$/.test(exclude)) {
				url.searchParams.set('exclude', exclude)
			}

			const response = await window.fetch(url.href, {
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { Accept: 'application/json' },
				signal: controller.signal,
			})
			if (!response.ok) {
				return
			}

			const payload = await response.json()
			const background = payload.background
			if (!background || !/^[a-f0-9]{32}$/.test(background.id)) {
				return
			}

			const image = sameOriginUrl(background.image)
			if (!image || !image.pathname.includes('/apps/wechselbild/api/image/')) {
				return
			}
			if (typeof background.title !== 'string' || background.title.length === 0
				|| typeof background.author !== 'string' || background.author.length === 0
				|| typeof background.license !== 'string' || background.license.length === 0
				|| typeof background.sourceUrl !== 'string'
				|| typeof background.licenseUrl !== 'string') {
				return
			}
			if (!renderCredit(background)) {
				return
			}

			document.documentElement.style.setProperty('--wechselbild-image', `url("${image.href}")`)
			rememberId(background.id)
		} catch (error) {
			if (error?.name !== 'AbortError') {
				console.debug('Wechselbild: lokaler Hintergrund nicht verfügbar')
			}
		} finally {
			window.clearTimeout(timeout)
			if (activeRequest === controller) {
				activeRequest = null
			}
		}
	}

	function rotateForNavigation(event) {
		const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
		if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
			return
		}
		const target = sameOriginUrl(anchor.href)
		if (!target || target.href === window.location.href) {
			return
		}
		window.setTimeout(() => void rotate(), 0)
	}

	document.addEventListener('click', rotateForNavigation, true)
	window.addEventListener('pageshow', () => void rotate())
	window.addEventListener('popstate', () => void rotate())
	window.addEventListener('hashchange', () => void rotate())
	void rotate()
})()

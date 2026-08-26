/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(() => {
	'use strict'

	const meta = document.querySelector('meta[name="backgroundchanger-endpoint"]')
	if (!meta) {
		return
	}

	const endpoint = sameOriginUrl(meta.content)
	const themes = new Set(['landscapes', 'animals', 'space', 'architecture'])
	let activeTheme = meta.dataset.theme || ''
	if (!endpoint || !themes.has(activeTheme)) {
		return
	}

	const ROTATION_INTERVAL_MS = 5 * 60 * 1000
	const NAVIGATION_GRACE_MS = 250
	let activeRequest = null
	let rotationTimer = null
	let linkNavigationTimer = null
	let routeRevision = 0
	let observedHref = window.location.href
	let pageShown = false

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

	function previousId(theme) {
		try {
			return window.sessionStorage.getItem(`backgroundchanger-last-${theme}`) || ''
		} catch (error) {
			return ''
		}
	}

	function rememberId(theme, id) {
		try {
			window.sessionStorage.setItem(`backgroundchanger-last-${theme}`, id)
		} catch (error) {
			// A blocked session store must never block the background itself.
		}
	}

	async function decodeImage(url, signal) {
		if (signal.aborted) {
			throw new DOMException('Aborted', 'AbortError')
		}
		const image = new Image()
		image.decoding = 'async'
		image.src = url.href

		let abort
		const aborted = new Promise((unused, reject) => {
			abort = () => reject(new DOMException('Aborted', 'AbortError'))
			signal.addEventListener('abort', abort, { once: true })
		})
		try {
			await Promise.race([image.decode(), aborted])
			if (signal.aborted) {
				throw new DOMException('Aborted', 'AbortError')
			}
			if (image.naturalWidth === 0 || image.naturalHeight === 0) {
				throw new Error('Decoded background has no dimensions')
			}
		} finally {
			signal.removeEventListener('abort', abort)
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

	/**
	 * The badge stays collapsed so it never covers page content. Hover and
	 * keyboard focus unfold it through CSS alone; the button keeps the
	 * attribution reachable on touch devices too.
	 */
	function creditElement() {
		const existing = document.getElementById('backgroundchanger-credit')
		if (existing) {
			return existing
		}

		const credit = document.createElement('aside')
		credit.id = 'backgroundchanger-credit'
		credit.setAttribute('aria-label', 'Image attribution')

		const toggle = document.createElement('button')
		toggle.type = 'button'
		toggle.className = 'backgroundchanger-toggle'
		toggle.textContent = 'i'
		toggle.setAttribute('aria-expanded', 'false')
		toggle.setAttribute('aria-label', 'Show image attribution')
		toggle.addEventListener('click', () => {
			toggle.setAttribute('aria-expanded', credit.toggleAttribute('data-open') ? 'true' : 'false')
		})
		credit.addEventListener('keydown', event => {
			if (event.key === 'Escape' && credit.hasAttribute('data-open')) {
				credit.removeAttribute('data-open')
				toggle.setAttribute('aria-expanded', 'false')
				toggle.focus()
			}
		})

		const panel = document.createElement('div')
		panel.className = 'backgroundchanger-panel'

		credit.append(toggle, panel)
		document.body.appendChild(credit)
		return credit
	}

	function renderCredit(background) {
		const source = externalUrl(background.sourceUrl, 'commons.wikimedia.org')
		const licence = externalUrl(background.licenseUrl, 'creativecommons.org')
		if (!source || !licence) {
			return false
		}

		const credit = creditElement()
		const panel = credit.querySelector('.backgroundchanger-panel')

		const attribution = document.createElement('span')
		attribution.className = 'backgroundchanger-attribution'
		attribution.append(
			document.createTextNode('Image: '),
			link(background.title, source),
			document.createTextNode(' · '),
			link(background.author, source),
			document.createTextNode(' · '),
			link(background.license, licence),
			document.createTextNode(' · '),
			link('Wikimedia Commons', source),
		)
		const design = document.createElement('span')
		design.className = 'backgroundchanger-design'
		design.textContent = 'designed by chrissi0285'
		panel.replaceChildren(attribution, design)
		if (background.description) {
			panel.title = background.description
		} else {
			panel.removeAttribute('title')
		}
		return true
	}

	function clearBackground() {
		document.documentElement.style.removeProperty('--backgroundchanger-image')
		document.documentElement.removeAttribute('data-backgroundchanger-ready')
		document.documentElement.removeAttribute('data-backgroundchanger-theme')
		document.documentElement.setAttribute('data-backgroundchanger-disabled', '')
		document.getElementById('backgroundchanger-credit')?.remove()
	}

	async function rotate() {
		document.documentElement.removeAttribute('data-backgroundchanger-ready')

		if (activeRequest) {
			activeRequest.abort()
		}
		const controller = new AbortController()
		activeRequest = controller
		const timeout = window.setTimeout(() => controller.abort(), 5000)

		try {
			const url = new URL(endpoint.href)
			const exclude = previousId(activeTheme)
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
			if (background === null) {
				clearBackground()
				return
			}
			if (!background || !themes.has(background.theme) || !/^[a-f0-9]{32}$/.test(background.id)) {
				return
			}

			const image = sameOriginUrl(background.image)
			if (!image || !image.pathname.includes(`/apps/backgroundchanger/api/image/${background.theme}/`)) {
				return
			}
			if (typeof background.title !== 'string' || background.title.length === 0
				|| typeof background.author !== 'string' || background.author.length === 0
				|| typeof background.license !== 'string' || background.license.length === 0
				|| typeof background.sourceUrl !== 'string'
				|| typeof background.licenseUrl !== 'string') {
				return
			}
			await decodeImage(image, controller.signal)
			if (!renderCredit(background)) {
				return
			}

			document.documentElement.removeAttribute('data-backgroundchanger-disabled')
			document.documentElement.style.setProperty('--backgroundchanger-image', `url("${image.href}")`)
			activeTheme = background.theme
			rememberId(activeTheme, background.id)
			document.documentElement.dataset.backgroundchangerTheme = activeTheme
			document.documentElement.dataset.backgroundchangerReady = background.id
		} catch (error) {
			if (error?.name !== 'AbortError' && !controller.signal.aborted) {
				console.debug('ImageChanger: local background unavailable')
			}
		} finally {
			window.clearTimeout(timeout)
			if (activeRequest === controller) {
				activeRequest = null
			}
		}
	}

	function scheduleRotation() {
		if (rotationTimer !== null) {
			window.clearTimeout(rotationTimer)
		}
		rotationTimer = window.setTimeout(() => {
			rotationTimer = null
			void rotate()
		}, 0)
	}

	function routeChanged() {
		observedHref = window.location.href
		routeRevision++
		if (linkNavigationTimer !== null) {
			window.clearTimeout(linkNavigationTimer)
			linkNavigationTimer = null
		}
		scheduleRotation()
	}

	document.addEventListener('click', event => {
		if (!pageShown || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return
		}
		const element = event.target instanceof Element ? event.target : null
		const anchor = element?.closest('a[href]') || null
		const control = anchor || element?.closest(
			'[role="link"], [role="tab"], [role="menuitem"][aria-current], '
			+ '[role="menuitem"][aria-selected], .app-navigation-entry-link',
		) || null
		const target = anchor?.getAttribute('target')?.toLowerCase() || ''
		if (!control || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true'
			|| (anchor && (anchor.hasAttribute('download') || (target !== '' && target !== '_self')
				|| !sameOriginUrl(anchor.href)))) {
			return
		}

		const revision = routeRevision
		if (linkNavigationTimer !== null) {
			window.clearTimeout(linkNavigationTimer)
		}
		linkNavigationTimer = window.setTimeout(() => {
			linkNavigationTimer = null
			if ((!anchor || event.defaultPrevented) && routeRevision === revision) {
				scheduleRotation()
			}
		}, NAVIGATION_GRACE_MS)
	}, true)

	window.navigation?.addEventListener('currententrychange', () => {
		if (pageShown && window.location.href !== observedHref) {
			routeChanged()
		}
	})

	for (const method of ['pushState', 'replaceState']) {
		const original = window.history[method]
		window.history[method] = function (...args) {
			const previous = window.location.href
			const result = Reflect.apply(original, this, args)
			if (pageShown && window.location.href !== previous) {
				routeChanged()
			}
			return result
		}
	}

	window.addEventListener('pageshow', () => {
		pageShown = true
		scheduleRotation()
	})
	window.addEventListener('popstate', routeChanged)
	window.addEventListener('hashchange', routeChanged)
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			scheduleRotation()
		}
	})
	window.setInterval(() => {
		if (document.visibilityState === 'visible') {
			scheduleRotation()
		}
	}, ROTATION_INTERVAL_MS)
})()

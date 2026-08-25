/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [, , debuggerBase, nextcloudBase, usernameArgument, passwordArgument, outputDirectory, mode = 'normal'] = process.argv
const username = usernameArgument === '@env' ? process.env.BACKGROUNDCHANGER_TEST_USERNAME : usernameArgument
const password = passwordArgument === '@env' ? process.env.BACKGROUNDCHANGER_TEST_PASSWORD : passwordArgument
const captureAuthenticatedPages = mode !== 'authenticated'
if (!debuggerBase || !nextcloudBase || !username || !password || !outputDirectory) {
	throw new Error('Usage: browser-test.mjs DEBUGGER_URL NEXTCLOUD_URL USER PASSWORD OUTPUT_DIR')
}

const ROTATION_INTERVAL_MS = 5 * 60 * 1000

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const targets = await fetch(`${debuggerBase}/json/list`).then(response => response.json())
const target = targets.find(candidate => candidate.type === 'page')
if (!target?.webSocketDebuggerUrl) {
	throw new Error('No Chrome page target available')
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
	socket.addEventListener('open', resolve, { once: true })
	socket.addEventListener('error', reject, { once: true })
})

let sequence = 0
const pending = new Map()
const requests = []
const exceptions = []

socket.addEventListener('message', event => {
	const message = JSON.parse(event.data)
	if (message.id && pending.has(message.id)) {
		const { resolve, reject } = pending.get(message.id)
		pending.delete(message.id)
		if (message.error) {
			reject(new Error(`${message.error.message} (${message.error.code})`))
		} else {
			resolve(message.result)
		}
		return
	}
	if (message.method === 'Network.requestWillBeSent') {
		requests.push(message.params.request.url)
	}
	if (message.method === 'Runtime.exceptionThrown') {
		exceptions.push(message.params.exceptionDetails.text)
	}
})

function command(method, params = {}) {
	const id = ++sequence
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params }))
	})
}

async function evaluate(expression) {
	const result = await command('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true,
	})
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.text)
	}
	return result.result.value
}

async function waitFor(expression, timeout = 20_000) {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		if (await evaluate(`Boolean(${expression})`)) {
			return
		}
		await sleep(200)
	}
	throw new Error(`Timed out waiting for: ${expression}`)
}

async function changesFrom(id, timeout = 4_000) {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		const current = await evaluate(`sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme) || ''`)
		if (current && current !== id) {
			return current
		}
		await sleep(100)
	}
	return ''
}

async function navigate(url) {
	await command('Page.navigate', { url })
	await waitFor(`document.readyState === 'complete'`)
}

async function waitForBackground() {
	await waitFor(`
		document.getElementById('backgroundchanger-credit')
		&& sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme)
		&& document.documentElement.dataset.backgroundchangerReady === sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme)
		&& getComputedStyle(document.documentElement).getPropertyValue('--backgroundchanger-image').includes('/apps/backgroundchanger/api/image/')
	`)
	await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
}

async function dismissOnboarding() {
	for (let attempt = 0; attempt < 40; attempt++) {
		const clicked = await evaluate(`(() => {
			const dialog = document.querySelector('[role="dialog"]')
			const close = dialog?.querySelector('button[aria-label="Schließen"], button[aria-label="Close"]')
			if (!close) return false
			close.click()
			return true
		})()`)
		if (clicked) {
			await waitFor(`!document.querySelector('[role="dialog"]')`)
			return true
		}
		await sleep(250)
	}
	return false
}

async function snapshot() {
	return evaluate(`(() => {
		const credit = document.getElementById('backgroundchanger-credit')
		return {
			url: location.href,
			theme: document.documentElement.dataset.backgroundchangerTheme || '',
			id: sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme),
			metaCount: document.querySelectorAll('meta[name="backgroundchanger-endpoint"]').length,
			creditText: credit?.textContent?.trim() || '',
			creditHosts: credit ? [...credit.querySelectorAll('a')].map(link => new URL(link.href).hostname) : [],
			readyId: document.documentElement.dataset.backgroundchangerReady || '',
			background: getComputedStyle(document.documentElement).getPropertyValue('--backgroundchanger-image').trim(),
			bodyBackground: getComputedStyle(document.body).backgroundImage,
		}
	})()`)
}

async function screenshot(name, clip = null) {
	const result = await command('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		captureBeyondViewport: false,
		...(clip ? { clip: { ...clip, scale: 1 } } : {}),
	})
	const data = Buffer.from(result.data, 'base64')
	writeFileSync(`${outputDirectory}/${name}.png`, data)
	return createHash('sha256').update(data).digest('hex')
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message)
	}
}

mkdirSync(outputDirectory, { recursive: true })
await command('Page.enable')
await command('Runtime.enable')
await command('Network.enable')
await command('Emulation.setDeviceMetricsOverride', {
	width: 1440,
	height: 900,
	deviceScaleFactor: 1,
	mobile: false,
})

if (mode === 'lifecycle' || mode === 'lifecycle-local') {
	await command('Page.addScriptToEvaluateOnNewDocument', {
		source: `(() => {
			const nativeSetInterval = window.setInterval.bind(window)
			window.__backgroundchangerIntervalDelays = []
			window.__backgroundchangerRunInterval = null
			window.setInterval = (handler, delay, ...args) => {
				if (delay === ${ROTATION_INTERVAL_MS}) {
					window.__backgroundchangerIntervalDelays.push(delay)
					window.__backgroundchangerRunInterval = () => handler(...args)
					return nativeSetInterval(() => {}, 2147483647)
				}
				return nativeSetInterval(handler, delay, ...args)
			}
		})()`,
	})
	if (mode === 'lifecycle-local') {
		await command('Network.setBlockedURLs', {
			urls: ['*/apps/backgroundchanger/js/background.js*'],
		})
		const localScript = readFileSync(new URL('../js/background.js', import.meta.url), 'utf8')
		await command('Page.addScriptToEvaluateOnNewDocument', {
			source: `document.addEventListener('DOMContentLoaded', () => {
				${localScript}
			}, { once: true })`,
		})
	}

	await navigate(`${nextcloudBase}/login?backgroundchanger-lifecycle=initial`)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	await waitForBackground()
	const initial = await snapshot()
	const requestCounts = () => ({
		selections: requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length,
		images: requests.filter(url => url.includes('/apps/backgroundchanger/api/image/')).length,
	})
	const stages = [{ name: 'initial', ...requestCounts() }]

	const intervalDelays = await evaluate(`window.__backgroundchangerIntervalDelays || []`)
	const hasInterval = intervalDelays.includes(ROTATION_INTERVAL_MS)
	const intervalInvoked = await evaluate(`(() => {
		if (typeof window.__backgroundchangerRunInterval !== 'function') return false
		window.__backgroundchangerRunInterval()
		return true
	})()`)
	const intervalId = intervalInvoked ? await changesFrom(initial.id) : ''
	stages.push({ name: 'interval', ...requestCounts() })

	const beforePush = intervalId || initial.id
	await evaluate(`history.pushState({}, '', '/login?backgroundchanger-lifecycle=push')`)
	const pushId = await changesFrom(beforePush)
	stages.push({ name: 'pushState', ...requestCounts() })

	const beforeReplace = pushId || beforePush
	await evaluate(`history.replaceState({}, '', '/login?backgroundchanger-lifecycle=replace')`)
	const replaceId = await changesFrom(beforeReplace)
	stages.push({ name: 'replaceState', ...requestCounts() })

	const reloadIds = []
	let previous = replaceId || beforeReplace
	for (let reload = 1; reload <= 4; reload++) {
		await command('Page.reload', { ignoreCache: false })
		await waitFor(`document.readyState === 'complete'`)
		await waitForBackground()
		const id = await evaluate(`sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme) || ''`)
		reloadIds.push(id)
		assert(id !== previous, `Reload ${reload} repeated the previous image`)
		previous = id
		stages.push({ name: `reload-${reload}`, ...requestCounts() })
	}
	const providerHosts = requests
		.filter(url => url.startsWith('http://') || url.startsWith('https://'))
		.map(url => new URL(url).hostname)
		.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))

	const result = {
		initialId: initial.id,
		intervalDelays,
		intervalChangedTo: intervalId,
		pushStateChangedTo: pushId,
		replaceStateChangedTo: replaceId,
		reloadIds,
		stages,
		providerRequests: providerHosts.length,
		exceptions,
	}
	console.log(JSON.stringify(result, null, 2))
	assert(hasInterval, `Missing ${ROTATION_INTERVAL_MS} ms rotation interval`)
	assert(intervalId !== '', 'Scheduled rotation did not change the background')
	assert(pushId !== '', 'history.pushState did not change the background')
	assert(replaceId !== '', 'history.replaceState did not change the background')
	for (let stage = 0; stage < stages.length; stage++) {
		assert(stages[stage].selections === stage + 1,
			`${stages[stage].name} must produce exactly one local selection`)
		assert(stages[stage].images >= 1 && stages[stage].images <= stage + 1,
			`${stages[stage].name} produced an invalid number of local image requests`)
		if (stage > 0) {
			assert(stages[stage].images >= stages[stage - 1].images,
				`${stages[stage].name} lost a previously observed local image request`)
		}
	}
	assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)
	socket.close()
	process.exit(0)
}

if (mode === 'personal') {
	await navigate(`${nextcloudBase}/index.php/apps/files/files`)
	await sleep(2000)
	const personal = await snapshot()
	await screenshot('files-personal-background')
	const selectionRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/background'))
	const imageRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/image/'))
	assert(personal.metaCount === 0, 'Personal background must suppress the Background Changer endpoint')
	assert(personal.creditText === '', 'Personal background must suppress Background Changer attribution')
	assert(!personal.background.includes('/apps/backgroundchanger/'), 'Personal background must not use Background Changer CSS')
	assert(selectionRequests.length === 0, 'Personal background must not request a Background Changer selection')
	assert(imageRequests.length === 0, 'Personal background must not request a Background Changer image')
	console.log(JSON.stringify({ personal, selectionRequests: 0, imageRequests: 0 }, null, 2))
	socket.close()
	process.exit(0)
}

if (mode === 'guest') {
	const pages = []
	for (let page = 1; page <= 3; page++) {
		await navigate(`${nextcloudBase}/login?backgroundchanger-product-check=${page}`)
		await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
		await waitForBackground()
		const pageState = await snapshot()
		pageState.backgroundCropHash = await screenshot(`product-login-${page}-background`, {
			x: 0,
			y: 50,
			width: 500,
			height: 700,
		})
		pages.push(pageState)
		await screenshot(`product-login-${page}`)
	}

	const providerHosts = requests
		.filter(url => url.startsWith('http://') || url.startsWith('https://'))
		.map(url => new URL(url).hostname)
		.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
	const selectionRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/background'))
	const imageRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/image/'))

	assert(pages.every(page => page.metaCount === 1), 'Each login page must contain exactly one endpoint meta tag')
	assert(pages.every(page => page.theme === 'landscapes'), 'Anonymous pages must use the safe landscape default')
	assert(pages.every(page => page.creditText.length > 0), 'Each login page must show attribution')
	assert(pages.every(page => page.creditText.includes('designed by chrissi0285')), 'Each login page must show the exact design line')
	assert(pages.every(page => page.readyId === page.id), 'Each login page must expose only a decoded background as ready')
	assert(pages.every(page => page.bodyBackground.includes('backgroundchanger')), 'Each login page must use a local Background Changer image')
	assert(new Set(pages.map(page => page.id)).size === pages.length, 'Consecutive login pages must use different images')
	assert(new Set(pages.map(page => page.backgroundCropHash)).size === pages.length, 'Consecutive login pages must paint different large background areas')
	assert(selectionRequests.length === pages.length, `Each login page must request exactly one local selection, got ${selectionRequests.length}`)
	assert(imageRequests.length === pages.length, `Each login page must request exactly one local image, got ${imageRequests.length}`)
	assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)

	console.log(JSON.stringify({
		pages,
		selectionRequests: selectionRequests.length,
		imageRequests: imageRequests.length,
		providerRequests: providerHosts.length,
		exceptions,
	}, null, 2))
	socket.close()
	process.exit(0)
}

await navigate(`${nextcloudBase}/login`)
await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
await waitForBackground()
const login = await snapshot()
if (captureAuthenticatedPages) {
	await screenshot('login-offline')
}

assert(login.metaCount === 1, 'Login page must contain exactly one endpoint meta tag')
assert(login.creditText.length > 0, 'Login page must show attribution')
assert(login.creditText.includes('designed by chrissi0285'), 'Login page must show the exact design line')
assert(login.bodyBackground.includes('backgroundchanger'), 'Login page must use a local Background Changer image')

await evaluate(`(() => {
	const user = document.querySelector('input[name="user"]')
	const pass = document.querySelector('input[name="password"]')
	user.value = ${JSON.stringify(username)}
	pass.value = ${JSON.stringify(password)}
	user.dispatchEvent(new Event('input', { bubbles: true }))
	pass.dispatchEvent(new Event('input', { bubbles: true }))
	if (${JSON.stringify(mode === 'authenticated')}) {
		const remember = document.querySelector('input[name="remember_login"]')
		if (remember) {
			remember.checked = false
			remember.dispatchEvent(new Event('change', { bubbles: true }))
		}
	}
	document.querySelector('form').requestSubmit()
})()`)
await waitFor(`location.pathname !== '/login'`, 30_000)
await waitFor(`document.readyState === 'complete'`)
await waitForBackground()
const onDashboard = await evaluate(`location.pathname.includes('/apps/dashboard')`)
if (!onDashboard) {
	await navigate(`${nextcloudBase}/index.php/apps/dashboard/`)
	await waitForBackground()
}
if (captureAuthenticatedPages) {
	await dismissOnboarding()
}
const dashboard = await snapshot()
if (captureAuthenticatedPages) {
	await screenshot('dashboard-offline')
}

const selectionsBeforeRepeatedMenu = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
try {
	await waitFor(`document.querySelector('.app-menu .app-menu__current-app')`)
} catch (error) {
	const menuState = await evaluate(`({
		dashboardRoute: location.pathname.includes('/apps/dashboard'),
		loginForm: Boolean(document.querySelector('input[name="user"]')),
		header: Boolean(document.getElementById('header')),
		appMenuPlaceholder: Boolean(document.getElementById('header-start__appmenu')),
		appMenuRoot: Boolean(document.querySelector('.app-menu')),
		currentAppTrigger: Boolean(document.querySelector('.app-menu__current-app')),
	})`)
	throw new Error(`Nextcloud app menu unavailable: ${JSON.stringify({
		...menuState,
		exceptionCount: exceptions.length,
	})}`)
}
const appMenuOpened = await evaluate(`(() => {
	const trigger = document.querySelector('.app-menu .app-menu__current-app')
	if (!trigger) return false
	trigger.click()
	return true
})()`)
assert(appMenuOpened, 'Current Nextcloud app menu trigger must be clickable')
await waitFor(`document.querySelector('a.app-item[aria-current="page"]')`)
const repeatedMenuClicked = await evaluate(`(() => {
	const canonicalPath = path => path.replace(/\\/+$/, '') || '/'
	const anchors = [...document.querySelectorAll(
		'a.app-item[aria-current="page"][href], #appmenu a.active[href]',
	)]
	const current = anchors.find(anchor => {
		try {
			const target = new URL(anchor.href)
			return target.origin === location.origin
				&& canonicalPath(target.pathname) === canonicalPath(location.pathname)
				&& target.search === location.search
		} catch {
			return false
		}
	})
	if (!current) return false
	current.click()
	return true
})()`)
assert(repeatedMenuClicked, 'Current Nextcloud app menu entry must be clickable')
const repeatedMenuId = await changesFrom(dashboard.id, 10_000)
assert(repeatedMenuId !== '', 'Repeated click on the current app menu entry did not change the background')
await waitForBackground()
const dashboardRepeated = await snapshot()
const selectionsAfterRepeatedMenu = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
assert(selectionsAfterRepeatedMenu === selectionsBeforeRepeatedMenu + 1,
	'Repeated current app menu click must request exactly one new selection')

await navigate(`${nextcloudBase}/index.php/apps/files/files`)
await waitForBackground()
if (captureAuthenticatedPages) {
	await dismissOnboarding()
}
const files = await snapshot()
if (captureAuthenticatedPages) {
	await screenshot('files-offline')
}

const selectionsBeforeSpa = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
const filesUrl = files.url
const spaClicked = await evaluate(`(() => {
	const entries = [...document.querySelectorAll(
		'.files-list__row-name-link, [data-cy-files-list-row-name-link]',
	)]
	const folder = entries.find(entry =>
		entry.closest('[data-mime="httpd/unix-directory"]')
		|| entry.closest('[data-type="dir"]')
	)
	const target = folder || entries[0]
	if (!target) return false
	target.click()
	return true
})()`)
assert(spaClicked, 'Files page must expose an in-app navigation target')
await waitFor(`location.href !== ${JSON.stringify(filesUrl)}`)
const spaId = await changesFrom(files.id, 10_000)
assert(spaId !== '', 'Real Files SPA navigation did not change the background')
await waitForBackground()
await sleep(750)
const spa = await snapshot()
if (captureAuthenticatedPages) {
	await screenshot('files-spa-offline')
}
const selectionsAfterSpa = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length

assert(login.id !== dashboard.id, 'Login and dashboard must use different images')
assert(dashboard.id !== dashboardRepeated.id, 'Repeated Dashboard menu click must use a different image')
assert(dashboard.id !== files.id, 'Dashboard and Files must use different images')
assert(files.creditText.length > 0, 'Files page must show attribution')
assert(files.id !== spa.id, 'Files SPA navigation must use a different image')
assert(spa.creditText.length > 0, 'Files SPA page must show attribution')
assert(selectionsAfterSpa === selectionsBeforeSpa + 1, 'Files SPA navigation must request exactly one new selection')

const providerHosts = requests
	.filter(url => url.startsWith('http://') || url.startsWith('https://'))
	.map(url => new URL(url).hostname)
	.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)

const selectionRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/background'))
const imageRequests = requests.filter(url => url.includes('/apps/backgroundchanger/api/image/'))
assert(selectionRequests.length >= 5, `Tested pages must request at least five local selections, got ${selectionRequests.length}`)
assert(imageRequests.length >= new Set([login.id, dashboard.id, dashboardRepeated.id, files.id, spa.id]).size,
	`Every selected image must be requested locally at least once, got ${imageRequests.length}`)
assert(imageRequests.length <= selectionRequests.length,
	`Local image requests must not exceed selections, got ${imageRequests.length}`)

if (mode === 'authenticated') {
	const logoutUrl = await evaluate(`(() => {
		if (typeof window.OC?.generateUrl !== 'function' || typeof window.OC?.requestToken !== 'string') {
			return ''
		}
		const url = new URL(window.OC.generateUrl('/logout'), location.origin)
		url.searchParams.set('requesttoken', window.OC.requestToken)
		return url.href
	})()`)
	const parsedLogoutUrl = new URL(logoutUrl)
	assert(parsedLogoutUrl.origin === new URL(nextcloudBase).origin
		&& parsedLogoutUrl.pathname.endsWith('/logout'), 'Nextcloud logout URL must stay on the tested origin')
	await navigate(logoutUrl)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	console.log(JSON.stringify({
		authenticatedLifecycle: {
			loginId: login.id,
			dashboardId: dashboard.id,
			dashboardRepeatedId: dashboardRepeated.id,
			filesId: files.id,
			spaId: spa.id,
		},
		selectionRequests: selectionRequests.length,
		imageRequests: imageRequests.length,
		providerRequests: providerHosts.length,
		exceptionCount: exceptions.length,
		loggedOut: true,
	}, null, 2))
} else {
	console.log(JSON.stringify({
		login,
		dashboard,
		dashboardRepeated,
		files,
		spa,
		selectionRequests: selectionRequests.length,
		imageRequests: imageRequests.length,
		providerRequests: providerHosts.length,
		exceptions,
	}, null, 2))
}

socket.close()

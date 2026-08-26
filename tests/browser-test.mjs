/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [, , debuggerBase, nextcloudBase, usernameArgument, passwordArgument, outputDirectory, mode = 'normal', expectedTheme = ''] = process.argv
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
const responses = []
const themeRequests = []
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
		if (message.params.request.url.includes('/apps/backgroundchanger/api/theme')) {
			const headerNames = Object.keys(message.params.request.headers).map(name => name.toLowerCase())
			let payload = null
			try {
				const parsed = JSON.parse(message.params.request.postData || '')
				payload = {
					theme: parsed.theme,
				}
			} catch (error) {
				payload = null
			}
			themeRequests.push({
				requestId: message.params.requestId,
				method: message.params.request.method,
				hasRequestToken: headerNames.includes('requesttoken'),
				payload,
			})
		}
	}
	if (message.method === 'Network.responseReceived') {
		const headerNames = Object.keys(message.params.response.headers).map(name => name.toLowerCase())
		responses.push({
			requestId: message.params.requestId,
			url: message.params.response.url,
			status: message.params.response.status,
			authNotConfirmed: headerNames.includes('x-nc-auth-notconfirmed'),
		})
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
		try {
			if (await evaluate(`Boolean(${expression})`)) {
				return
			}
		} catch (error) {
			if (!/context|Inspected target navigated or closed/i.test(error.message)) {
				throw error
			}
		}
		await sleep(200)
	}
	throw new Error(`Timed out waiting for: ${expression}`)
}

async function changesFrom(id, timeout = 4_000) {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		try {
			const current = await evaluate(`sessionStorage.getItem('backgroundchanger-last-' + document.documentElement.dataset.backgroundchangerTheme) || ''`)
			if (current && current !== id) {
				return current
			}
		} catch (error) {
			if (!/context|navigated|Uncaught/i.test(error.message)) {
				throw error
			}
		}
		await sleep(100)
	}
	return ''
}

async function realClick(target) {
	await command('Input.dispatchMouseEvent', {
		type: 'mouseMoved',
		x: target.x,
		y: target.y,
	})
	await command('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: target.x,
		y: target.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	})
	await sleep(50)
	await command('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: target.x,
		y: target.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	})
}

async function currentFilesRouteTarget() {
	return evaluate(`(async () => {
		const canonicalPath = path => path.replace(/\\/+$/, '') || '/'
		const anchors = [...document.querySelectorAll(
			'#app-navigation a[href], .app-navigation a[href], [data-cy-files-navigation] a[href]',
		)]
		for (const anchor of anchors) {
			let destination
			try {
				destination = new URL(anchor.href, location.href)
			} catch {
				continue
			}
			if (destination.origin !== location.origin
				|| canonicalPath(destination.pathname) !== canonicalPath(location.pathname)
				|| destination.search !== location.search) continue
			anchor.scrollIntoView({ block: 'center', inline: 'nearest' })
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
			const bounds = anchor.getBoundingClientRect()
			if (bounds.width <= 0 || bounds.height <= 0
				|| bounds.left < 0 || bounds.top < 0
				|| bounds.right > innerWidth || bounds.bottom > innerHeight) continue
			const x = bounds.left + bounds.width / 2
			const y = bounds.top + bounds.height / 2
			const hit = document.elementFromPoint(x, y)
			if (!(hit === anchor || anchor.contains(hit))) continue
			return { x, y, pathname: destination.pathname, search: destination.search }
		}
		return null
	})()`)
}

async function filesFolderTarget() {
	return evaluate(`(async () => {
		const entries = [...document.querySelectorAll(
			'.files-list__row-name-link, [data-cy-files-list-row-name-link]',
		)]
		const target = entries.find(entry => entry.closest('[data-mime="httpd/unix-directory"]')
			|| entry.closest('[data-type="dir"]')) || entries[0]
		if (!target) return null
		target.scrollIntoView({ block: 'center', inline: 'nearest' })
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const bounds = target.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === target || target.contains(hit))) return null
		return { x, y }
	})()`)
}

async function appMenuRouteTarget(pathFragment) {
	const trigger = await evaluate(`(async () => {
		const target = document.querySelector('.app-menu .app-menu__current-app')
		if (!target) return null
		const bounds = target.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === target || target.contains(hit))) return null
		return { x, y }
	})()`)
	if (!trigger) {
		return null
	}
	await realClick(trigger)
	await waitFor(`[...document.querySelectorAll('a.app-item[href], #appmenu a[href]')]
		.some(anchor => new URL(anchor.href, location.href).pathname.includes(${JSON.stringify(pathFragment)}))`)
	return evaluate(`(async () => {
		const target = [...document.querySelectorAll('a.app-item[href], #appmenu a[href]')]
			.find(anchor => new URL(anchor.href, location.href).pathname.includes(${JSON.stringify(pathFragment)}))
		if (!target) return null
		const bounds = target.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === target || target.contains(hit))) return null
		return { x, y }
	})()`)
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
		const target = await evaluate(`(() => {
			const dialog = document.querySelector('[role="dialog"]')
			const close = dialog && [...dialog.querySelectorAll('button')].find(button => {
				const label = (button.getAttribute('aria-label') || '').trim()
				const text = (button.textContent || '').trim()
				if (!(['Schließen', 'Close', 'Überspringen', 'Skip'].includes(label)
					|| ['Überspringen', 'Skip'].includes(text))) return false
				const bounds = button.getBoundingClientRect()
				if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < 0 || bounds.top < 0
					|| bounds.right > innerWidth || bounds.bottom > innerHeight) return false
				const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
				return hit === button || button.contains(hit)
			})
			if (!close) return null
			const bounds = close.getBoundingClientRect()
			if (bounds.width <= 0 || bounds.height <= 0) return null
			return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
		})()`)
		if (target) {
			await command('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: target.x,
				y: target.y,
			})
			await command('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				x: target.x,
				y: target.y,
				button: 'left',
				buttons: 1,
				clickCount: 1,
			})
			await sleep(50)
			await command('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				x: target.x,
				y: target.y,
				button: 'left',
				buttons: 0,
				clickCount: 1,
			})
			await sleep(500)
			if (await evaluate(`!document.querySelector('[role="dialog"]')`)) {
				return true
			}
		}
		await sleep(250)
	}
	return false
}

async function themeControl(value = '') {
	return evaluate(`(async () => {
		const section = [...document.querySelectorAll('.declarative-settings-section')]
			.find(candidate => candidate.textContent?.includes('Background Changer'))
		if (!section) return null
		section.scrollIntoView({ block: 'center', inline: 'nearest' })
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		if (${JSON.stringify(value)} === '') {
			const bounds = section.getBoundingClientRect()
			return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight }
		}
		const input = [...section.querySelectorAll('input[type="radio"]')]
			.find(candidate => candidate.value === ${JSON.stringify(value)})
		if (!input) return null
		const content = input.closest('.checkbox-radio-switch')?.querySelector('.checkbox-radio-switch__content')
		if (!content) return null
		const bounds = content.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === content || content.contains(hit))) return null
		return { x, y, carrier: 'checkbox-radio-switch__content' }
	})()`)
}

async function personalBackgroundControl() {
	return evaluate(`(async () => {
		const section = document.querySelector('.settings-section.background')
		if (!section) return null
		const button = [...section.querySelectorAll('button[aria-label]')]
			.find(candidate => candidate.getAttribute('aria-pressed') !== 'true'
				&& getComputedStyle(candidate).backgroundImage.includes('/apps/theming/img/background/preview/'))
		if (!button) return null
		button.scrollIntoView({ block: 'center', inline: 'nearest' })
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const bounds = button.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === button || button.contains(hit))) return null
		return { x, y, ariaLabel: button.getAttribute('aria-label') || '' }
	})()`)
}

async function submitLogin() {
	await evaluate(`(() => {
		const user = document.querySelector('input[name="user"]')
		const pass = document.querySelector('input[name="password"]')
		if (!user || !pass) return false
		user.value = ${JSON.stringify(username)}
		pass.value = ${JSON.stringify(password)}
		user.dispatchEvent(new Event('input', { bubbles: true }))
		pass.dispatchEvent(new Event('input', { bubbles: true }))
		const remember = document.querySelector('input[name="remember_login"]')
		if (remember) {
			remember.checked = false
			remember.dispatchEvent(new Event('change', { bubbles: true }))
		}
		document.querySelector('form')?.requestSubmit()
		return true
	})()`)
	await waitFor(`location.pathname !== '/login'`, 30_000)
	await waitFor(`document.readyState === 'complete'`)
}

async function logout() {
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

if (mode === 'navigation') {
	await navigate(`${nextcloudBase}/login`)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	await waitForBackground()
	await submitLogin()
	await navigate(`${nextcloudBase}/index.php/apps/files/files`)
	await waitForBackground()
	await dismissOnboarding()

	const before = await snapshot()
	const selectionsBefore = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
	const activeTarget = await currentFilesRouteTarget()
	assert(activeTarget, 'Files must expose a visible current-route navigation link')
	await realClick(activeTarget)
	const afterId = await changesFrom(before.id, 5_000)
	const selectionsAfter = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length

	console.log(JSON.stringify({
		currentRouteClick: {
			pathname: activeTarget.pathname,
			search: activeTarget.search,
			beforeId: before.id,
			afterId,
			selectionDelta: selectionsAfter - selectionsBefore,
		},
		exceptions,
	}, null, 2))
	assert(afterId !== '', 'A real click on the current Files route must change the background')
	assert(selectionsAfter === selectionsBefore + 1,
		'A real click on the current Files route must request exactly one new selection')
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)
	await logout()
	socket.close()
	process.exit(0)
}

if (mode === 'navigation-full') {
	const selectionCount = () => requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
	const imageCount = () => requests.filter(url => url.includes('/apps/backgroundchanger/api/image/')).length
	const captureState = async name => {
		await waitForBackground()
		const state = await snapshot()
		assert(state.readyId === state.id, `${name} must paint only its decoded selection`)
		assert(state.creditText.includes('designed by chrissi0285'), `${name} must show the exact design line`)
		state.screenshotHash = await screenshot(name)
		return state
	}

	await navigate(`${nextcloudBase}/login`)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	await waitForBackground()
	await submitLogin()
	if (!await evaluate(`location.pathname.includes('/apps/dashboard')`)) {
		await navigate(`${nextcloudBase}/index.php/apps/dashboard/`)
	}
	await dismissOnboarding()
	const states = []
	states.push({ name: 'dashboard', ...await captureState('navigation-dashboard') })

	let beforeSelections = selectionCount()
	let beforeId = states.at(-1).id
	const filesMenuTarget = await appMenuRouteTarget('/apps/files')
	assert(filesMenuTarget, 'The real app menu must expose Files as a visible mouse target')
	await realClick(filesMenuTarget)
	await waitFor(`location.pathname.includes('/apps/files/files')`)
	assert(await changesFrom(beforeId, 10_000) !== '', 'Dashboard-to-Files app-menu navigation must change the background')
	states.push({ name: 'files', ...await captureState('navigation-files') })
	assert(selectionCount() === beforeSelections + 1,
		'Dashboard-to-Files app-menu navigation must request exactly one selection')

	beforeSelections = selectionCount()
	beforeId = states.at(-1).id
	const activeFilesTarget = await currentFilesRouteTarget()
	assert(activeFilesTarget, 'Files must expose its visible current-route navigation link')
	await realClick(activeFilesTarget)
	assert(await changesFrom(beforeId, 5_000) !== '', 'Repeated real Files route click must change the background')
	states.push({ name: 'files-current', ...await captureState('navigation-files-current') })
	assert(selectionCount() === beforeSelections + 1,
		'Repeated real Files route click must request exactly one selection')

	const filesUrl = states.at(-1).url
	beforeSelections = selectionCount()
	beforeId = states.at(-1).id
	const folderTarget = await filesFolderTarget()
	assert(folderTarget, 'Files must expose a visible in-app folder route')
	await realClick(folderTarget)
	await waitFor(`location.href !== ${JSON.stringify(filesUrl)}`)
	assert(await changesFrom(beforeId, 10_000) !== '', 'Real Files router navigation must change the background')
	states.push({ name: 'files-folder', ...await captureState('navigation-files-folder') })
	assert(selectionCount() === beforeSelections + 1,
		'Real Files router navigation must request exactly one selection')
	const folderUrl = states.at(-1).url

	let historyState = await command('Page.getNavigationHistory')
	const backEntry = historyState.entries
		.slice(0, historyState.currentIndex)
		.reverse()
		.find(entry => entry.url === filesUrl)
	assert(backEntry, 'Browser history must retain the Files root route')
	beforeSelections = selectionCount()
	beforeId = states.at(-1).id
	await command('Page.navigateToHistoryEntry', { entryId: backEntry.id })
	assert(await changesFrom(beforeId, 10_000) !== '', 'Browser Back must change the background')
	states.push({ name: 'history-back', ...await captureState('navigation-history-back') })
	assert(states.at(-1).url !== folderUrl && states.at(-1).url.includes('/apps/files/files'),
		'Browser Back must visibly return to a different Files route')
	assert(selectionCount() === beforeSelections + 1, 'Browser Back must request exactly one selection')

	historyState = await command('Page.getNavigationHistory')
	const forwardEntry = historyState.entries
		.slice(historyState.currentIndex + 1)
		.find(entry => entry.url === folderUrl)
	assert(forwardEntry, 'Browser history must retain the Files folder route')
	beforeSelections = selectionCount()
	beforeId = states.at(-1).id
	await command('Page.navigateToHistoryEntry', { entryId: forwardEntry.id })
	assert(await changesFrom(beforeId, 10_000) !== '', 'Browser Forward must change the background')
	states.push({ name: 'history-forward', ...await captureState('navigation-history-forward') })
	assert(states.at(-1).url !== states.at(-2).url && states.at(-1).url.includes('/apps/files/files'),
		'Browser Forward must visibly restore the later Files route')
	assert(selectionCount() === beforeSelections + 1, 'Browser Forward must request exactly one selection')

	beforeSelections = selectionCount()
	beforeId = states.at(-1).id
	const dashboardMenuTarget = await appMenuRouteTarget('/apps/dashboard')
	assert(dashboardMenuTarget, 'The real app menu must expose Dashboard as a visible mouse target')
	await realClick(dashboardMenuTarget)
	await waitFor(`location.pathname.includes('/apps/dashboard')`)
	assert(await changesFrom(beforeId, 10_000) !== '', 'Files-to-Dashboard app-menu navigation must change the background')
	states.push({ name: 'dashboard-return', ...await captureState('navigation-dashboard-return') })
	assert(selectionCount() === beforeSelections + 1,
		'Files-to-Dashboard app-menu navigation must request exactly one selection')

	for (let index = 1; index < states.length; index++) {
		assert(states[index].id !== states[index - 1].id,
			`${states[index].name} must not repeat the immediately preceding background`)
	}

	await navigate(`${nextcloudBase}/index.php/settings/user/theming`)
	await waitFor(`document.querySelector('.settings-section.background')`, 30_000)
	await dismissOnboarding()
	const personalResponsesBefore = responses.filter(response => response.url.includes('/apps/theming/background/shipped')).length
	const personalTarget = await personalBackgroundControl()
	assert(personalTarget?.ariaLabel, 'A visible Nextcloud personal background must be selectable')
	await realClick(personalTarget)
	const personalDeadline = Date.now() + 10_000
	while (responses.filter(response => response.url.includes('/apps/theming/background/shipped')).length <= personalResponsesBefore
		&& Date.now() < personalDeadline) {
		await sleep(100)
	}
	const personalResponses = responses
		.filter(response => response.url.includes('/apps/theming/background/shipped'))
		.slice(personalResponsesBefore)
	assert(personalResponses.length === 1 && personalResponses[0].status === 200,
		'The real Nextcloud personal background write must receive HTTP 200')

	const selectionsBeforePersonal = selectionCount()
	const imagesBeforePersonal = imageCount()
	await navigate(`${nextcloudBase}/index.php/apps/dashboard/`)
	await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
	const personal = await snapshot()
	personal.screenshotHash = await screenshot('navigation-personal-background')
	assert(personal.metaCount === 0, 'A personal Nextcloud background must suppress the endpoint')
	assert(personal.creditText === '', 'A personal Nextcloud background must suppress app attribution')
	assert(!personal.background.includes('/apps/backgroundchanger/'),
		'A personal Nextcloud background must suppress Background Changer CSS')
	assert(selectionCount() === selectionsBeforePersonal,
		'A personal Nextcloud background must suppress Background Changer selections')
	assert(imageCount() === imagesBeforePersonal,
		'A personal Nextcloud background must suppress Background Changer images')
	const personalResult = {
		backgroundLabel: personalTarget.ariaLabel,
		metaCount: personal.metaCount,
		creditText: personal.creditText,
		selectionDelta: selectionCount() - selectionsBeforePersonal,
		imageDelta: imageCount() - imagesBeforePersonal,
		screenshotHash: personal.screenshotHash,
	}

	const providerHosts = requests
		.filter(url => url.startsWith('http://') || url.startsWith('https://'))
		.map(url => new URL(url).hostname)
		.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
	assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)
	await logout()
	console.log(JSON.stringify({
		navigationStates: states,
		personal: personalResult,
		providerRequests: 0,
		exceptions,
	}, null, 2))
	socket.close()
	process.exit(0)
}

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

if (mode === 'settings' || mode === 'settings-inspect') {
	await navigate(`${nextcloudBase}/login`)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	await waitForBackground()
	await submitLogin()
	await navigate(`${nextcloudBase}/index.php/settings/user/theming`)
	await waitFor(`document.body?.innerText.includes('Background Changer')`, 30_000)
	await dismissOnboarding()
	await waitFor(`!document.querySelector('[role="dialog"]')`)

	const expectedValues = ['default', 'off', 'landscapes', 'animals', 'space', 'architecture']
	const expectedLabels = ['Default', 'Off', 'Landscapes', 'Animals', 'Space', 'Architecture']
	const settings = await evaluate(`(() => {
		const expected = ${JSON.stringify(['default', 'off', 'landscapes', 'animals', 'space', 'architecture'])}
		const expectedLabels = ${JSON.stringify(['Default', 'Off', 'Landscapes', 'Animals', 'Space', 'Architecture'])}
		const radios = [...document.querySelectorAll('input[type="radio"]')]
			.filter(input => expected.includes(input.value))
		const visibleText = document.body.innerText
		return {
			titleVisible: visibleText.includes('Background Changer'),
			descriptionVisible: visibleText.includes('Choose rotating backgrounds served locally by this Nextcloud.'),
			values: radios.map(input => input.value),
			visibleLabels: expectedLabels.filter(label => visibleText.includes(label)),
		}
	})()`)
	assert(settings.titleVisible, 'Background Changer settings title must be visible')
	assert(settings.descriptionVisible, 'Background Changer settings description must be visible')
	assert(expectedValues.every(value => settings.values.includes(value)), 'All six theme choices must be rendered as radio controls')
	assert(expectedLabels.every(label => settings.visibleLabels.includes(label)), 'Every theme choice must have a visible label')
	if (mode === 'settings-inspect') {
		const controls = await evaluate(`(() => {
			const expected = ${JSON.stringify(['default', 'off', 'landscapes', 'animals', 'space', 'architecture'])}
			return [...document.querySelectorAll('input[type="radio"]')]
				.filter(input => expected.includes(input.value))
				.map(input => ({
					value: input.value,
					name: input.name,
					id: input.id,
					ancestors: [...function* () {
						let node = input.parentElement
						for (let level = 0; node && level < 6; level++, node = node.parentElement) {
							yield {
								tag: node.tagName.toLowerCase(),
								id: node.id,
								classes: [...node.classList],
								text: (node.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
							}
						}
					}()],
				}))
		})()`)
		await logout()
		console.log(JSON.stringify({ settings, controls }, null, 2))
		socket.close()
		process.exit(0)
	}

	const persistedStates = []
	for (const value of expectedValues) {
		const writesBefore = requests.filter(url => url.includes('/apps/backgroundchanger/api/theme')).length
		const responsesBefore = responses.filter(response => response.url.includes('/apps/backgroundchanger/api/theme')).length
		const target = await themeControl(value)
		assert(target, `${value} must be visible and selectable through the real settings UI`)
		await command('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x: target.x,
			y: target.y,
			button: 'left',
			buttons: 1,
			clickCount: 1,
		})
		await sleep(50)
		await command('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x: target.x,
			y: target.y,
			button: 'left',
			buttons: 0,
			clickCount: 1,
		})
		const writeDeadline = Date.now() + 10_000
		while (requests.filter(url => url.includes('/apps/backgroundchanger/api/theme')).length <= writesBefore
			&& Date.now() < writeDeadline) {
			await sleep(100)
		}
		assert(requests.filter(url => url.includes('/apps/backgroundchanger/api/theme')).length === writesBefore + 1,
			`${value} must issue exactly one app-owned settings write`)
		const responseDeadline = Date.now() + 10_000
		while (responses.filter(response => response.url.includes('/apps/backgroundchanger/api/theme')).length <= responsesBefore
			&& Date.now() < responseDeadline) {
			await sleep(100)
		}
		const valueResponses = responses.filter(response => response.url.includes('/apps/backgroundchanger/api/theme')).slice(responsesBefore)
		if (valueResponses.length !== 1 || valueResponses[0].status !== 200) {
			let publicMessage = ''
			if (valueResponses.length === 1) {
				await sleep(200)
				try {
					const responseBody = await command('Network.getResponseBody', { requestId: valueResponses[0].requestId })
					const parsed = JSON.parse(responseBody.body)
					const candidate = parsed?.ocs?.meta?.message ?? parsed?.message ?? ''
					publicMessage = typeof candidate === 'string' ? candidate.slice(0, 160) : ''
				} catch (error) {
					publicMessage = ''
				}
			}
			throw new Error(`${value} must receive one successful app-owned settings response: ${JSON.stringify({
				responses: valueResponses.map(response => ({
					status: response.status,
					authNotConfirmed: response.authNotConfirmed,
				})),
				request: themeRequests[writesBefore] ?? null,
				publicMessage,
			})}`)
		}
		assert(themeRequests[writesBefore]?.method === 'POST'
			&& themeRequests[writesBefore]?.hasRequestToken === true
			&& themeRequests[writesBefore]?.payload?.theme === value,
			`${value} must use the CSRF-protected app-owned theme contract`)
		await waitFor(`document.readyState === 'complete'`)
		await waitFor(`document.body?.innerText.includes('Background Changer')`, 30_000)
		await waitFor(`[...document.querySelectorAll('input[type="radio"]')].some(input => input.value === ${JSON.stringify(value)} && input.checked)`, 10_000)
		if (value === 'off') {
			await sleep(500)
		} else {
			await waitForBackground()
		}
		assert(await evaluate(`!document.querySelector('[role="dialog"]')`), 'No onboarding dialog may cover a theme screenshot')
		const visibleControl = await themeControl(value)
		assert(visibleControl?.carrier === 'checkbox-radio-switch__content',
			'The selected Background Changer radio must be visible through its real NC34 click carrier')
		assert(await evaluate(`(() => {
			const input = [...document.querySelectorAll('.declarative-settings-section input[type="radio"]')]
				.find(candidate => candidate.value === ${JSON.stringify(value)})
			if (!input?.checked) return false
			const section = input.closest('.declarative-settings-section')
			const bounds = section?.getBoundingClientRect()
			return Boolean(bounds && bounds.top >= 0 && bounds.bottom <= innerHeight)
		})()`), 'The complete Background Changer section and selected radio must be inside the screenshot viewport')
		const state = await snapshot()
		const effectiveTheme = value === 'default' ? 'landscapes' : value
		if (value === 'off') {
			assert(state.metaCount === 0 && state.creditText === '', 'Off must remain disabled after reload')
			assert(!state.bodyBackground.includes('/apps/backgroundchanger/'), 'Off must not paint an app background after reload')
		} else {
			assert(state.theme === effectiveTheme, `${value} must persist as ${effectiveTheme} after reload`)
			assert(state.readyId === state.id, `${value} must paint only a decoded background after reload`)
			assert(state.creditText.includes('designed by chrissi0285'), `${value} must retain attribution after reload`)
		}
		state.preference = value
		state.screenshotHash = await screenshot(`theme-settings-${value}`)
		persistedStates.push(state)
	}

	await navigate(`${nextcloudBase}/index.php/apps/files/files`)
	await waitForBackground()
	const filesBeforeRouter = await snapshot()
	const selectionsBeforeRouter = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
	const filesUrl = filesBeforeRouter.url
	const routerTarget = await evaluate(`(async () => {
		const entries = [...document.querySelectorAll(
			'.files-list__row-name-link, [data-cy-files-list-row-name-link]',
		)]
		const target = entries.find(entry => entry.closest('[data-mime="httpd/unix-directory"]')
			|| entry.closest('[data-type="dir"]')) || entries[0]
		if (!target) return null
		target.scrollIntoView({ block: 'center', inline: 'nearest' })
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const bounds = target.getBoundingClientRect()
		if (bounds.width <= 0 || bounds.height <= 0) return null
		const x = bounds.left + bounds.width / 2
		const y = bounds.top + bounds.height / 2
		const hit = document.elementFromPoint(x, y)
		if (!(hit === target || target.contains(hit))) return null
		return { x, y }
	})()`)
	assert(routerTarget, 'Files must expose a visible and hit-testable in-app router target')
	await command('Input.dispatchMouseEvent', {
		type: 'mouseMoved',
		x: routerTarget.x,
		y: routerTarget.y,
	})
	await command('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: routerTarget.x,
		y: routerTarget.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	})
	await sleep(50)
	await command('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: routerTarget.x,
		y: routerTarget.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	})
	await waitFor(`location.href !== ${JSON.stringify(filesUrl)}`)
	const routerId = await changesFrom(filesBeforeRouter.id, 10_000)
	assert(routerId !== '', 'The real Files router transition must change the background')
	await waitForBackground()
	const filesAfterRouter = await snapshot()
	await screenshot('theme-router-files')
	const selectionsAfterRouter = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
	assert(selectionsAfterRouter === selectionsBeforeRouter + 1,
		'The real Files router transition must request exactly one new local selection')
	assert(filesAfterRouter.id !== filesBeforeRouter.id,
		'The real Files router transition must paint a different local image')

	await navigate(`${nextcloudBase}/index.php/settings/user/theming`)
	await waitFor(`document.querySelector('.settings-section.background')`, 30_000)
	await dismissOnboarding()
	await waitFor(`!document.querySelector('[role="dialog"]')`)
	const personalWritesBefore = requests.filter(url => url.includes('/apps/theming/background/shipped')).length
	const personalResponsesBefore = responses.filter(response => response.url.includes('/apps/theming/background/shipped')).length
	const personalTarget = await personalBackgroundControl()
	assert(personalTarget?.ariaLabel, 'A visible shipped Nextcloud personal background must be selectable')
	await command('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: personalTarget.x,
		y: personalTarget.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	})
	await sleep(50)
	await command('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: personalTarget.x,
		y: personalTarget.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	})
	const personalDeadline = Date.now() + 10_000
	while (responses.filter(response => response.url.includes('/apps/theming/background/shipped')).length <= personalResponsesBefore
		&& Date.now() < personalDeadline) {
		await sleep(100)
	}
	const personalResponses = responses
		.filter(response => response.url.includes('/apps/theming/background/shipped'))
		.slice(personalResponsesBefore)
	assert(requests.filter(url => url.includes('/apps/theming/background/shipped')).length === personalWritesBefore + 1,
		'A real personal background click must issue exactly one Nextcloud theming write')
	assert(personalResponses.length === 1 && personalResponses[0].status === 200,
		'The Nextcloud personal background write must receive HTTP 200')
	await waitFor(`[...document.querySelectorAll('.settings-section.background button[aria-pressed="true"]')]
		.some(button => button.getAttribute('aria-label') === ${JSON.stringify(personalTarget.ariaLabel)})`)
	await screenshot('nextcloud-personal-background-setting')

	const selectionsBeforePersonalPage = requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length
	const imagesBeforePersonalPage = requests.filter(url => url.includes('/apps/backgroundchanger/api/image/')).length
	await navigate(`${nextcloudBase}/index.php/apps/dashboard/`)
	await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
	const personal = await snapshot()
	await screenshot('nextcloud-personal-background')
	assert(personal.metaCount === 0, 'A personal Nextcloud background must suppress the Background Changer endpoint')
	assert(personal.creditText === '', 'A personal Nextcloud background must suppress Background Changer attribution')
	assert(!personal.background.includes('/apps/backgroundchanger/'),
		'A personal Nextcloud background must suppress Background Changer CSS')
	assert(requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length === selectionsBeforePersonalPage,
		'A personal Nextcloud background must suppress local Background Changer selections')
	assert(requests.filter(url => url.includes('/apps/backgroundchanger/api/image/')).length === imagesBeforePersonalPage,
		'A personal Nextcloud background must suppress local Background Changer images')

	const appThemeWrites = requests.filter(url => url.includes('/apps/backgroundchanger/api/theme'))
	const appThemeResponses = responses.filter(response => response.url.includes('/apps/backgroundchanger/api/theme'))
	const coreDeclarativeWrites = requests.filter(url => url.includes('/settings/api/declarative/value'))
	const providerHosts = requests
		.filter(url => url.startsWith('http://') || url.startsWith('https://'))
		.map(url => new URL(url).hostname)
		.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
	assert(appThemeWrites.length === expectedValues.length,
		`Expected ${expectedValues.length} app-owned settings writes, got ${appThemeWrites.length}`)
	assert(appThemeResponses.length === expectedValues.length
		&& appThemeResponses.every(response => response.status === 200),
		'Every app-owned settings write must receive HTTP 200')
	assert(coreDeclarativeWrites.length === 0, 'The defective NC34 declarative write route must not be called')
	assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)
	await logout()
	console.log(JSON.stringify({
		settings,
		persistedStates,
		router: {
			beforeId: filesBeforeRouter.id,
			afterId: filesAfterRouter.id,
			selectionDelta: selectionsAfterRouter - selectionsBeforeRouter,
		},
		personal: {
			backgroundLabel: personalTarget.ariaLabel,
			metaCount: personal.metaCount,
			creditText: personal.creditText,
			selectionDelta: requests.filter(url => url.includes('/apps/backgroundchanger/api/background')).length - selectionsBeforePersonalPage,
			imageDelta: requests.filter(url => url.includes('/apps/backgroundchanger/api/image/')).length - imagesBeforePersonalPage,
		},
		appThemeWrites: appThemeWrites.length,
		coreDeclarativeWrites: 0,
		providerRequests: 0,
		exceptions,
	}, null, 2))
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

if (mode === 'theme' || mode === 'suppressed') {
	const selectableThemes = new Set(['landscapes', 'animals', 'space', 'architecture'])
	if (mode === 'theme' && !selectableThemes.has(expectedTheme)) {
		throw new Error('Theme mode requires landscapes, animals, space or architecture')
	}
	if (mode === 'suppressed' && !new Set(['off', 'personal']).has(expectedTheme)) {
		throw new Error('Suppressed mode requires off or personal')
	}

	await navigate(`${nextcloudBase}/login`)
	await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
	await waitForBackground()
	const anonymous = await snapshot()
	assert(anonymous.theme === 'landscapes', 'Anonymous login must use landscapes')
	await submitLogin()
	await navigate(`${nextcloudBase}/index.php/apps/dashboard/`)
	let resultState

	if (mode === 'theme') {
		await waitForBackground()
		const themed = await snapshot()
		themed.backgroundCropHash = await screenshot(`theme-${expectedTheme}-background`, {
			x: 0,
			y: 50,
			width: 500,
			height: 700,
		})
		await screenshot(`theme-${expectedTheme}`)
		assert(themed.theme === expectedTheme, `Expected ${expectedTheme}, got ${themed.theme}`)
		assert(themed.readyId === themed.id, 'Only a decoded themed background may be ready')
		assert(themed.creditText.includes('designed by chrissi0285'), 'The exact design line must be visible')
		assert(themed.creditHosts.includes('commons.wikimedia.org'), 'Commons source attribution must be linked')
		assert(themed.creditHosts.includes('creativecommons.org'), 'License attribution must be linked')
		resultState = { themed }
	} else {
		await sleep(2000)
		const suppressed = await snapshot()
		await screenshot(`theme-${expectedTheme}`)
		assert(suppressed.metaCount === 0, `${expectedTheme} must suppress the endpoint`)
		assert(suppressed.creditText === '', `${expectedTheme} must suppress attribution`)
		assert(!suppressed.bodyBackground.includes('/apps/backgroundchanger/'), `${expectedTheme} must suppress the app image`)
		resultState = { suppressed }
	}

	const providerHosts = requests
		.filter(url => url.startsWith('http://') || url.startsWith('https://'))
		.map(url => new URL(url).hostname)
		.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
	assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
	assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)
	await logout()
	console.log(JSON.stringify({
		mode,
		expectedTheme,
		anonymous,
		...resultState,
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

await submitLogin()
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
	await logout()
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

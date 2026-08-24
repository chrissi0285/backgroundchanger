/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdirSync, writeFileSync } from 'node:fs'

const [, , debuggerBase, nextcloudBase, username, password, outputDirectory, mode = 'normal'] = process.argv
if (!debuggerBase || !nextcloudBase || !username || !password || !outputDirectory) {
	throw new Error('Usage: browser-test.mjs DEBUGGER_URL NEXTCLOUD_URL USER PASSWORD OUTPUT_DIR')
}

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

async function navigate(url) {
	await command('Page.navigate', { url })
	await waitFor(`document.readyState === 'complete'`)
}

async function waitForBackground() {
	await waitFor(`
		document.getElementById('wechselbild-credit')
		&& sessionStorage.getItem('wechselbild-last')
		&& getComputedStyle(document.documentElement).getPropertyValue('--wechselbild-image').includes('/apps/wechselbild/api/image/')
	`)
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
		const credit = document.getElementById('wechselbild-credit')
		return {
			url: location.href,
			id: sessionStorage.getItem('wechselbild-last'),
			metaCount: document.querySelectorAll('meta[name="wechselbild-endpoint"]').length,
			creditText: credit?.textContent?.trim() || '',
			creditHosts: credit ? [...credit.querySelectorAll('a')].map(link => new URL(link.href).hostname) : [],
			background: getComputedStyle(document.documentElement).getPropertyValue('--wechselbild-image').trim(),
			bodyBackground: getComputedStyle(document.body).backgroundImage,
		}
	})()`)
}

async function screenshot(name) {
	const result = await command('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		captureBeyondViewport: false,
	})
	writeFileSync(`${outputDirectory}/${name}.png`, Buffer.from(result.data, 'base64'))
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

if (mode === 'personal') {
	await navigate(`${nextcloudBase}/index.php/apps/files/files`)
	await sleep(2000)
	const personal = await snapshot()
	await screenshot('files-personal-background')
	const selectionRequests = requests.filter(url => url.includes('/apps/wechselbild/api/background'))
	const imageRequests = requests.filter(url => url.includes('/apps/wechselbild/api/image/'))
	assert(personal.metaCount === 0, 'Personal background must suppress the Wechselbild endpoint')
	assert(personal.creditText === '', 'Personal background must suppress Wechselbild attribution')
	assert(!personal.background.includes('/apps/wechselbild/'), 'Personal background must not use Wechselbild CSS')
	assert(selectionRequests.length === 0, 'Personal background must not request a Wechselbild selection')
	assert(imageRequests.length === 0, 'Personal background must not request a Wechselbild image')
	console.log(JSON.stringify({ personal, selectionRequests: 0, imageRequests: 0 }, null, 2))
	socket.close()
	process.exit(0)
}

await navigate(`${nextcloudBase}/login`)
await waitFor(`document.querySelector('input[name="user"]') && document.querySelector('input[name="password"]')`)
await waitForBackground()
const login = await snapshot()
await screenshot('login-offline')

assert(login.metaCount === 1, 'Login page must contain exactly one endpoint meta tag')
assert(login.creditText.length > 0, 'Login page must show attribution')
assert(login.bodyBackground.includes('wechselbild'), 'Login page must use a local Wechselbild image')

await evaluate(`(() => {
	const user = document.querySelector('input[name="user"]')
	const pass = document.querySelector('input[name="password"]')
	user.value = ${JSON.stringify(username)}
	pass.value = ${JSON.stringify(password)}
	user.dispatchEvent(new Event('input', { bubbles: true }))
	pass.dispatchEvent(new Event('input', { bubbles: true }))
	document.querySelector('form').requestSubmit()
})()`)
await waitFor(`location.pathname !== '/login'`, 30_000)
await waitFor(`document.readyState === 'complete'`)
await waitForBackground()
await dismissOnboarding()
const dashboard = await snapshot()
await screenshot('dashboard-offline')

await navigate(`${nextcloudBase}/index.php/apps/files/files`)
await waitForBackground()
await dismissOnboarding()
const files = await snapshot()
await screenshot('files-offline')

assert(login.id !== dashboard.id, 'Login and dashboard must use different images')
assert(dashboard.id !== files.id, 'Dashboard and Files must use different images')
assert(files.creditText.length > 0, 'Files page must show attribution')

const providerHosts = requests
	.filter(url => url.startsWith('http://') || url.startsWith('https://'))
	.map(url => new URL(url).hostname)
	.filter(host => /(?:wikimedia|wikimedia\.org|creativecommons\.org|unsplash|wallhaven|bing)/i.test(host))
assert(providerHosts.length === 0, `Browser contacted a provider: ${providerHosts.join(', ')}`)
assert(exceptions.length === 0, `Browser exceptions: ${exceptions.join('; ')}`)

const selectionRequests = requests.filter(url => url.includes('/apps/wechselbild/api/background'))
const imageRequests = requests.filter(url => url.includes('/apps/wechselbild/api/image/'))
assert(selectionRequests.length === 3, `Each tested page must request exactly one local selection, got ${selectionRequests.length}`)
assert(imageRequests.length === 3, `Each tested page must request exactly one local image, got ${imageRequests.length}`)

console.log(JSON.stringify({
	login,
	dashboard,
	files,
	selectionRequests: selectionRequests.length,
	imageRequests: imageRequests.length,
	providerRequests: providerHosts.length,
	exceptions,
}, null, 2))

socket.close()

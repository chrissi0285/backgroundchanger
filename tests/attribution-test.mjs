#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Synthetic local browser regression, NOT a Nextcloud production test.
 * Node >=22 (built-in WebSocket), google-chrome; no npm dependencies.
 * Usage: node tests/attribution-test.mjs [--ref origin/main]
 * --ref reads both real assets using git show; never checks out or edits them.
 */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
assert(args.length === 0 || (args.length === 2 && args[0] === '--ref' && !args[1].startsWith('-')), 'Usage: node tests/attribution-test.mjs [--ref origin/main]')
assert.equal(typeof WebSocket, 'function', 'Node with built-in WebSocket required (>=22)')
const ref = args[1]
const assets = {}
for (const path of ['js/background.js', 'css/background.css']) {
	assets['/' + path] = ref
		? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
		: await readFile(join(root, path), 'utf8')
}
const ids = ['a'.repeat(32), 'b'.repeat(32)]
const sourceUrl = 'https://commons.wikimedia.org/wiki/File:Synthetic_fixture.svg'
const licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/'
let requests = 0
const server = createServer((req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname
	res.setHeader('Cache-Control', 'no-store')
	if (assets[path]) {
		res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
		res.end(assets[path])
	} else if (path === '/fixture-api') {
		const index = requests++ % 2
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ background: {
			id: ids[index], theme: 'landscapes', title: `Synthetic image ${index + 1}`,
			author: 'Synthetic author', license: 'CC BY-SA 4.0', sourceUrl, licenseUrl,
			description: 'Explicitly synthetic local fixture',
			image: `/apps/backgroundchanger/api/image/landscapes/${ids[index]}`,
		} }))
	} else if (path.startsWith('/apps/backgroundchanger/api/image/landscapes/')) {
		res.setHeader('Content-Type', 'image/svg+xml')
		res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123456"/></svg>')
	} else if (path === '/') {
		res.setHeader('Content-Type', 'text/html')
		res.end(`<!doctype html><html><head><meta charset="utf-8">
<meta name="backgroundchanger-endpoint" content="/fixture-api" data-theme="landscapes">
<style>/* Synthetic host styles, not Nextcloud's production stylesheet. */
* { box-sizing: border-box } body { margin: 0; min-height: 100vh }
button { min-width: 44px; min-height: 44px; padding: 12px; margin: 4px }
</style><link rel="stylesheet" href="/css/background.css">
<script defer src="/js/background.js"></script></head>
<body><main>Synthetic local attribution fixture — no production connection.</main></body></html>`)
	} else {
		res.writeHead(404).end()
	}
})
let chrome, profile, ws, sequence = 0, interrupted = false, chromeError
const pending = new Map()
const errors = []
const signal = () => { interrupted = true }
process.on('SIGINT', signal)
process.on('SIGTERM', signal)
async function until(predicate, label, timeout = 7000) {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		if (interrupted) throw new Error('Interrupted')
		if (chromeError) throw chromeError
		if (await predicate()) return
		await delay(40)
	}
	throw new Error(`Timed out: ${label}`)
}
function send(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = ++sequence
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 5000)
		pending.set(id, { resolve, reject, timer })
		ws.send(JSON.stringify({ id, method, params }))
	})
}
async function evaluate(expression) {
	const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
	if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
	return result.result.value
}
async function check(expression, label) {
	assert.equal(await evaluate(expression), true, label)
	console.log(`PASS ${label}`)
}
async function key(key, code, virtualKey) {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, ...(key === 'Enter' ? { text: '\r' } : key === ' ' ? { text: ' ' } : {}) })
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey })
}
async function mouse(type, x, y, extra = {}) {
	await send('Input.dispatchMouseEvent', { type, x, y, ...extra })
}
try {
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
	profile = await mkdtemp(join(tmpdir(), 'backgroundchanger-attribution-'))
	chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
		'--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
		'--disable-background-networking', '--disable-component-update', '--disable-sync',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1000,800', 'about:blank',
	], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
	let stderr = ''
	chrome.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
	chrome.on('error', error => { chromeError = error })
	let port
	await until(async () => {
		if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${stderr}`)
		try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return port > 0 } catch { return false }
	}, 'Chrome debugging endpoint')
	const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json()
	ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
	ws.addEventListener('message', event => {
		const message = JSON.parse(event.data)
		if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
		const item = pending.get(message.id)
		if (!item) return
		clearTimeout(item.timer)
		pending.delete(message.id)
		if (message.error) item.reject(new Error(JSON.stringify(message.error)))
		else item.resolve(message.result)
	})
	await until(() => ws.readyState === WebSocket.OPEN, 'CDP WebSocket')
	await send('Runtime.enable')
	await send('Page.enable')
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
	await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
	await until(() => evaluate('Boolean(document.documentElement?.dataset.backgroundchangerReady)'), 'real JS fetching and decoding synthetic image')
	console.log(`Synthetic local fixture; real assets: ${ref || 'working tree'}; ${await evaluate('navigator.userAgent')}`)
	await evaluate(`window.credit = document.getElementById('backgroundchanger-credit'); window.toggle = credit.querySelector('button'); window.panel = credit.querySelector('.backgroundchanger-panel'); window.visible = () => panel && getComputedStyle(panel).visibility === 'visible' && Number(getComputedStyle(panel).opacity) === 1`)
	await check('!!toggle && !!panel', 'collapsible attribution button and panel exist')
	await check('toggle.getBoundingClientRect().width === 22 && toggle.getBoundingClientRect().height === 22 && Number(getComputedStyle(toggle).opacity) === 0.4', 'discreet 22px button despite synthetic host button defaults')
	await check('getComputedStyle(panel).visibility === "hidden" && getComputedStyle(panel).opacity === "0" && getComputedStyle(panel).pointerEvents === "none" && toggle.getAttribute("aria-expanded") === "false"', 'panel initially hidden and non-interactive')
	const point = await evaluate('(() => { const r = toggle.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()')
	await mouse('mouseMoved', point.x, point.y)
	await check('visible() && getComputedStyle(panel).pointerEvents === "auto"', 'real pointer hover reveals panel')
	await mouse('mouseMoved', 1, 1)
	await check('!visible()', 'leaving hover collapses panel')
	await key('Tab', 'Tab', 9)
	await check('document.activeElement === toggle && visible() && !!toggle.getAttribute("aria-label")', 'Tab reaches labelled button and reveals panel')
	await key('Tab', 'Tab', 9)
	await check('document.activeElement === panel.querySelector("a") && visible()', 'Tab reaches attribution link')
	await evaluate('toggle.focus()')
	await key('Enter', 'Enter', 13)
	await check('credit.hasAttribute("data-open") && toggle.getAttribute("aria-expanded") === "true"', 'Enter pins panel open')
	await key('Escape', 'Escape', 27)
	await check('!credit.hasAttribute("data-open") && toggle.getAttribute("aria-expanded") === "false" && document.activeElement === toggle', 'Escape unpins and returns focus (focus-within remains visible)')
	await key(' ', 'Space', 32)
	await check('credit.hasAttribute("data-open")', 'Space activates native button')
	await key('Escape', 'Escape', 27)
	await mouse('mousePressed', point.x, point.y, { button: 'left', clickCount: 1 })
	await mouse('mouseReleased', point.x, point.y, { button: 'left', clickCount: 1 })
	await mouse('mouseMoved', 1, 1)
	await evaluate('document.activeElement.blur()')
	await check('credit.hasAttribute("data-open") && visible() && toggle.getAttribute("aria-expanded") === "true"', 'click pins panel without hover or focus')
	const links = `(() => { const a = [...panel.querySelectorAll('a')]; return a.length === 4 && a.map(x=>x.textContent).join('|') === [document.documentElement.dataset.backgroundchangerReady === '${ids[0]}' ? 'Synthetic image 1' : 'Synthetic image 2','Synthetic author','CC BY-SA 4.0','Wikimedia Commons'].join('|') && a.every((x,i)=>x.href === (i === 2 ? '${licenseUrl}' : '${sourceUrl}') && x.target === '_blank' && x.relList.contains('noopener') && x.relList.contains('noreferrer')) })()`
	await check(links, 'all four attribution links, labels and safe targets preserved')
	await evaluate('window.oldId = document.documentElement.dataset.backgroundchangerReady; history.pushState({}, "", "?fixture=second")')
	await until(() => evaluate('!!document.documentElement.dataset.backgroundchangerReady && document.documentElement.dataset.backgroundchangerReady !== oldId'), 'route-triggered image change')
	await check('toggle === document.querySelector("#backgroundchanger-credit button") && credit.hasAttribute("data-open") && visible() && toggle.getAttribute("aria-expanded") === "true"', 'image change preserves button identity and pinned-open state')
	await check(links, 'new image updates attribution links')
	await evaluate('toggle.focus()')
	await key('Escape', 'Escape', 27)
	await evaluate('toggle.blur(); window.oldId = document.documentElement.dataset.backgroundchangerReady; history.pushState({}, "", "?fixture=third")')
	await until(() => evaluate('!!document.documentElement.dataset.backgroundchangerReady && document.documentElement.dataset.backgroundchangerReady !== oldId'), 'second image change')
	await check('toggle === document.querySelector("#backgroundchanger-credit button") && !credit.hasAttribute("data-open") && !visible()', 'image change preserves collapsed state and button identity')
	await send('Emulation.setEmulatedMedia', { media: 'print' })
	await check('getComputedStyle(credit).display === "none" && credit.getClientRects().length === 0', 'print hides attribution')
	assert.deepEqual(errors, [], 'no uncaught browser exceptions')
	console.log('PASS attribution browser regression (synthetic fixture only)')
} catch (error) {
	console.error(`FAIL attribution browser regression: ${error.message}`)
	process.exitCode = 1
} finally {
	// Close even on assertion failure, startup failure or SIGINT/SIGTERM.
	for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Test shutdown')) }
	pending.clear()
	if (ws && ws.readyState < WebSocket.CLOSING) ws.close()
	if (chrome?.pid) {
		const killGroup = signal => { try { process.kill(-chrome.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
		killGroup('SIGTERM')
		for (let i = 0; i < 30 && chrome.exitCode === null && chrome.signalCode === null; i++) await delay(50)
		killGroup('SIGKILL')
		if (chrome.exitCode === null && chrome.signalCode === null) await new Promise(resolve => chrome.once('exit', resolve))
	}
	server.closeAllConnections()
	await new Promise(resolve => server.close(resolve))
	if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	process.off('SIGINT', signal)
	process.off('SIGTERM', signal)
}

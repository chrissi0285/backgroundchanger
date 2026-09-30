/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

// Deliberately local DOM doubles: no Nextcloud or browser session is accessed.
const source = readFileSync(new URL('../js/settings.js', import.meta.url), 'utf8')
function fixture({ failure = 'http', oc = true } = {}) {
	const listeners = new Map()
	const requests = []
	const messages = []
	let reloads = 0
	let focused = null
	class Element {
		setAttribute(name, value) { this[name] = value }
		remove() { messages.splice(messages.indexOf(this), 1) }
	}
	class Input extends Element {
		constructor(value) { super(); this.value = value; this.type = 'radio'; this.disabled = false; this.checked = value === 'default' }
		closest(selector) { return selector === '.declarative-form-field-radio' ? field : selector === 'input[type="radio"]' ? this : null }
		focus() { focused = this }
	}
	const radios = ['default', 'off', 'landscapes', 'animals', 'space', 'architecture'].map(value => new Input(value))
	const field = {
		closest: () => ({ textContent: 'ImageChanger' }),
		querySelectorAll: () => radios,
		querySelector: () => messages[0] || null,
		appendChild: message => messages.push(message),
	}
	const window = {
		OC: oc ? { generateUrl: path => path, requestToken: 'test-token' } : undefined,
		location: { reload: () => reloads++ },
		fetch: async (url, options) => {
			requests.push({ url, ...options })
			if (failure === 'network') throw new Error('offline')
			return { ok: failure !== 'http', status: 500, json: async () => {
				if (failure === 'json') throw new Error('invalid JSON')
				return { theme: failure === 'mismatch' ? 'wrong' : JSON.parse(options.body).theme }
			} }
		},
	}
	runInNewContext(source, { window, Element, HTMLInputElement: Input, document: {
		addEventListener: (name, listener) => listeners.set(name, listener),
		createElement: () => new Element(),
	} })
	async function dispatch(type, input, key) {
		const event = { target: input, key, preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true } }
		listeners.get(type)?.(event)
		await new Promise(resolve => setImmediate(resolve))
		return event
	}
	return { radios, requests, messages, dispatch, get reloads() { return reloads }, get focused() { return focused } }
}

for (const failure of ['http', 'network', 'json', 'mismatch']) {
	test(`visible accessible error without OC.Notification: ${failure}`, async () => {
		const f = fixture({ failure })
		await f.dispatch('click', f.radios[3])
		assert.equal(f.messages.length, 1)
		assert.equal(f.messages[0].role, 'alert')
		assert.match(f.messages[0].textContent, /could not save/)
		assert.ok(f.radios.every(radio => !radio.disabled))
		assert.ok(f.radios[0].checked)
		assert.equal(f.reloads, 0)
		await f.dispatch('click', f.radios[3])
		assert.equal(f.messages.length, 1, 'retry must not duplicate errors')
	})
}
test('missing Nextcloud request context is not a silent failure', async () => {
	const f = fixture({ oc: false })
	await f.dispatch('click', f.radios[3])
	assert.equal(f.messages.length, 1)
	assert.equal(f.requests.length, 0)
})
for (const [key, index, expected] of [['ArrowRight', 0, 'off'], ['ArrowDown', 5, 'default'], ['ArrowLeft', 0, 'architecture'], ['ArrowUp', 3, 'landscapes'], [' ', 3, 'animals']]) {
	test(`keyboard ${key} saves ${expected} once through the app endpoint`, async () => {
		const f = fixture({ failure: null })
		const event = await f.dispatch('keydown', f.radios[index], key)
		assert.ok(event.prevented && event.stopped)
		assert.equal(f.requests.length, 1)
		assert.equal(f.requests[0].url, '/apps/backgroundchanger/api/theme')
		assert.equal(f.requests[0].headers.requesttoken, 'test-token')
		assert.equal(JSON.parse(f.requests[0].body).theme, expected)
		assert.equal(f.reloads, 1)
		assert.equal(f.focused.value, expected)
	})
}
test('Tab and unrelated radios remain untouched', async () => {
	const f = fixture()
	assert.equal((await f.dispatch('keydown', f.radios[0], 'Tab')).prevented, undefined)
	f.radios[0].value = 'foreign'
	assert.equal((await f.dispatch('click', f.radios[0])).prevented, undefined)
	assert.equal(f.requests.length, 0)
})

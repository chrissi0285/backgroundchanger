/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

(() => {
	'use strict'

	const themes = new Set(['default', 'off', 'landscapes', 'animals', 'space', 'architecture'])
	let saving = false

	function themeField(input) {
		if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !themes.has(input.value)) {
			return null
		}
		const field = input.closest('.declarative-form-field-radio')
		const section = field?.closest('.declarative-settings-section')
		if (!field || !section) {
			return null
		}
		const values = new Set([...field.querySelectorAll('input[type="radio"]')].map(candidate => candidate.value))
		if (values.size !== themes.size || ![...themes].every(theme => values.has(theme))) {
			return null
		}
		return section.textContent?.includes('ImageChanger') ? field : null
	}

	function notifyFailure() {
		if (window.OC?.Notification?.showTemporary) {
			window.OC.Notification.showTemporary('ImageChanger could not save the theme.')
		}
	}

	function radioFromClick(target) {
		if (!(target instanceof Element)) {
			return null
		}
		return target.closest('input[type="radio"]')
			|| target.closest('.checkbox-radio-switch')?.querySelector('input[type="radio"]')
			|| null
	}

	async function saveTheme(input, field) {
		if (saving || typeof window.OC?.generateUrl !== 'function' || typeof window.OC?.requestToken !== 'string') {
			return
		}
		saving = true
		const radios = [...field.querySelectorAll('input[type="radio"]')]
		const previous = radios.find(candidate => candidate.checked && candidate !== input) || null
		radios.forEach(candidate => {
			candidate.disabled = true
		})

		try {
			const response = await window.fetch(window.OC.generateUrl('/apps/backgroundchanger/api/theme'), {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					requesttoken: window.OC.requestToken,
				},
				body: JSON.stringify({ theme: input.value }),
			})
			if (!response.ok) {
				throw new Error(`Theme save returned HTTP ${response.status}`)
			}
			const payload = await response.json()
			if (payload.theme !== input.value) {
				throw new Error('Theme save response did not match the request')
			}
			window.location.reload()
		} catch (error) {
			if (previous) {
				previous.checked = true
			}
			radios.forEach(candidate => {
				candidate.disabled = false
			})
			saving = false
			notifyFailure()
		}
	}

	document.addEventListener('click', event => {
		const input = radioFromClick(event.target)
		const field = themeField(input)
		if (!field) {
			return
		}
		event.preventDefault()
		event.stopImmediatePropagation()
		void saveTheme(input, field)
	}, true)
})()

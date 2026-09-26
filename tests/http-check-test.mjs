/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

// Execute the actual shell checker with isolated command doubles, never a guest.
function run(scenario) {
	const dir = mkdtempSync(join(tmpdir(), 'backgroundchanger-http-test-'))
	try {
		const shim = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const scenario = process.env.SCENARIO;
const state = process.env.STATE;
if (path.basename(process.argv[1]) === 'runuser') {
 if (args.includes('user:info')) process.exit(scenario === 'existing' ? 0 : 1);
 if (args.includes('user:delete')) fs.writeFileSync(state + '.deleted', 'yes');
 if (args.includes('group:adduser')) fs.writeFileSync(state + '.admin', 'yes');
 if (args.includes('-r')) process.stdout.write(fs.existsSync(state) ? fs.readFileSync(state) : '');
} else {
 fs.readFileSync(0); // consume curl credentials without logging them
 const admin = fs.existsSync(state + '.admin');
 const bad = !scenario.startsWith('admin-') || admin;
 const kind = scenario.replace(/^admin-/, '');
 const theme = JSON.parse(args[args.indexOf('--data') + 1]).value;
 if (!(bad && kind === 'storage')) fs.writeFileSync(state, theme);
 fs.writeFileSync(args[args.indexOf('--output') + 1], bad && kind === 'json' ? 'invalid' : JSON.stringify({ocs:{meta:{statuscode:bad && kind === 'ocs' ? 998 : 200, status:'ok'}}}));
 process.stdout.write(bad && kind === 'http' ? '403' : '200');
}
`
		for (const name of ['runuser', 'curl']) writeFileSync(join(dir, name), shim, { mode: 0o700 })
		const result = spawnSync('bash', [new URL('./runi-declarative-http-check.sh', import.meta.url).pathname, '/var/www/nextcloud', 'http://172.16.1.2'], {
			env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SCENARIO: scenario, STATE: join(dir, 'state') }, encoding: 'utf8',
		})
		let deleted = false
		try { deleted = readFileSync(join(dir, 'state.deleted'), 'utf8') === 'yes' } catch {}
		return { ...result, deleted }
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}
test('HTTP contract accepts persisted success for both roles', () => {
	const result = run('success')
	assert.equal(result.status, 0, result.stderr)
	assert.ok(result.deleted)
})
for (const scenario of ['http', 'ocs', 'json', 'storage', 'admin-http', 'admin-ocs', 'admin-storage']) {
	test(`HTTP contract rejects ${scenario}`, () => {
		const result = run(scenario)
		assert.notEqual(result.status, 0, result.stdout)
		const role = scenario.startsWith('admin-') ? 'admin' : 'regular'
		const kind = scenario.replace(/^admin-/, '')
		const expected = {
			http: `${role}: expected HTTP 200, got 403`,
			ocs: `${role}: expected OCS statuscode 200`,
			storage: `${role}: expected stored theme`,
			json: 'JsonException',
		}[kind]
		assert.ok(result.stderr.includes(expected), result.stderr)
		assert.ok(result.deleted)
	})
}
test('pre-existing contract user must not be deleted', () => {
	const result = run('existing')
	assert.notEqual(result.status, 0)
	assert.equal(result.deleted, false)
})

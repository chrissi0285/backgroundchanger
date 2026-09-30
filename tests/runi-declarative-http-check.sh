#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 chrissi0285
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

nextcloud_root=${1:-}
nextcloud_base=${2:-}
uid=backgroundchanger-http-contract
body=
password=
created=false

if [[ $nextcloud_root != /var/www/nextcloud
	|| ! $nextcloud_base =~ ^http://172\.16\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
	printf '%s\n' 'Pass the isolated Nextcloud root and guest URL.' >&2
	exit 2
fi

nc() {
	runuser -u www-data -- php "$nextcloud_root/occ" "$@"
}

cleanup() {
	if [[ $created == true ]]; then
		nc user:delete "$uid" >/dev/null
	fi
	rm -f -- "$body"
	password=
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

if nc user:info "$uid" >/dev/null 2>&1; then
	printf '%s\n' 'Transient HTTP contract user already exists.' >&2
	exit 1
fi

body=$(mktemp /tmp/backgroundchanger-http-contract-response.XXXXXX)
password=$(openssl rand -hex 24)
OC_PASS=$password nc user:add --password-from-env --display-name 'BackgroundChanger contract test' "$uid" >/dev/null
created=true

request() {
	local role=$1
	local theme=$2
	local status
	status=$(
		printf 'user = "%s:%s"\n' "$uid" "$password" |
			curl --silent --show-error --config - \
				--output "$body" \
				--write-out '%{http_code}' \
				--header 'Accept: application/json' \
				--header 'OCS-APIRequest: true' \
				--header 'Content-Type: application/json' \
				--data "{\"app\":\"backgroundchanger\",\"formId\":\"backgroundchanger-theme\",\"fieldId\":\"theme\",\"value\":\"$theme\"}" \
				"$nextcloud_base/ocs/v2.php/settings/api/declarative/value?format=json"
	)
	printf '%s_http=%s\n' "$role" "$status"
	if [[ $status != 200 ]]; then
		printf '%s\n' "$role: expected HTTP 200, got $status" >&2
		return 1
	fi
	php -r '
		$data = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
		echo json_encode(["role" => $argv[2], "statuscode" => $data["ocs"]["meta"]["statuscode"] ?? null,
			"message" => $data["ocs"]["meta"]["message"] ?? null]), "\n";
		if (($data["ocs"]["meta"]["statuscode"] ?? null) !== 200) {
			fwrite(STDERR, $argv[2] . ": expected OCS statuscode 200\n");
			exit(1);
		}
	' "$body" "$role"
}

stored_theme() {
	runuser -u www-data -- php -r '
		define("OC_CONSOLE", 1);
		require_once "/var/www/nextcloud/lib/base.php";
		echo \OC::$server->get(\OCP\IConfig::class)->getUserValue($argv[1], "backgroundchanger", "theme", "");
	' "$uid"
}

assert_stored_theme() {
	local role=$1 expected=$2 actual
	actual=$(stored_theme)
	printf '%s_stored_theme=%s\n' "$role" "$actual"
	if [[ $actual != "$expected" ]]; then
		printf '%s\n' "$role: expected stored theme $expected, got $actual" >&2
		return 1
	fi
}

request regular animals
assert_stored_theme regular animals
nc group:adduser admin "$uid" >/dev/null
# A different value proves that the admin request really persisted its change.
request admin space
assert_stored_theme admin space
printf '%s\n' 'Declarative HTTP and persistence checks passed for both roles.'

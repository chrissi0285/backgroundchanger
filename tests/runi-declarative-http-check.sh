#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 chrissi0285
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

nextcloud_root=${1:-}
nextcloud_base=${2:-}
uid=backgroundchanger-http-contract
body=/tmp/backgroundchanger-http-contract-response.$$
password=

if [[ $nextcloud_root != /var/www/nextcloud
	|| ! $nextcloud_base =~ ^http://172\.16\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
	printf '%s\n' 'Pass the isolated Nextcloud root and guest URL.' >&2
	exit 2
fi

nc() {
	runuser -u www-data -- php "$nextcloud_root/occ" "$@"
}

cleanup() {
	nc user:delete "$uid" >/dev/null 2>&1 || true
	rm -f -- "$body"
	password=
}
trap cleanup EXIT HUP INT TERM

if nc user:info "$uid" >/dev/null 2>&1; then
	printf '%s\n' 'Transient HTTP contract user already exists.' >&2
	exit 1
fi

password=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9_-' | head -c 48)
OC_PASS=$password nc user:add --password-from-env --display-name 'Background Changer contract test' "$uid" >/dev/null

request() {
	local role=$1
	local status
	status=$(
		printf 'user = "%s:%s"\n' "$uid" "$password" |
			curl --silent --show-error --config - \
				--output "$body" \
				--write-out '%{http_code}' \
				--header 'Accept: application/json' \
				--header 'OCS-APIRequest: true' \
				--header 'Content-Type: application/json' \
				--data '{"app":"backgroundchanger","formId":"backgroundchanger-theme","fieldId":"theme","value":"animals"}' \
				"$nextcloud_base/ocs/v2.php/settings/api/declarative/value?format=json"
	)
	printf '%s_http=%s\n' "$role" "$status"
	jq -c --arg role "$role" '{role:$role,statuscode:(.ocs.meta.statuscode // null),message:(.ocs.meta.message // .ocs.data.message // .message // null)}' "$body"
}

stored_theme() {
	runuser -u www-data -- php -r '
		define("OC_CONSOLE", 1);
		require_once "/var/www/nextcloud/lib/base.php";
		echo \OC::$server->get(\OCP\IConfig::class)->getUserValue($argv[1], "backgroundchanger", "theme", "");
	' "$uid"
}

request regular
printf 'regular_stored_theme=%s\n' "$(stored_theme)"
nc group:adduser admin "$uid" >/dev/null
request admin
printf 'admin_stored_theme=%s\n' "$(stored_theme)"

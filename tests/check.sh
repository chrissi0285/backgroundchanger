#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 Christian
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

while IFS= read -r -d '' file; do
	php -l "$file" >/dev/null
done < <(find appinfo lib tests -type f -name '*.php' -print0 | sort -z)

php tests/unit.php
# tests/cache.php needs the real Nextcloud 34 interfaces and is run by the
# isolated integration harness after loading Nextcloud's bootstrap.
node --check js/background.js
xmllint --noout appinfo/info.xml

if grep -R -n -E 'OCA\\Unsplash|<id>unsplash</id>|apps/unsplash' appinfo css img js lib; then
	printf '%s\n' 'Runtime files still contain the foreign app identity.' >&2
	exit 1
fi

if find . -path './.git' -prune -o -name 'signature.json' -print | grep -q .; then
	printf '%s\n' 'An unsigned development tree must not carry a foreign signature.' >&2
	exit 1
fi

printf '%s\n' 'Syntax, identity and unit checks passed.'

#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 chrissi0285
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
node --check tests/browser-test.mjs
bash -n tests/runi-install.sh
xmllint --noout appinfo/info.xml

if grep -R -n -E 'OCA\\(Unsplash|Wechselbild)|<id>(unsplash|wechselbild)</id>|apps/(unsplash|wechselbild)' appinfo css img js lib; then
	printf '%s\n' 'Runtime files still contain a foreign or predecessor app identity.' >&2
	exit 1
fi

if grep -R -n -E 'SPDX-FileCopyrightText: 2026 (Christian|Chrissi)|<author[^>]*>(Christian|Chrissi)<' appinfo css img js lib tests; then
	printf '%s\n' 'Public author metadata is inconsistent.' >&2
	exit 1
fi

grep -q '<id>backgroundchanger</id>' appinfo/info.xml
grep -q '<namespace>BackgroundChanger</namespace>' appinfo/info.xml
grep -q '<author homepage="https://github.com/chrissi0285">chrissi0285</author>' appinfo/info.xml
grep -q 'Source-SHA256: 867c66e8d84bc2ee279fa2a85a6a4659160db9091c6a18ae01566aa7de2a3e99' img/app.svg
grep -q 'designed by chrissi0285' js/background.js

if find . -path './.git' -prune -o -name 'signature.json' -print | grep -q .; then
	printf '%s\n' 'An unsigned development tree must not carry a foreign signature.' >&2
	exit 1
fi

printf '%s\n' 'Syntax, identity and unit checks passed.'

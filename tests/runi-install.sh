#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 chrissi0285
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

guest_ip=${1:-}
release_root=/root/backgroundchanger-test
archive=$release_root/nextcloud-34.0.3.tar.bz2
db_password=${BACKGROUNDCHANGER_DB_PASSWORD:-}
admin_password=${BACKGROUNDCHANGER_ADMIN_PASSWORD:-}

if [[ ! $guest_ip =~ ^172\.16\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
	printf '%s\n' 'Expected the isolated RUNI guest IPv4 address.' >&2
	exit 2
fi
if [[ ! $db_password =~ ^[A-Za-z0-9_-]{20,128}$
	|| ! $admin_password =~ ^[A-Za-z0-9_-]{20,128}$ ]]; then
	printf '%s\n' 'Provide random test passwords through BACKGROUNDCHANGER_DB_PASSWORD and BACKGROUNDCHANGER_ADMIN_PASSWORD.' >&2
	exit 2
fi
for extension in apcu redis; do
	if ! php -m | grep -Fqx "$extension"; then
		printf 'Required PHP extension is missing: %s\n' "$extension" >&2
		exit 2
	fi
done
if [[ -e /var/www/nextcloud || ! -f $archive ]]; then
	printf '%s\n' 'Nextcloud target is not empty or the verified archive is missing.' >&2
	exit 2
fi

if ! tar -tjf "$archive" | awk '
	/^\// || /(^|\/)\.\.(\/|$)/ || $0 !~ /^nextcloud\// { bad = 1 }
	END { exit bad }
'; then
	printf '%s\n' 'Archive contains an unsafe path.' >&2
	exit 2
fi

tar -xjf "$archive" -C /var/www
install -d -o www-data -g www-data -m 0750 /var/nextcloud-data
chown -R www-data:www-data /var/www/nextcloud

install -o root -g root -m 0644 "$release_root/apache-nextcloud.conf" /etc/apache2/sites-available/nextcloud.conf
install -o root -g root -m 0644 "$release_root/php-nextcloud.ini" /etc/php/8.5/apache2/conf.d/99-nextcloud-test.ini
install -o root -g root -m 0644 "$release_root/php-nextcloud.ini" /etc/php/8.5/cli/conf.d/99-nextcloud-test.ini

a2enmod rewrite headers env dir mime setenvif >/dev/null
a2dissite 000-default >/dev/null
a2ensite nextcloud >/dev/null
apache2ctl configtest

mariadb --execute="CREATE DATABASE nextcloud CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; CREATE USER 'nextcloud'@'localhost' IDENTIFIED BY '$db_password'; GRANT ALL PRIVILEGES ON nextcloud.* TO 'nextcloud'@'localhost'; FLUSH PRIVILEGES;"

nc() {
	runuser -u www-data -- php -d memory_limit=512M /var/www/nextcloud/occ "$@"
}

nc maintenance:install \
	--database=mysql \
	--database-host=localhost \
	--database-name=nextcloud \
	--database-user=nextcloud \
	--database-pass="$db_password" \
	--admin-user=admin \
	--admin-pass="$admin_password" \
	--data-dir=/var/nextcloud-data
nc config:system:set trusted_domains 1 --value="$guest_ip"
nc config:system:set overwrite.cli.url --value="http://$guest_ip"
nc config:system:set memcache.local --value='\OC\Memcache\APCu'
nc config:system:set memcache.distributed --value='\OC\Memcache\Redis'
nc config:system:set memcache.locking --value='\OC\Memcache\Redis'
nc config:system:set redis host --value=127.0.0.1
nc config:system:set redis port --type=integer --value=6379
nc config:system:set loglevel --type=integer --value=1
nc background:cron

systemctl restart mariadb redis-server apache2
systemctl is-active mariadb redis-server apache2
nc status
curl --fail --silent --show-error --output /dev/null "http://$guest_ip/login"

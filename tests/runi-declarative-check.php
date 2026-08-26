<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

use OCA\Settings\Controller\DeclarativeSettingsController;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\IConfig;
use OCP\IUserManager;
use OCP\Settings\IDeclarativeManager;

$nextcloudRoot = $argv[1] ?? '';
if ($nextcloudRoot !== '/var/www/nextcloud' || !is_file($nextcloudRoot . '/lib/base.php')) {
	throw new RuntimeException('Pass the isolated Nextcloud root');
}

define('OC_CONSOLE', 1);
require_once $nextcloudRoot . '/lib/base.php';
\OC_App::loadApps();

$checks = 0;
$check = static function (bool $condition, string $message) use (&$checks): void {
	$checks++;
	if (!$condition) {
		throw new RuntimeException($message);
	}
};

$method = new ReflectionMethod(DeclarativeSettingsController::class, 'setValue');
$check(count($method->getAttributes(NoAdminRequired::class)) === 1,
	'NC34 setValue must expose exactly one NoAdminRequired attribute');

$uid = 'backgroundchanger-contract';
$userManager = \OC::$server->get(IUserManager::class);
$check($userManager->get($uid) === null, 'Transient contract user already exists');
$user = $userManager->createUser($uid, bin2hex(random_bytes(32)));
$check($user !== false, 'Transient contract user could not be created');

try {
	$manager = \OC::$server->get(IDeclarativeManager::class);
	$manager->loadSchemas();
	$config = \OC::$server->get(IConfig::class);
	$values = ['default', 'off', 'landscapes', 'animals', 'space', 'architecture'];
	foreach ($values as $value) {
		$manager->setValue(
			$user,
			'backgroundchanger',
			'backgroundchanger-theme',
			'theme',
			$value,
		);
		$check(
			$config->getUserValue($uid, 'backgroundchanger', 'theme', '') === $value,
			'Declarative manager did not persist ' . $value,
		);
	}
} finally {
	$current = $userManager->get($uid);
	if ($current !== null) {
		$current->delete();
	}
}

$check($userManager->get($uid) === null, 'Transient contract user was not removed');
printf("%d declarative manager checks passed.\n", $checks);

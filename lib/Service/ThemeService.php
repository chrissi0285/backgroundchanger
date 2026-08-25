<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Service;

use OCA\BackgroundChanger\AppInfo\Application;
use OCP\IConfig;
use OCP\IUserSession;

final class ThemeService {
	public const PREFERENCE_KEY = 'theme';
	public const DEFAULT = 'default';
	public const OFF = 'off';
	public const LANDSCAPES = 'landscapes';
	public const ANIMALS = 'animals';
	public const SPACE = 'space';
	public const ARCHITECTURE = 'architecture';

	/** @var list<string> */
	private const CACHE_THEMES = [
		self::LANDSCAPES,
		self::ANIMALS,
		self::SPACE,
		self::ARCHITECTURE,
	];

	/** @var array<string, list<string>> */
	private const COMMONS_CATEGORIES = [
		self::LANDSCAPES => [
			'Category:Featured pictures of landscapes',
		],
		self::ANIMALS => [
			'Category:Featured pictures of animals in flight',
			'Category:Featured pictures of Echinodermata',
			'Category:Featured pictures of Cnidaria',
			'Category:Featured pictures of Annelida',
		],
		self::SPACE => [
			'Category:Featured pictures of astronomy',
		],
		self::ARCHITECTURE => [
			'Category:Featured pictures of architecture',
		],
	];

	public function __construct(
		private IConfig $config,
		private IUserSession $userSession,
	) {
	}

	public function currentPreference(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return self::DEFAULT;
		}

		return self::normalizePreference($this->config->getUserValue(
			$user->getUID(),
			Application::APP_ID,
			self::PREFERENCE_KEY,
			self::DEFAULT,
		));
	}

	public function currentTheme(): ?string {
		return self::effectiveTheme($this->currentPreference());
	}

	public static function normalizePreference(mixed $preference): string {
		if (!is_string($preference)) {
			return self::DEFAULT;
		}

		return in_array($preference, [self::DEFAULT, self::OFF, ...self::CACHE_THEMES], true)
			? $preference
			: self::DEFAULT;
	}

	public static function effectiveTheme(mixed $preference): ?string {
		$preference = self::normalizePreference($preference);
		if ($preference === self::OFF) {
			return null;
		}
		return $preference === self::DEFAULT ? self::LANDSCAPES : $preference;
	}

	public static function isCacheTheme(string $theme): bool {
		return in_array($theme, self::CACHE_THEMES, true);
	}

	/** @return list<string> */
	public static function cacheThemes(): array {
		return self::CACHE_THEMES;
	}

	/** @return array<string, list<string>> */
	public static function commonsCategories(): array {
		return self::COMMONS_CATEGORIES;
	}

	/** @return list<string> */
	public static function categoriesFor(string $theme): array {
		return self::COMMONS_CATEGORIES[$theme] ?? [];
	}
}

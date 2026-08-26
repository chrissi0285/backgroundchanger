<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Controller;

use OCA\BackgroundChanger\AppInfo\Application;
use OCA\BackgroundChanger\Service\ThemeService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

final class SettingsController extends Controller {
	public function __construct(
		IRequest $request,
		private IConfig $config,
		private IUserSession $userSession,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * NC34 compatibility: its settings-app declarative write route rejects
	 * ordinary users before reaching the personal settings manager.
	 *
	 * @NoAdminRequired
	 */
	#[NoAdminRequired]
	public function setTheme(mixed $theme = ''): JSONResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return new JSONResponse(['error' => 'Authentication required'], Http::STATUS_UNAUTHORIZED);
		}
		if (!is_string($theme) || ThemeService::normalizePreference($theme) !== $theme) {
			return new JSONResponse(['error' => 'Invalid theme'], Http::STATUS_BAD_REQUEST);
		}

		$this->config->setUserValue(
			$user->getUID(),
			Application::APP_ID,
			ThemeService::PREFERENCE_KEY,
			$theme,
		);
		$response = new JSONResponse(['theme' => $theme]);
		$response->cacheFor(0);
		return $response;
	}
}

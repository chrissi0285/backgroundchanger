<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\EventListener;

use OCA\Wechselbild\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IConfig;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/** @template-implements IEventListener<Event> */
final class BeforeTemplateRenderedEventListener implements IEventListener {
	public function __construct(
		private IConfig $config,
		private IUserSession $userSession,
		private IURLGenerator $urlGenerator,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent
			&& !$event instanceof BeforeLoginTemplateRenderedEvent) {
			return;
		}

		if ($event instanceof BeforeTemplateRenderedEvent
			&& $event->isLoggedIn()
			&& $this->hasPersonalBackground()) {
			return;
		}

		Util::addHeader('meta', [
			'name' => 'wechselbild-endpoint',
			'content' => $this->urlGenerator->linkToRouteAbsolute(
				Application::APP_ID . '.background.select',
			),
		]);
		Util::addStyle(Application::APP_ID, 'background');
		Util::addScript(Application::APP_ID, 'background');
	}

	private function hasPersonalBackground(): bool {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return false;
		}

		return $this->config->getUserValue(
			$user->getUID(),
			'theming',
			'background_image',
			'default',
		) !== 'default';
	}
}

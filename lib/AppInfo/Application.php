<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\AppInfo;

use OCA\Wechselbild\EventListener\BeforeTemplateRenderedEventListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;

final class Application extends App implements IBootstrap {
	public const APP_ID = 'wechselbild';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	#[\Override]
	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			BeforeTemplateRenderedEventListener::class,
		);
		$context->registerEventListener(
			BeforeLoginTemplateRenderedEvent::class,
			BeforeTemplateRenderedEventListener::class,
		);
	}

	#[\Override]
	public function boot(IBootContext $context): void {
	}
}

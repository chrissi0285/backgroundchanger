<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Cron;

use OCA\BackgroundChanger\Service\RefreshService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJob;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

final class RefreshBackgrounds extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private RefreshService $refreshService,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(6 * 3600);
		$this->setTimeSensitivity(IJob::TIME_INSENSITIVE);
		$this->setAllowParallelRuns(false);
	}

	#[\Override]
	protected function run($arguments): void {
		try {
			$result = $this->refreshService->refresh();
			$this->logger->info(
				'ImageChanger refresh completed: {added} added, {after} cached',
				['app' => 'backgroundchanger', 'added' => $result['added'], 'after' => $result['after']],
			);
		} catch (\Throwable $e) {
			$this->logger->warning('ImageChanger refresh failed: {reason}', [
				'app' => 'backgroundchanger',
				'reason' => $e->getMessage(),
			]);
		}
	}
}

<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Command;

use OCA\BackgroundChanger\Service\RefreshService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class Refresh extends Command {
	public function __construct(private RefreshService $refreshService) {
		parent::__construct();
	}

	#[\Override]
	protected function configure(): void {
		$this
			->setName('backgroundchanger:refresh')
			->setDescription('Fetch and validate the next Wikimedia Commons backgrounds');
	}

	#[\Override]
	protected function execute(InputInterface $input, OutputInterface $output): int {
		try {
			$result = $this->refreshService->refresh();
		} catch (\Throwable $e) {
			$output->writeln('<error>Background Changer refresh failed: ' . $e->getMessage() . '</error>');
			return Command::FAILURE;
		}

		$output->writeln(sprintf(
			'Background Changer cache: %d before, %d added, %d rejected, %d after.',
			$result['before'],
			$result['added'],
			$result['rejected'],
			$result['after'],
		));
		return $result['after'] > 0 ? Command::SUCCESS : Command::FAILURE;
	}
}

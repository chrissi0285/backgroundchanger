<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\Command;

use OCA\Wechselbild\Service\RefreshService;
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
			->setName('wechselbild:refresh')
			->setDescription('Fetch and validate the next Wikimedia Commons backgrounds');
	}

	#[\Override]
	protected function execute(InputInterface $input, OutputInterface $output): int {
		try {
			$result = $this->refreshService->refresh();
		} catch (\Throwable $e) {
			$output->writeln('<error>Wechselbild refresh failed: ' . $e->getMessage() . '</error>');
			return Command::FAILURE;
		}

		$output->writeln(sprintf(
			'Wechselbild cache: %d before, %d added, %d rejected, %d after.',
			$result['before'],
			$result['added'],
			$result['rejected'],
			$result['after'],
		));
		return $result['after'] > 0 ? Command::SUCCESS : Command::FAILURE;
	}
}

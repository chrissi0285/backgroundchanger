<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\Service;

use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

final class RefreshService {
	public const MINIMUM_CACHE = 4;
	public const MAXIMUM_CACHE = 8;

	public function __construct(
		private CacheService $cache,
		private CommonsService $commons,
		private ITimeFactory $time,
		private LoggerInterface $logger,
	) {
	}

	/** @return array{before: int, added: int, after: int, rejected: int} */
	public function refresh(): array {
		$before = $this->cache->count();
		$this->cache->cleanupOrphanImages($this->time->getTime() - 86400);
		$target = $before < self::MINIMUM_CACHE
			? self::MINIMUM_CACHE - $before
			: 1;
		$added = 0;
		$rejected = 0;

		foreach ($this->commons->discover() as $candidate) {
			if ($added >= $target) {
				break;
			}
			$sourceUrl = (string)($candidate['sourceUrl'] ?? '');
			if ($sourceUrl === '' || $this->cache->hasSource($sourceUrl)) {
				continue;
			}

			try {
				$download = $this->commons->download($candidate);
				if ($this->cache->store($download)) {
					$added++;
				}
			} catch (\Throwable $e) {
				$rejected++;
				$this->logger->warning('Wechselbild rejected a Commons candidate: {reason}', [
					'app' => 'wechselbild',
					'reason' => $e->getMessage(),
				]);
			}
		}

		$this->cache->prune(self::MAXIMUM_CACHE);
		return [
			'before' => $before,
			'added' => $added,
			'after' => $this->cache->count(),
			'rejected' => $rejected,
		];
	}
}

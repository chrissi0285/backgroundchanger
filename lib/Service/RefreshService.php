<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Service;

use OCP\AppFramework\Utility\ITimeFactory;
use Psr\Log\LoggerInterface;

final class RefreshService {
	public const MINIMUM_CACHE = 3;
	public const MAXIMUM_CACHE = 6;

	public function __construct(
		private CacheService $cache,
		private CommonsService $commons,
		private ITimeFactory $time,
		private LoggerInterface $logger,
	) {
	}

	/** @return array{before: int, added: int, after: int, rejected: int} */
	public function refresh(): array {
		$themes = ThemeService::cacheThemes();
		$before = $this->cache->totalCount();
		$targets = [];
		foreach ($themes as $theme) {
			$this->cache->cleanupOrphanImages($theme, $this->time->getTime() - 86400);
			$count = $this->cache->count($theme);
			if ($count < self::MINIMUM_CACHE) {
				$targets[$theme] = self::MINIMUM_CACHE - $count;
			}
		}

		// Once every theme has an offline-safe minimum, refresh only one theme
		// per six-hour slot. This bounds provider traffic and local storage.
		if ($targets === []) {
			$slot = intdiv($this->time->getTime(), 6 * 3600) % count($themes);
			$targets[$themes[$slot]] = 1;
		}

		$added = 0;
		$rejected = 0;
		foreach ($targets as $theme => $target) {
			$result = $this->refreshTheme($theme, $target);
			$added += $result['added'];
			$rejected += $result['rejected'];
		}
		foreach ($themes as $theme) {
			$this->cache->prune($theme, self::MAXIMUM_CACHE);
		}

		return [
			'before' => $before,
			'added' => $added,
			'after' => $this->cache->totalCount(),
			'rejected' => $rejected,
		];
	}

	/** @return array{added: int, rejected: int} */
	private function refreshTheme(string $theme, int $target): array {
		$added = 0;
		$rejected = 0;
		foreach ($this->commons->discover($theme) as $candidate) {
			if ($added >= $target) {
				break;
			}
			$sourceUrl = (string)($candidate['sourceUrl'] ?? '');
			if ($sourceUrl === '' || $this->cache->hasSource($theme, $sourceUrl)) {
				continue;
			}

			try {
				$download = $this->commons->download($candidate);
				if ($this->cache->store($theme, $download)) {
					$added++;
				}
			} catch (\Throwable $e) {
				$rejected++;
				$this->logger->debug('BackgroundChanger rejected a Commons candidate for {theme}: {reason}', [
					'app' => 'backgroundchanger',
					'theme' => $theme,
					'reason' => $e->getMessage(),
				]);
			}
		}

		return [
			'added' => $added,
			'rejected' => $rejected,
		];
	}
}

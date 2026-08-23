<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\Service;

use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

final class CacheService {
	private const FOLDER = 'backgrounds';
	private const MAX_FILE_BYTES = 12_000_000;

	public function __construct(private IAppData $appData) {
	}

	/** @return list<array<string, int|string>> */
	public function listBackgrounds(): array {
		$folder = $this->folder(false);
		if ($folder === null) {
			return [];
		}

		$backgrounds = [];
		foreach ($folder->getDirectoryListing() as $file) {
			if (!str_ends_with($file->getName(), '.json') || $file->getSize() > 32_000) {
				continue;
			}
			$record = $this->readRecord($folder, $file);
			if ($record !== null) {
				$backgrounds[] = $record;
			}
		}

		usort(
			$backgrounds,
			static fn (array $left, array $right): int => (int)$right['fetchedAt'] <=> (int)$left['fetchedAt'],
		);
		return $backgrounds;
	}

	public function count(): int {
		return count($this->listBackgrounds());
	}

	public function hasSource(string $sourceUrl): bool {
		foreach ($this->listBackgrounds() as $background) {
			if (hash_equals((string)$background['sourceUrl'], $sourceUrl)) {
				return true;
			}
		}
		return false;
	}

	/** @return array<string, int|string>|null */
	public function select(string $exclude = ''): ?array {
		$backgrounds = $this->listBackgrounds();
		if (count($backgrounds) > 1 && preg_match('/^[a-f0-9]{32}$/D', $exclude) === 1) {
			$backgrounds = array_values(array_filter(
				$backgrounds,
				static fn (array $background): bool => $background['id'] !== $exclude,
			));
		}
		if ($backgrounds === []) {
			return null;
		}
		return $backgrounds[random_int(0, count($backgrounds) - 1)];
	}

	/**
	 * @param array<string, int|string> $download
	 */
	public function store(array $download): bool {
		$body = $download['body'] ?? null;
		$mime = is_string($download['mime'] ?? null) ? $download['mime'] : '';
		$extension = MetadataPolicy::extensionForMime($mime);
		if (!is_string($body) || $extension === null) {
			throw new \InvalidArgumentException('Invalid image payload');
		}

		$hash = hash('sha256', $body);
		$id = substr($hash, 0, 32);
		$imageName = $id . '.' . $extension;
		$metadataName = $id . '.json';
		$folder = $this->folder(true);
		if ($folder->fileExists($metadataName)) {
			return false;
		}

		$record = [
			'id' => $id,
			'file' => $imageName,
			'sha256' => $hash,
			'mime' => $mime,
			'width' => (int)($download['width'] ?? 0),
			'height' => (int)($download['height'] ?? 0),
			'fetchedAt' => (int)($download['fetchedAt'] ?? 0),
			'title' => (string)($download['title'] ?? ''),
			'description' => (string)($download['description'] ?? ''),
			'author' => (string)($download['author'] ?? ''),
			'license' => (string)($download['license'] ?? ''),
			'licenseUrl' => (string)($download['licenseUrl'] ?? ''),
			'sourceUrl' => (string)($download['sourceUrl'] ?? ''),
		];
		if (!$this->validRecord($record, $metadataName)) {
			throw new \InvalidArgumentException('Invalid image metadata');
		}

		try {
			$this->write($folder, $imageName, $body);
			$json = json_encode($record, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
			$this->write($folder, $metadataName, $json);
		} catch (\Throwable $e) {
			if ($folder->fileExists($metadataName)) {
				$folder->getFile($metadataName)->delete();
			}
			if ($folder->fileExists($imageName)) {
				$folder->getFile($imageName)->delete();
			}
			throw $e;
		}
		return true;
	}

	public function prune(int $maximum): void {
		$maximum = max(1, $maximum);
		$folder = $this->folder(false);
		if ($folder === null) {
			return;
		}

		$backgrounds = $this->listBackgrounds();
		foreach (array_slice($backgrounds, $maximum) as $background) {
			$metadataName = (string)$background['id'] . '.json';
			if ($folder->fileExists($metadataName)) {
				$folder->getFile($metadataName)->delete();
			}
		}
	}

	public function cleanupOrphanImages(int $olderThan): void {
		$folder = $this->folder(false);
		if ($folder === null) {
			return;
		}
		$active = [];
		foreach ($this->listBackgrounds() as $background) {
			$active[(string)$background['file']] = true;
		}

		foreach ($folder->getDirectoryListing() as $file) {
			$name = $file->getName();
			if (preg_match('/^[a-f0-9]{32}\.(?:jpg|png|webp)$/D', $name) !== 1
				|| isset($active[$name])
				|| $file->getMTime() >= $olderThan) {
				continue;
			}
			$file->delete();
		}
	}

	/** @return array{0: ISimpleFile, 1: string}|null */
	public function image(string $id): ?array {
		if (preg_match('/^[a-f0-9]{32}$/D', $id) !== 1) {
			return null;
		}
		$folder = $this->folder(false);
		if ($folder === null) {
			return null;
		}

		try {
			foreach (['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'] as $mime => $extension) {
				$name = $id . '.' . $extension;
				if (!$folder->fileExists($name)) {
					continue;
				}
				$file = $folder->getFile($name);
				if ($file->getSize() < 1 || $file->getSize() > self::MAX_FILE_BYTES) {
					return null;
				}
				return [$file, $mime];
			}
		} catch (\Throwable $e) {
			return null;
		}
		return null;
	}

	private function folder(bool $create): ?ISimpleFolder {
		try {
			return $this->appData->getFolder(self::FOLDER);
		} catch (NotFoundException $e) {
			if (!$create) {
				return null;
			}
		}

		try {
			return $this->appData->newFolder(self::FOLDER);
		} catch (\Throwable $e) {
			return $this->appData->getFolder(self::FOLDER);
		}
	}

	private function write(ISimpleFolder $folder, string $name, string $content): void {
		if ($folder->fileExists($name)) {
			$folder->getFile($name)->putContent($content);
			return;
		}
		$folder->newFile($name, $content);
	}

	/** @return array<string, int|string>|null */
	private function readRecord(ISimpleFolder $folder, ISimpleFile $file): ?array {
		try {
			$record = json_decode($file->getContent(), true, 16, JSON_THROW_ON_ERROR);
			if (!is_array($record) || !$this->validRecord($record, $file->getName())) {
				return null;
			}
			if (!$folder->fileExists((string)$record['file'])) {
				return null;
			}
			$image = $folder->getFile((string)$record['file']);
			if ($image->getSize() < 1 || $image->getSize() > self::MAX_FILE_BYTES) {
				return null;
			}
		} catch (\Throwable $e) {
			return null;
		}
		return $record;
	}

	private function validRecord(array $record, string $metadataName): bool {
		$stringKeys = [
			'id', 'file', 'sha256', 'mime', 'title', 'description', 'author',
			'license', 'licenseUrl', 'sourceUrl',
		];
		foreach ($stringKeys as $key) {
			if (!is_string($record[$key] ?? null)) {
				return false;
			}
		}
		foreach (['width', 'height', 'fetchedAt'] as $key) {
			if (!is_int($record[$key] ?? null)) {
				return false;
			}
		}

		$id = is_string($record['id'] ?? null) ? $record['id'] : '';
		$file = is_string($record['file'] ?? null) ? $record['file'] : '';
		$mime = is_string($record['mime'] ?? null) ? $record['mime'] : '';
		$extension = MetadataPolicy::extensionForMime($mime);
		$license = is_string($record['license'] ?? null) ? $record['license'] : '';
		$licenseUrl = is_string($record['licenseUrl'] ?? null) ? $record['licenseUrl'] : '';
		$sourceUrl = is_string($record['sourceUrl'] ?? null) ? $record['sourceUrl'] : '';
		$author = is_string($record['author'] ?? null) ? $record['author'] : '';
		$hash = is_string($record['sha256'] ?? null) ? $record['sha256'] : '';

		return preg_match('/^[a-f0-9]{32}$/D', $id) === 1
			&& $metadataName === $id . '.json'
			&& $extension !== null
			&& $file === $id . '.' . $extension
			&& preg_match('/^[a-f0-9]{64}$/D', $hash) === 1
			&& str_starts_with($hash, $id)
			&& MetadataPolicy::licenseUrl($license) === $licenseUrl
			&& MetadataPolicy::isSourceUrl($sourceUrl)
			&& MetadataPolicy::cleanText($record['title']) === $record['title']
			&& $record['title'] !== ''
			&& MetadataPolicy::cleanText($record['description']) === $record['description']
			&& MetadataPolicy::cleanText($author, 160) === $author
			&& $author !== ''
			&& MetadataPolicy::isLandscape((int)($record['width'] ?? 0), (int)($record['height'] ?? 0))
			&& (int)($record['fetchedAt'] ?? 0) > 0;
	}
}

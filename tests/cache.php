<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

use OCA\BackgroundChanger\Service\CacheService;
use OCA\BackgroundChanger\Service\ThemeService;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

if (!interface_exists(IAppData::class)) {
	throw new RuntimeException('Load the Nextcloud bootstrap before this test');
}

if (!class_exists(\OCA\BackgroundChanger\Service\MetadataPolicy::class, false)) {
	require_once __DIR__ . '/../lib/Service/MetadataPolicy.php';
}
if (!class_exists(CacheService::class, false)) {
	require_once __DIR__ . '/../lib/Service/CacheService.php';
}
if (!class_exists(ThemeService::class, false)) {
	require_once __DIR__ . '/../lib/Service/ThemeService.php';
}

final class MemoryFile implements ISimpleFile {
	private int $mtime;

	public function __construct(
		private MemoryFolder $folder,
		private string $name,
		private string $content,
	) {
		$this->mtime = time();
	}

	public function getName(): string {
		return $this->name;
	}

	public function getSize(): int|float {
		return strlen($this->content);
	}

	public function getETag(): string {
		return md5($this->content);
	}

	public function getMTime(): int {
		return $this->mtime;
	}

	public function getContent(): string {
		return $this->content;
	}

	public function putContent($data): void {
		$this->content = MemoryFolder::content($data);
		$this->mtime = time();
	}

	public function delete(): void {
		$this->folder->remove($this->name);
	}

	public function getMimeType(): string {
		return 'application/octet-stream';
	}

	public function getExtension(): string {
		return pathinfo($this->name, PATHINFO_EXTENSION);
	}

	public function read() {
		$stream = fopen('php://temp', 'w+b');
		if ($stream === false) {
			return false;
		}
		fwrite($stream, $this->content);
		rewind($stream);
		return $stream;
	}

	public function write() {
		return false;
	}
}

final class MemoryFolder implements ISimpleFolder {
	/** @var array<string, MemoryFile> */
	private array $files = [];
	/** @var array<string, MemoryFolder> */
	private array $folders = [];

	public function __construct(private string $name) {
	}

	public function getDirectoryListing(): array {
		return array_values($this->files);
	}

	public function fileExists(string $name): bool {
		return isset($this->files[$name]);
	}

	public function getFile(string $name): ISimpleFile {
		return $this->files[$name] ?? throw new NotFoundException();
	}

	public function newFile(string $name, $content = null): ISimpleFile {
		$file = new MemoryFile($this, $name, self::content($content));
		$this->files[$name] = $file;
		return $file;
	}

	public function delete(): void {
		$this->files = [];
		$this->folders = [];
	}

	public function getName(): string {
		return $this->name;
	}

	public function getFolder(string $name): ISimpleFolder {
		return $this->folders[$name] ?? throw new NotFoundException();
	}

	public function newFolder(string $path): ISimpleFolder {
		$folder = new self($path);
		$this->folders[$path] = $folder;
		return $folder;
	}

	public function getOrCreateFolder(string $path, int $maxRetries = 5): ISimpleFolder {
		return $this->folders[$path] ?? $this->newFolder($path);
	}

	public function remove(string $name): void {
		unset($this->files[$name]);
	}

	public static function content(mixed $content): string {
		if (is_resource($content)) {
			$value = stream_get_contents($content);
			return is_string($value) ? $value : '';
		}
		return is_string($content) ? $content : '';
	}
}

final class MemoryAppData implements IAppData {
	/** @var array<string, MemoryFolder> */
	private array $folders = [];

	public function getFolder(string $name): ISimpleFolder {
		return $this->folders[$name] ?? throw new NotFoundException();
	}

	public function getDirectoryListing(): array {
		return array_values($this->folders);
	}

	public function newFolder(string $name): ISimpleFolder {
		$folder = new MemoryFolder($name);
		$this->folders[$name] = $folder;
		return $folder;
	}
}

$checks = 0;

function checkCache(bool $condition, string $message): void {
	global $checks;
	$checks++;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

/** @return array<string, int|string> */
function downloadFixture(int $number): array {
	return [
		'body' => str_repeat(chr(64 + $number), 40_000),
		'mime' => 'image/jpeg',
		'width' => 2560,
		'height' => 1440,
		'fetchedAt' => 1_700_000_000 + $number,
		'title' => 'File:Landscape ' . $number . '.jpg',
		'description' => 'Landscape ' . $number,
		'author' => 'Author ' . $number,
		'license' => 'CC BY-SA 4.0',
		'licenseUrl' => 'https://creativecommons.org/licenses/by-sa/4.0/',
		'sourceUrl' => 'https://commons.wikimedia.org/wiki/File:Landscape_' . $number . '.jpg',
	];
}

$folder = new MemoryFolder('contract');
$child = $folder->getOrCreateFolder('child');
checkCache($child === $folder->getFolder('child'), 'Folder is created when absent');
checkCache($child === $folder->getOrCreateFolder('child'), 'Existing folder is reused');

$root = new MemoryAppData();
$cache = new CacheService($root);
checkCache($cache->count('landscapes') === 0, 'Empty landscape cache');
checkCache($cache->store('landscapes', downloadFixture(1)), 'First landscape is stored');
checkCache(!$cache->store('landscapes', downloadFixture(1)), 'Content-addressed duplicate is ignored per theme');
checkCache($cache->store('animals', downloadFixture(1)), 'Identical content can be stored in another theme cache');
checkCache($cache->count('landscapes') === 1, 'One valid landscape record');
checkCache($cache->count('animals') === 1, 'One valid animal record');
$first = $cache->select('landscapes');
checkCache($first !== null, 'Stored image is selectable');
checkCache($first['theme'] === 'landscapes', 'Stored metadata is bound to its theme');
checkCache($first['author'] === 'Author 1', 'Attribution survives storage');
checkCache($cache->image('landscapes', (string)$first['id']) !== null, 'Stored image is served locally');
checkCache($cache->image('animals', (string)$first['id']) !== null, 'Other theme serves its own local copy');
checkCache($cache->image('../space', (string)$first['id']) === null, 'Invalid image theme is rejected');
checkCache($cache->image('landscapes', '../config') === null, 'Invalid image identifier is rejected');

for ($number = 2; $number <= 10; $number++) {
	checkCache($cache->store('landscapes', downloadFixture($number)), 'Unique image ' . $number . ' is stored');
}
$cache->prune('landscapes', 8);
$records = $cache->listBackgrounds('landscapes');
checkCache(count($records) === 8, 'Cache pruning keeps the configured maximum');
checkCache($records[0]['title'] === 'File:Landscape 10.jpg', 'Newest image remains first');
checkCache($cache->select('landscapes', (string)$records[0]['id'])['id'] !== $records[0]['id'], 'Previous image is excluded');

$invalid = downloadFixture(11);
$invalid['author'] = '<script>bad</script>';
try {
	$cache->store('landscapes', $invalid);
	checkCache(false, 'Unsafe metadata must throw');
} catch (InvalidArgumentException $e) {
	checkCache($cache->count('landscapes') === 8, 'Unsafe metadata has no visible cache entry');
}

try {
	$cache->store('invalid', downloadFixture(12));
	checkCache(false, 'Unknown themes must throw');
} catch (InvalidArgumentException $e) {
	checkCache($cache->totalCount() === 9, 'Unknown theme creates no cache entry');
}

fwrite(STDOUT, sprintf("%d cache checks passed.\n", $checks));

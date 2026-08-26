<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

$root = $argv[1] ?? '';
if (!preg_match('#^/var/nextcloud-data/appdata_[a-z0-9]+/backgroundchanger/backgrounds$#D', $root)
	|| !is_dir($root)) {
	throw new RuntimeException('Pass the isolated Background Changer AppData cache root');
}

$themes = ['landscapes', 'animals', 'space', 'architecture'];
$extensions = [
	'image/jpeg' => 'jpg',
	'image/png' => 'png',
	'image/webp' => 'webp',
];
$licenses = [
	'CC BY 1.0' => 'https://creativecommons.org/licenses/by/1.0/',
	'CC BY 2.0' => 'https://creativecommons.org/licenses/by/2.0/',
	'CC BY 2.5' => 'https://creativecommons.org/licenses/by/2.5/',
	'CC BY 3.0' => 'https://creativecommons.org/licenses/by/3.0/',
	'CC BY 4.0' => 'https://creativecommons.org/licenses/by/4.0/',
	'CC BY-SA 1.0' => 'https://creativecommons.org/licenses/by-sa/1.0/',
	'CC BY-SA 2.0' => 'https://creativecommons.org/licenses/by-sa/2.0/',
	'CC BY-SA 2.5' => 'https://creativecommons.org/licenses/by-sa/2.5/',
	'CC BY-SA 3.0' => 'https://creativecommons.org/licenses/by-sa/3.0/',
	'CC BY-SA 4.0' => 'https://creativecommons.org/licenses/by-sa/4.0/',
	'CC0 1.0' => 'https://creativecommons.org/publicdomain/zero/1.0/',
	'Public domain' => 'https://creativecommons.org/publicdomain/mark/1.0/',
];

$checks = 0;
$total = 0;

function checkAppData(bool $condition, string $message): void {
	global $checks;
	$checks++;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

foreach ($themes as $theme) {
	$themeRoot = $root . '/' . $theme;
	checkAppData(is_dir($themeRoot), 'Missing cache directory for ' . $theme);
	$metadataFiles = glob($themeRoot . '/*.json') ?: [];
	$imageFiles = array_merge(
		glob($themeRoot . '/*.jpg') ?: [],
		glob($themeRoot . '/*.png') ?: [],
		glob($themeRoot . '/*.webp') ?: [],
	);
	checkAppData(count($metadataFiles) >= 3 && count($metadataFiles) <= 6, 'Invalid cache size for ' . $theme);
	checkAppData(count($imageFiles) === count($metadataFiles), 'Orphan or missing cache image for ' . $theme);

	$sources = [];
	foreach ($metadataFiles as $metadataFile) {
		checkAppData(filesize($metadataFile) <= 32_000, 'Oversized metadata record');
		$record = json_decode((string)file_get_contents($metadataFile), true, 16, JSON_THROW_ON_ERROR);
		checkAppData(is_array($record), 'Metadata record is not an object');

		$id = is_string($record['id'] ?? null) ? $record['id'] : '';
		$hash = is_string($record['sha256'] ?? null) ? $record['sha256'] : '';
		$mime = is_string($record['mime'] ?? null) ? $record['mime'] : '';
		$extension = $extensions[$mime] ?? '';
		$imageName = is_string($record['file'] ?? null) ? $record['file'] : '';
		$imagePath = $themeRoot . '/' . $imageName;
		$width = is_int($record['width'] ?? null) ? $record['width'] : 0;
		$height = is_int($record['height'] ?? null) ? $record['height'] : 0;
		$ratio = $height > 0 ? $width / $height : 0.0;
		$source = is_string($record['sourceUrl'] ?? null) ? $record['sourceUrl'] : '';
		$license = is_string($record['license'] ?? null) ? $record['license'] : '';
		$author = is_string($record['author'] ?? null) ? $record['author'] : '';

		checkAppData(($record['theme'] ?? null) === $theme, 'Cross-theme metadata record');
		checkAppData(preg_match('/^[a-f0-9]{32}$/D', $id) === 1, 'Invalid cache identifier');
		checkAppData(preg_match('/^[a-f0-9]{64}$/D', $hash) === 1 && str_starts_with($hash, $id), 'Invalid content hash');
		checkAppData($extension !== '' && $imageName === $id . '.' . $extension, 'Invalid cache filename');
		checkAppData(basename($metadataFile) === $id . '.json', 'Metadata filename mismatch');
		checkAppData(is_file($imagePath), 'Cached image is missing');
		checkAppData(filesize($imagePath) >= 32_000 && filesize($imagePath) <= 12_000_000, 'Cached image size is invalid');
		checkAppData(hash_equals($hash, (string)hash_file('sha256', $imagePath)), 'Cached image hash mismatch');

		$imageInfo = getimagesize($imagePath);
		checkAppData(is_array($imageInfo) && ($imageInfo['mime'] ?? '') === $mime, 'Cached image MIME mismatch');
		checkAppData(($imageInfo[0] ?? 0) === $width && ($imageInfo[1] ?? 0) === $height, 'Cached image dimensions mismatch');
		checkAppData($width >= 1600 && $height >= 720 && $width <= 3000 && $height <= 2400
			&& $width * $height <= 8_000_000 && $ratio >= 1.25 && $ratio <= 2.60, 'Cached image is not an accepted landscape');

		$sourceParts = parse_url($source);
		checkAppData(is_array($sourceParts)
			&& ($sourceParts['scheme'] ?? '') === 'https'
			&& ($sourceParts['host'] ?? '') === 'commons.wikimedia.org'
			&& str_starts_with($sourceParts['path'] ?? '', '/wiki/File:')
			&& !isset($sourceParts['user'], $sourceParts['pass'], $sourceParts['fragment']), 'Invalid Commons attribution source');
		checkAppData(($licenses[$license] ?? null) === ($record['licenseUrl'] ?? null), 'Invalid license attribution');
		checkAppData($author !== '' && $author === strip_tags($author), 'Invalid author attribution');
		checkAppData(!isset($sources[$source]), 'Duplicate source within one theme cache');
		$sources[$source] = true;
		$total++;
	}
	printf("%s: %d validated cached images\n", $theme, count($metadataFiles));
}

printf("%d AppData checks passed for %d cached images.\n", $checks, $total);

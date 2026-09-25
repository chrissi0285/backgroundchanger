<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Service;

final class MetadataPolicy {
	public const MAX_TEXT_LENGTH = 300;
	public const REQUEST_WIDTH = 1920;
	public const MIN_WIDTH = 1600;
	public const MIN_HEIGHT = 720;
	public const MAX_WIDTH = 3000;
	public const MAX_HEIGHT = 2400;
	public const MAX_PIXELS = 8_000_000;
	public const MIN_RATIO = 1.25;
	public const MAX_RATIO = 2.60;

	/** @var array<string, string> */
	private const LICENSE_URLS = [
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

	/** @var array<string, string> */
	private const MIME_EXTENSIONS = [
		'image/jpeg' => 'jpg',
		'image/png' => 'png',
		'image/webp' => 'webp',
	];

	public static function cleanText(mixed $value, int $maxLength = self::MAX_TEXT_LENGTH): string {
		if (!is_string($value)) {
			return '';
		}

		$text = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
		$text = preg_replace('/[\x{0000}-\x{001F}\x{007F}]+/u', ' ', $text) ?? '';
		$text = preg_replace('/\s+/u', ' ', $text) ?? '';
		$text = trim($text);

		if (function_exists('mb_substr')) {
			return mb_substr($text, 0, $maxLength, 'UTF-8');
		}
		return substr($text, 0, $maxLength);
	}

	public static function extensionForMime(string $mime): ?string {
		return self::MIME_EXTENSIONS[strtolower(trim($mime))] ?? null;
	}

	public static function licenseUrl(string $license): ?string {
		return self::LICENSE_URLS[trim($license)] ?? null;
	}

	public static function isImageUrl(string $url): bool {
		return self::isHttpsUrlForHost($url, 'upload.wikimedia.org', '/wikipedia/commons/')
			|| self::isHttpsUrlForHost($url, 'thumb.wikimedia.org', '/wikipedia/commons/thumb/');
	}

	public static function isSourceUrl(string $url): bool {
		return self::isHttpsUrlForHost($url, 'commons.wikimedia.org', '/wiki/File:');
	}

	public static function isLandscape(int $width, int $height): bool {
		if ($width < self::MIN_WIDTH
			|| $height < self::MIN_HEIGHT
			|| $width > self::MAX_WIDTH
			|| $height > self::MAX_HEIGHT
			|| $width * $height > self::MAX_PIXELS) {
			return false;
		}
		$ratio = $width / $height;
		return $ratio >= self::MIN_RATIO && $ratio <= self::MAX_RATIO;
	}

	/**
	 * Convert one MediaWiki query page into strictly validated plain metadata.
	 *
	 * @return array<string, int|string>|null
	 */
	public static function candidateFromPage(array $page): ?array {
		$title = self::cleanText($page['title'] ?? '');
		$info = $page['imageinfo'][0] ?? null;
		if ($title === '' || !is_array($info)) {
			return null;
		}

		$mime = is_string($info['mime'] ?? null) ? strtolower($info['mime']) : '';
		if (self::extensionForMime($mime) === null) {
			return null;
		}

		$imageUrl = is_string($info['thumburl'] ?? null) ? $info['thumburl'] : '';
		$sourceUrl = is_string($info['descriptionurl'] ?? null) ? $info['descriptionurl'] : '';
		$width = filter_var($info['thumbwidth'] ?? 0, FILTER_VALIDATE_INT) ?: 0;
		$height = filter_var($info['thumbheight'] ?? 0, FILTER_VALIDATE_INT) ?: 0;
		if (!self::isImageUrl($imageUrl)
			|| !self::isSourceUrl($sourceUrl)
			|| !self::isLandscape($width, $height)) {
			return null;
		}

		$metadata = is_array($info['extmetadata'] ?? null) ? $info['extmetadata'] : [];
		$license = self::cleanText(self::metadataValue($metadata, 'LicenseShortName'), 50);
		$licenseUrl = self::licenseUrl($license);
		$author = self::cleanText(self::metadataValue($metadata, 'Artist'), 160);
		$restrictions = self::cleanText(self::metadataValue($metadata, 'Restrictions'), 160);
		if ($licenseUrl === null || $author === '' || $restrictions !== '') {
			return null;
		}

		return [
			'title' => $title,
			'description' => self::cleanText(self::metadataValue($metadata, 'ImageDescription')),
			'author' => $author,
			'license' => $license,
			'licenseUrl' => $licenseUrl,
			'sourceUrl' => $sourceUrl,
			'imageUrl' => $imageUrl,
			'mime' => $mime,
			'width' => $width,
			'height' => $height,
		];
	}

	private static function metadataValue(array $metadata, string $key): mixed {
		$value = $metadata[$key] ?? null;
		return is_array($value) ? ($value['value'] ?? null) : null;
	}

	private static function isHttpsUrlForHost(string $url, string $host, string $pathPrefix): bool {
		$parts = parse_url($url);
		if (!is_array($parts)
			|| ($parts['scheme'] ?? '') !== 'https'
			|| ($parts['host'] ?? '') !== $host
			|| isset($parts['user'])
			|| isset($parts['pass'])
			|| (isset($parts['port']) && $parts['port'] !== 443)
			|| isset($parts['fragment'])) {
			return false;
		}

		return str_starts_with($parts['path'] ?? '', $pathPrefix);
	}
}

<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\Service;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;

final class CommonsService {
	private const API_URL = 'https://commons.wikimedia.org/w/api.php';
	private const USER_AGENT = 'BackgroundChanger/1.0 (+https://github.com/chrissi0285/backgroundchanger)';
	private const MAX_API_BYTES = 1_000_000;
	private const MAX_IMAGE_BYTES = 12_000_000;
	private const MIN_IMAGE_BYTES = 32_000;

	private IClient $client;

	public function __construct(
		IClientService $clientService,
		private ITimeFactory $time,
	) {
		$this->client = $clientService->newClient();
	}

	/** @return list<array<string, int|string>> */
	public function discover(string $theme, int $limit = 24): array {
		$categories = ThemeService::categoriesFor($theme);
		if ($categories === []) {
			throw new \InvalidArgumentException('Invalid background theme');
		}
		$category = $categories[random_int(0, count($categories) - 1)];
		$limit = max(1, min(50, $limit));
		$query = [
			'action' => 'query',
			'format' => 'json',
			'formatversion' => 2,
			'generator' => 'categorymembers',
			'gcmtitle' => $category,
			'gcmnamespace' => 6,
			'gcmtype' => 'file',
			'gcmlimit' => $limit,
			'prop' => 'imageinfo',
			'iiprop' => 'url|mime|size|extmetadata',
			'iiurlwidth' => MetadataPolicy::REQUEST_WIDTH,
			'iiextmetadatalanguage' => 'en',
			'iiextmetadatafilter' => 'Artist|ImageDescription|LicenseShortName|Restrictions',
			'maxlag' => 5,
			'maxage' => 3600,
			'smaxage' => 3600,
		];
		if ($theme === ThemeService::LANDSCAPES) {
			$query['gcmstartsortkeyprefix'] = chr(random_int(ord('A'), ord('Z')));
		}
		$response = $this->client->get(self::API_URL, [
			'query' => $query,
			'headers' => $this->headers('application/json'),
			'timeout' => 20,
			'allow_redirects' => false,
			'stream' => true,
		]);

		if ($response->getStatusCode() !== 200) {
			throw new \RuntimeException('Commons API returned HTTP ' . $response->getStatusCode());
		}
		$body = $this->readLimitedBody($response, self::MAX_API_BYTES, 'Commons API');

		try {
			$data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
		} catch (\JsonException $e) {
			throw new \RuntimeException('Commons API returned invalid JSON', 0, $e);
		}
		if (!is_array($data) || isset($data['error'])) {
			throw new \RuntimeException('Commons API returned an error');
		}

		$candidates = [];
		$pages = $data['query']['pages'] ?? [];
		if (is_array($pages)) {
			foreach ($pages as $page) {
				if (!is_array($page)) {
					continue;
				}
				$candidate = MetadataPolicy::candidateFromPage($page);
				if ($candidate !== null) {
					$candidates[] = $candidate;
				}
			}
		}
		shuffle($candidates);
		return $candidates;
	}

	/**
	 * @param array<string, int|string> $candidate
	 * @return array<string, int|string>
	 */
	public function download(array $candidate): array {
		$imageUrl = is_string($candidate['imageUrl'] ?? null) ? $candidate['imageUrl'] : '';
		$candidateMime = is_string($candidate['mime'] ?? null) ? $candidate['mime'] : '';
		if (!MetadataPolicy::isImageUrl($imageUrl)
			|| MetadataPolicy::extensionForMime($candidateMime) === null) {
			throw new \RuntimeException('Rejected image host');
		}

		$response = $this->client->get($imageUrl, [
			// Do not invite Commons content negotiation to return a different
			// format than the metadata record we already validated.
			'headers' => $this->headers($candidateMime),
			'timeout' => 30,
			'allow_redirects' => false,
			'stream' => true,
		]);
		if ($response->getStatusCode() !== 200) {
			throw new \RuntimeException('Commons image returned HTTP ' . $response->getStatusCode());
		}

		$body = $this->readLimitedBody($response, self::MAX_IMAGE_BYTES, 'Commons image');
		if (strlen($body) < self::MIN_IMAGE_BYTES) {
			throw new \RuntimeException('Commons image has an invalid size');
		}

		$imageInfo = @getimagesizefromstring($body);
		if (!is_array($imageInfo)) {
			throw new \RuntimeException('Commons response is not a valid image');
		}
		$mime = strtolower((string)($imageInfo['mime'] ?? ''));
		$extension = MetadataPolicy::extensionForMime($mime);
		if ($extension === null || $mime !== $candidateMime) {
			throw new \RuntimeException('Commons image type was rejected');
		}
		if (!MetadataPolicy::isLandscape((int)$imageInfo[0], (int)$imageInfo[1])) {
			throw new \RuntimeException('Commons image dimensions were rejected');
		}

		$candidate['body'] = $body;
		$candidate['mime'] = $mime;
		$candidate['extension'] = $extension;
		$candidate['width'] = (int)$imageInfo[0];
		$candidate['height'] = (int)$imageInfo[1];
		$candidate['fetchedAt'] = $this->time->getTime();
		return $candidate;
	}

	/** @return array<string, string> */
	private function headers(string $accept): array {
		return [
			'Accept' => $accept,
			'Accept-Encoding' => 'gzip',
			'User-Agent' => self::USER_AGENT,
		];
	}

	private function readLimitedBody(IResponse $response, int $maximumBytes, string $label): string {
		$contentLength = $response->getHeader('content-length');
		if ($contentLength !== '' && ctype_digit($contentLength)
			&& (int)$contentLength > $maximumBytes) {
			throw new \RuntimeException($label . ' exceeds the size limit');
		}

		$body = $response->getBody();
		if (is_string($body)) {
			if (strlen($body) > $maximumBytes) {
				throw new \RuntimeException($label . ' exceeds the size limit');
			}
			return $body;
		}
		if (!is_resource($body)) {
			throw new \RuntimeException($label . ' returned an invalid body');
		}

		try {
			$content = stream_get_contents($body, $maximumBytes + 1);
		} finally {
			fclose($body);
		}
		if (!is_string($content) || strlen($content) > $maximumBytes) {
			throw new \RuntimeException($label . ' exceeds the size limit');
		}
		return $content;
	}
}

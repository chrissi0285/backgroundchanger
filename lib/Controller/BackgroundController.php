<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Wechselbild\Controller;

use OCA\Wechselbild\AppInfo\Application;
use OCA\Wechselbild\Service\CacheService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\NoTwoFactorRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\FileDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IURLGenerator;

final class BackgroundController extends Controller {
	public function __construct(
		IRequest $request,
		private CacheService $cache,
		private IURLGenerator $urlGenerator,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[NoTwoFactorRequired]
	public function select(mixed $exclude = ''): JSONResponse {
		$excludedId = is_string($exclude) ? $exclude : '';
		$background = $this->cache->select($excludedId);
		if ($background === null) {
			$response = new JSONResponse(['background' => null]);
			$response->cacheFor(0);
			return $response;
		}

		$response = new JSONResponse([
			'background' => [
				'id' => $background['id'],
				'image' => $this->urlGenerator->linkToRouteAbsolute(
					Application::APP_ID . '.background.image',
					['id' => $background['id']],
				),
				'title' => $background['title'],
				'author' => $background['author'],
				'license' => $background['license'],
				'licenseUrl' => $background['licenseUrl'],
				'sourceUrl' => $background['sourceUrl'],
				'description' => $background['description'],
			],
		]);
		$response->cacheFor(0);
		$response->addHeader('Referrer-Policy', 'no-referrer');
		return $response;
	}

	#[PublicPage]
	#[NoCSRFRequired]
	#[NoTwoFactorRequired]
	public function image(string $id): Response {
		$image = $this->cache->image($id);
		if ($image === null) {
			$response = new DataDisplayResponse('', Http::STATUS_NOT_FOUND, [
				'Content-Type' => 'text/plain; charset=utf-8',
			]);
			$response->cacheFor(0);
			return $response;
		}

		[$file, $mime] = $image;
		$response = new FileDisplayResponse($file, Http::STATUS_OK, [
			'Content-Type' => $mime,
			'Cross-Origin-Resource-Policy' => 'same-origin',
			'X-Content-Type-Options' => 'nosniff',
		]);
		$response->cacheFor(604800, true, true);
		return $response;
	}
}

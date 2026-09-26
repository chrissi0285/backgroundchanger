<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

require_once __DIR__ . '/../lib/Service/MetadataPolicy.php';
require_once __DIR__ . '/../lib/Service/ThemeService.php';

use OCA\BackgroundChanger\Service\MetadataPolicy;
use OCA\BackgroundChanger\Service\ThemeService;

$tests = 0;

function expect(bool $condition, string $message): void {
	global $tests;
	$tests++;
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

function validPage(): array {
	return [
		'title' => 'File:Alpine lake.jpg',
		'imageinfo' => [[
			'mime' => 'image/jpeg',
			'thumburl' => 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Alpine_lake.jpg/2560px-Alpine_lake.jpg',
			'thumbwidth' => 2560,
			'thumbheight' => 1440,
			'descriptionurl' => 'https://commons.wikimedia.org/wiki/File:Alpine_lake.jpg',
			'extmetadata' => [
				'Artist' => ['value' => '<a href="/wiki/User:Alice">Alice &amp; Bob</a>'],
				'ImageDescription' => ['value' => '<b>Lake</b> under a blue sky'],
				'LicenseShortName' => ['value' => 'CC BY-SA 4.0'],
				'Restrictions' => ['value' => ''],
			],
		]],
	];
}

expect(MetadataPolicy::cleanText('<script>alert(1)</script> A&nbsp;B') === 'alert(1) A B', 'HTML must become plain text');
expect(MetadataPolicy::extensionForMime('image/jpeg') === 'jpg', 'JPEG extension');
expect(MetadataPolicy::REQUEST_WIDTH === 1920, 'Resource-saving Commons thumbnail width');
expect(MetadataPolicy::extensionForMime('text/html') === null, 'HTML must be rejected');
expect(MetadataPolicy::licenseUrl('CC BY-SA 4.0') === 'https://creativecommons.org/licenses/by-sa/4.0/', 'Known license URL');
expect(MetadataPolicy::licenseUrl('All rights reserved') === null, 'Non-free license must be rejected');
expect(MetadataPolicy::isImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/a.jpg'), 'Official image host');
expect(MetadataPolicy::isImageUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Alpine_lake.jpg/1920px-Alpine_lake.jpg'), 'Official Commons thumbnail host');
expect(!MetadataPolicy::isImageUrl('https://thumb.wikimedia.org.evil.example/wikipedia/commons/thumb/a.jpg'), 'Thumbnail suffix host attack');
expect(!MetadataPolicy::isImageUrl('http://thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg'), 'Thumbnail plain HTTP');
expect(!MetadataPolicy::isImageUrl('https://user@thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg'), 'Thumbnail credentials in URL');
expect(!MetadataPolicy::isImageUrl('https://thumb.wikimedia.org:444/wikipedia/commons/thumb/a.jpg'), 'Thumbnail foreign port');
expect(!MetadataPolicy::isImageUrl('https://thumb.wikimedia.org/wikipedia/en/thumb/a.jpg'), 'Thumbnail must belong to Commons');
expect(!MetadataPolicy::isImageUrl('https://thumb.wikimedia.org/wikipedia/commons/a.jpg'), 'Thumbnail host only serves thumbnail paths');
expect(!MetadataPolicy::isImageUrl('https://upload.wikimedia.org.evil.example/wikipedia/commons/a.jpg'), 'Suffix host attack');
expect(!MetadataPolicy::isImageUrl('http://upload.wikimedia.org/wikipedia/commons/a.jpg'), 'Plain HTTP');
expect(!MetadataPolicy::isImageUrl('https://user@upload.wikimedia.org/wikipedia/commons/a.jpg'), 'Credentials in URL');
expect(!MetadataPolicy::isImageUrl('https://upload.wikimedia.org:444/wikipedia/commons/a.jpg'), 'Foreign port');
expect(MetadataPolicy::isSourceUrl('https://commons.wikimedia.org/wiki/File:Alpine_lake.jpg'), 'Official source URL');
expect(!MetadataPolicy::isSourceUrl('https://commons.wikimedia.org/wiki/User:Alice'), 'Only file source pages');
expect(!MetadataPolicy::isSourceUrl('https://commons.wikimedia.org/w/index.php?title=File:Alpine_lake.jpg'), 'Only canonical file source URLs');
expect(MetadataPolicy::isLandscape(2560, 1440), 'Landscape dimensions');
expect(MetadataPolicy::isLandscape(2560, 2048), 'Maximum useful thumbnail height');
expect(!MetadataPolicy::isLandscape(1440, 2560), 'Portrait must be rejected');
expect(!MetadataPolicy::isLandscape(1000, 800), 'Small image must be rejected');
expect(!MetadataPolicy::isLandscape(4000, 1600), 'Oversized image must be rejected');

$candidate = MetadataPolicy::candidateFromPage(validPage());
expect($candidate !== null, 'Valid Commons page');
expect($candidate['title'] === 'File:Alpine lake.jpg', 'Title sanitization');
expect($candidate['author'] === 'Alice & Bob', 'Author sanitization');
expect($candidate['description'] === 'Lake under a blue sky', 'Description sanitization');
expect($candidate['licenseUrl'] === 'https://creativecommons.org/licenses/by-sa/4.0/', 'Canonical license link');
$thumbnailPage = validPage();
$thumbnailPage['imageinfo'][0]['thumburl'] = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Alpine_lake.jpg/1920px-Alpine_lake.jpg';
expect(MetadataPolicy::candidateFromPage($thumbnailPage) !== null, 'Commons thumbnail endpoint metadata must remain usable');

$invalidHost = validPage();
$invalidHost['imageinfo'][0]['thumburl'] = 'https://example.org/wikipedia/commons/image.jpg';
expect(MetadataPolicy::candidateFromPage($invalidHost) === null, 'Foreign image host');

$invalidLicense = validPage();
$invalidLicense['imageinfo'][0]['extmetadata']['LicenseShortName']['value'] = 'GFDL';
expect(MetadataPolicy::candidateFromPage($invalidLicense) === null, 'License allow-list');

$restricted = validPage();
$restricted['imageinfo'][0]['extmetadata']['Restrictions']['value'] = 'personality rights';
expect(MetadataPolicy::candidateFromPage($restricted) === null, 'Restricted image');

$missingAuthor = validPage();
$missingAuthor['imageinfo'][0]['extmetadata']['Artist']['value'] = '';
expect(MetadataPolicy::candidateFromPage($missingAuthor) === null, 'Missing attribution');

$portrait = validPage();
$portrait['imageinfo'][0]['thumbwidth'] = 1000;
$portrait['imageinfo'][0]['thumbheight'] = 1800;
expect(MetadataPolicy::candidateFromPage($portrait) === null, 'Portrait candidate');

$wrongMime = validPage();
$wrongMime['imageinfo'][0]['mime'] = 'image/svg+xml';
expect(MetadataPolicy::candidateFromPage($wrongMime) === null, 'SVG must not enter the image cache');

$info = new DOMDocument();
expect($info->load(__DIR__ . '/../appinfo/info.xml'), 'info.xml must parse');
$xpath = new DOMXPath($info);
expect($xpath->evaluate('string(/info/id)') === 'backgroundchanger', 'Independent app identifier');
expect($xpath->evaluate('string(/info/name)') === 'ImageChanger', 'International app name');
expect($xpath->evaluate('string(/info/namespace)') === 'BackgroundChanger', 'Independent namespace');
expect($xpath->evaluate('string(/info/author)') === 'chrissi0285', 'Public author identity');
expect($xpath->evaluate('string(/info/version)') === '1.0.2', 'NC35 settings robustness release');
expect($xpath->evaluate('string(/info/repository)') === 'https://github.com/chrissi0285/backgroundchanger.git', 'Repository identity');
expect($xpath->evaluate('string(/info/dependencies/nextcloud/@min-version)') === '34', 'Nextcloud minimum');
expect($xpath->evaluate('string(/info/dependencies/nextcloud/@max-version)') === '35', 'Nextcloud maximum');
expect(!file_exists(__DIR__ . '/../appinfo/signature.json'), 'No foreign signature may be bundled');

expect(ThemeService::cacheThemes() === ['landscapes', 'animals', 'space', 'architecture'], 'Curated cache themes');
expect(ThemeService::normalizePreference('default') === 'default', 'Default preference');
expect(ThemeService::normalizePreference('off') === 'off', 'Off preference');
expect(ThemeService::normalizePreference('animals') === 'animals', 'Animal preference');
expect(ThemeService::normalizePreference('invalid') === 'default', 'Invalid preference fails safely');
expect(ThemeService::effectiveTheme('default') === 'landscapes', 'Default resolves to anonymous-safe landscapes');
expect(ThemeService::effectiveTheme('off') === null, 'Off suppresses backgrounds');
expect(ThemeService::isCacheTheme('space'), 'Space is a cache theme');
expect(!ThemeService::isCacheTheme('../space'), 'Cache theme rejects paths');

$categories = ThemeService::commonsCategories();
foreach (ThemeService::cacheThemes() as $theme) {
	expect(isset($categories[$theme]) && $categories[$theme] !== [], 'Commons categories exist for ' . $theme);
	foreach ($categories[$theme] as $category) {
		expect(str_starts_with($category, 'Category:Featured pictures of '), 'Curated Commons category for ' . $theme);
	}
}

$svg = file_get_contents(__DIR__ . '/../img/app.svg');
expect(is_string($svg) && str_contains($svg, '867c66e8d84bc2ee279fa2a85a6a4659160db9091c6a18ae01566aa7de2a3e99'), 'Central symbol provenance');
$script = file_get_contents(__DIR__ . '/../js/background.js');
expect(is_string($script) && str_contains($script, 'designed by chrissi0285'), 'Exact visible design line');
expect(is_string($script)
	&& str_contains($script, "document.addEventListener('click'")
	&& str_contains($script, "[role=\"link\"], [role=\"tab\"]")
	&& str_contains($script, '.app-navigation-entry-link')
	&& str_contains($script, '(!anchor || event.defaultPrevented) && routeRevision === revision')
	&& str_contains($script, "window.navigation?.addEventListener('currententrychange'")
	&& str_contains($script, 'window.location.href !== observedHref')
	&& str_contains($script, "window.addEventListener('popstate', routeChanged)")
	&& str_contains($script, "window.addEventListener('hashchange', routeChanged)"),
	'Links, semantic non-link routers and browser history share the rotation lifecycle');
$settingsScript = file_get_contents(__DIR__ . '/../js/settings.js');
expect(is_string($settingsScript)
	&& str_contains($settingsScript, "/apps/backgroundchanger/api/theme")
	&& str_contains($settingsScript, 'requesttoken: window.OC.requestToken')
	&& str_contains($settingsScript, "target.closest('.checkbox-radio-switch')?.querySelector('input[type=\"radio\"]')")
	&& !str_contains($settingsScript, '/settings/api/declarative/value'),
	'NC34 visible radio clicks use only the CSRF-protected app-owned route');
$settingsController = file_get_contents(__DIR__ . '/../lib/Controller/SettingsController.php');
expect(is_string($settingsController)
	&& str_contains($settingsController, '#[NoAdminRequired]')
	&& str_contains($settingsController, '@NoAdminRequired')
	&& !str_contains($settingsController, 'NoCSRFRequired'),
	'App-owned theme writes retain login, admin-compatibility and CSRF protection');
$routes = require __DIR__ . '/../appinfo/routes.php';
$themeRoutes = array_values(array_filter(
	$routes['routes'] ?? [],
	static fn (array $route): bool => ($route['name'] ?? '') === 'settings#setTheme',
));
expect($themeRoutes === [[
	'name' => 'settings#setTheme',
	'url' => '/api/theme',
	'verb' => 'POST',
]], 'Exactly one POST-only app-owned theme route');
$refresh = file_get_contents(__DIR__ . '/../lib/Service/RefreshService.php');
expect(is_string($refresh)
	&& str_contains($refresh, "logger->debug('ImageChanger rejected a Commons candidate"),
	'Expected provider candidate rejections stay below the Nextcloud warning level');

fwrite(STDOUT, sprintf("%d unit checks passed.\n", $tests));

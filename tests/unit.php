<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

require_once __DIR__ . '/../lib/Service/MetadataPolicy.php';

use OCA\Wechselbild\Service\MetadataPolicy;

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
expect($xpath->evaluate('string(/info/id)') === 'wechselbild', 'Independent app identifier');
expect($xpath->evaluate('string(/info/namespace)') === 'Wechselbild', 'Independent namespace');
expect($xpath->evaluate('string(/info/dependencies/nextcloud/@min-version)') === '34', 'Nextcloud minimum');
expect($xpath->evaluate('string(/info/dependencies/nextcloud/@max-version)') === '34', 'Nextcloud maximum');
expect(!file_exists(__DIR__ . '/../appinfo/signature.json'), 'No foreign signature may be bundled');

fwrite(STDOUT, sprintf("%d unit checks passed.\n", $tests));

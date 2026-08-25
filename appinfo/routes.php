<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

return [
	'routes' => [
		[
			'name' => 'background#select',
			'url' => '/api/background',
			'verb' => 'GET',
		],
		[
			'name' => 'background#image',
			'url' => '/api/image/{theme}/{id}',
			'verb' => 'GET',
			'requirements' => [
				'theme' => 'landscapes|animals|space|architecture',
				'id' => '[a-f0-9]{32}',
			],
		],
	],
];

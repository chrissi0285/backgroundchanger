<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Christian
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
			'url' => '/api/image/{id}',
			'verb' => 'GET',
			'requirements' => ['id' => '[a-f0-9]{32}'],
		],
	],
];

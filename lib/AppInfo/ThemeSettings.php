<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 chrissi0285
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\BackgroundChanger\AppInfo;

use OCA\BackgroundChanger\Service\ThemeService;
use OCP\IL10N;
use OCP\Settings\DeclarativeSettingsTypes;
use OCP\Settings\IDeclarativeSettingsForm;

final class ThemeSettings implements IDeclarativeSettingsForm {
	public function __construct(private IL10N $l) {
	}

	#[\Override]
	public function getSchema(): array {
		return [
			'id' => 'backgroundchanger-theme',
			'priority' => 90,
			'section_type' => DeclarativeSettingsTypes::SECTION_TYPE_PERSONAL,
			'section_id' => 'theming',
			'storage_type' => DeclarativeSettingsTypes::STORAGE_TYPE_INTERNAL,
			'title' => $this->l->t('ImageChanger'),
			'description' => $this->l->t('Choose rotating backgrounds served locally by this Nextcloud.'),
			'fields' => [
				[
					'id' => ThemeService::PREFERENCE_KEY,
					'title' => $this->l->t('Background theme'),
					'type' => DeclarativeSettingsTypes::RADIO,
					'default' => ThemeService::DEFAULT,
					'options' => [
						['name' => $this->l->t('Default'), 'value' => ThemeService::DEFAULT],
						['name' => $this->l->t('Off'), 'value' => ThemeService::OFF],
						['name' => $this->l->t('Landscapes'), 'value' => ThemeService::LANDSCAPES],
						['name' => $this->l->t('Animals'), 'value' => ThemeService::ANIMALS],
						['name' => $this->l->t('Space'), 'value' => ThemeService::SPACE],
						['name' => $this->l->t('Architecture'), 'value' => ThemeService::ARCHITECTURE],
					],
				],
			],
		];
	}
}

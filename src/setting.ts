import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type FridayPlugin from './main';

/** Obsidian official protocol: obsidian://mdfriday-publish?... */
export const OBSIDIAN_PROTOCOL_ACTION = 'mdfriday-publish';

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Obsidian 1.13.0+: declarative definitions for settings UI + global search.
	 * When this returns a non-empty array, `display()` is not called.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const mdfKey = this.plugin.settings.mdfKey;

		return [
			{
				name: 'Credential (mdf key)',
				desc: mdfKey
					? `Key ${mdfKey.slice(0, 12)}… — copy to use on Account or another device.`
					: 'Not created yet — issued automatically on first publish.',
				aliases: ['mdf key', 'credential', 'api key', 'mdfriday key'],
				render: (setting) => {
					setting.addExtraButton((btn) => {
						btn.setIcon('copy');
						btn.setTooltip('Copy key');
						btn.setDisabled(!mdfKey);
						btn.onClick(async () => {
							if (!mdfKey) return;
							await navigator.clipboard.writeText(mdfKey);
							new Notice('Mdf key copied', 2000);
						});
					});
				},
			},
		];
	}

	/** Obsidian < 1.13.0 fallback when declarative settings are unavailable. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const mdfKey = this.plugin.settings.mdfKey;

		new Setting(containerEl)
			.setName('Credential (mdf key)')
			.setDesc(
				mdfKey
					? `Key ${mdfKey.slice(0, 12)}… — copy to use on Account or another device.`
					: 'Not created yet — issued automatically on first publish.',
			)
			.addExtraButton((btn) => {
				btn.setIcon('copy');
				btn.setTooltip('Copy key');
				btn.setDisabled(!mdfKey);
				btn.onClick(async () => {
					if (!mdfKey) return;
					await navigator.clipboard.writeText(mdfKey);
					new Notice('Mdf key copied', 2000);
				});
			});
	}
}

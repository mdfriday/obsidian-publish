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

	private credentialDesc(mdfKey: string | null): string {
		return mdfKey
			? `Key ${mdfKey.slice(0, 12)}… — copy to use on Account or another device.`
			: 'Not created yet — issued automatically on first publish.';
	}

	/**
	 * Obsidian 1.13.0+: declarative definitions for settings UI + global search.
	 * When this returns a non-empty array, `display()` is not called.
	 * Call `this.update()` after mdfKey (or other shown fields) change so Obsidian
	 * re-runs this and refreshes the cached settingItems / search index.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const mdfKey = this.plugin.settings.mdfKey;

		return [
			{
				name: 'Credential (mdf key)',
				desc: this.credentialDesc(mdfKey),
				aliases: ['mdf key', 'credential', 'api key', 'mdfriday key'],
				render: (setting) => {
					// Re-read on each render in case the tab was open across a mint.
					const key = this.plugin.settings.mdfKey;
					setting.setDesc(this.credentialDesc(key));
					setting.addExtraButton((btn) => {
						btn.setIcon('copy');
						btn.setTooltip('Copy key');
						btn.setDisabled(!key);
						btn.onClick(async () => {
							const live = this.plugin.settings.mdfKey;
							if (!live) return;
							await navigator.clipboard.writeText(live);
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
			.setDesc(this.credentialDesc(mdfKey))
			.addExtraButton((btn) => {
				btn.setIcon('copy');
				btn.setTooltip('Copy key');
				btn.setDisabled(!mdfKey);
				btn.onClick(async () => {
					const live = this.plugin.settings.mdfKey;
					if (!live) return;
					await navigator.clipboard.writeText(live);
					new Notice('Mdf key copied', 2000);
				});
			});
	}
}

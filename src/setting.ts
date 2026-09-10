import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type FridayPlugin from './main';

/** Obsidian official protocol: obsidian://mdfriday-publish?... */
export const OBSIDIAN_PROTOCOL_ACTION = 'mdfriday-publish';

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Credentials').setHeading();

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

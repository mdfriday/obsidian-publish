import {App, PluginSettingTab, Setting, Platform} from 'obsidian';
import type FridayPlugin from './main';

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {
			text: 'MDFriday Publish',
			cls: 'friday-section-title',
		});

		new Setting(containerEl)
			.setName('Publish to Cloudflare')
			.setDesc(
				'No account required. The plugin automatically creates a guest session, publishes your site, and returns a share link. Sign in later to claim your sites.',
			);

		const token = this.plugin.settings.cloudflareGuestToken;
		new Setting(containerEl)
			.setName('Guest session')
			.setDesc(
				token
					? `Active (${token.slice(0, 8)}…). Clear to start fresh on this device.`
					: 'Not created yet — will be created on first publish.',
			)
			.addButton((btn) => {
				btn.setButtonText('Clear guest session').setWarning();
				btn.onClick(async () => {
					this.plugin.settings.cloudflareGuestToken = null;
					await this.plugin.saveSettings();
					this.display();
				});
				btn.setDisabled(!token);
			});

		if (Platform.isDesktop) {
			containerEl.createEl('h3', {text: 'Advanced', cls: 'friday-section-title'});

			new Setting(containerEl)
				.setName('API base URL')
				.setDesc('Control plane (default https://api.fsky.top)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.cloudflareApiBaseUrl || 'https://api.fsky.top')
						.onChange(async (value) => {
							this.plugin.settings.cloudflareApiBaseUrl =
								value.trim() || 'https://api.fsky.top';
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName('Share base URL')
				.setDesc('Public share host (default https://share.fsky.top)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.cloudflarePublicBaseUrl || 'https://share.fsky.top')
						.onChange(async (value) => {
							this.plugin.settings.cloudflarePublicBaseUrl =
								value.trim() || 'https://share.fsky.top';
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName('Theme download server')
				.setDesc('Region for downloading theme samples')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('global', this.plugin.i18n.t('settings.download_server_global'))
						.addOption('east', this.plugin.i18n.t('settings.download_server_east'))
						.setValue(this.plugin.settings.downloadServer || 'global')
						.onChange(async (value) => {
							this.plugin.settings.downloadServer = value as 'global' | 'east';
							await this.plugin.saveSettings();
						});
				});
		}
	}
}

import {App, PluginSettingTab, Setting, Platform, Notice} from 'obsidian';
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
				'Guest publish needs no account. Sign in with Google (Free) via mdfriday.com Account to claim your sites permanently.',
			);

		const userToken = this.plugin.settings.cloudflareUserToken;
		const guestToken = this.plugin.settings.cloudflareGuestToken;

		new Setting(containerEl)
			.setName('Account (Free)')
			.setDesc(
				userToken
					? `Signed in (${userToken.slice(0, 12)}…). Publish uses your Free account.`
					: 'Not signed in — Guest mode until you paste a JWT from Google login.',
			)
			.addButton((btn) => {
				btn.setButtonText('Open Google sign-in');
				btn.onClick(() => {
					const base = (
						this.plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account'
					).replace(/\/$/, '');
					window.open(`${base}/`, '_blank');
					new Notice(
						'Sign in with Google on the Account page, then paste the token here (or from ?token= in the URL).',
						8000,
					);
				});
			})
			.addButton((btn) => {
				btn.setButtonText(userToken ? 'Sign out' : 'Clear').setWarning();
				btn.onClick(async () => {
					if (this.plugin.projectServiceManager) {
						await this.plugin.projectServiceManager.logoutCloudflareUser();
					} else {
						this.plugin.settings.cloudflareUserToken = null;
						await this.plugin.saveSettings();
					}
					this.display();
				});
				btn.setDisabled(!userToken);
			});

		let pendingJwt = '';
		new Setting(containerEl)
			.setName('Paste account token')
			.setDesc(
				'After Google login, copy the `token` query param from the redirect URL (studio / account callback) and paste here.',
			)
			.addText((text) => {
				text.setPlaceholder('eyJhbGciOi… or full URL with ?token=');
				text.onChange((value) => {
					pendingJwt = value;
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Save & claim guest');
				btn.setCta();
				btn.onClick(async () => {
					const raw = pendingJwt.trim();
					if (!raw) {
						new Notice('Paste a token first', 3000);
						return;
					}
					let jwt = raw;
					try {
						if (raw.includes('token=')) {
							const u = new URL(raw.includes('://') ? raw : `https://x.local/?${raw.replace(/^\?/, '')}`);
							jwt = u.searchParams.get('token') || raw;
						}
					} catch {
						/* use raw */
					}
					const mgr = this.plugin.projectServiceManager;
					if (!mgr) {
						new Notice('Publish service not ready', 3000);
						return;
					}
					const result = await mgr.loginWithUserToken(jwt);
					if (!result.success) {
						new Notice(`Sign-in failed: ${result.error}`, 5000);
						return;
					}
					new Notice(
						result.plan
							? `Signed in (${result.plan}). Guest sites claimed if any.`
							: 'Signed in. Guest sites claimed if any.',
						5000,
					);
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('Guest session')
			.setDesc(
				guestToken
					? `Active (${guestToken.slice(0, 8)}…). Cleared after claim, or clear to start fresh.`
					: 'Not created yet — will be created on first publish.',
			)
			.addButton((btn) => {
				btn.setButtonText('Clear guest session').setWarning();
				btn.onClick(async () => {
					this.plugin.settings.cloudflareGuestToken = null;
					await this.plugin.saveSettings();
					this.display();
				});
				btn.setDisabled(!guestToken);
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
				.setName('Account / OAuth redirect hint')
				.setDesc('Studio or account host that receives ?token= after Google login')
				.addText((text) => {
					text
						.setValue(
							this.plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account',
						)
						.onChange(async (value) => {
							this.plugin.settings.cloudflareAccountBaseUrl =
								value.trim() || 'https://mdfriday.com/account';
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
						.setValue(this.plugin.settings.downloadServer)
						.onChange(async (value: 'global' | 'east') => {
							this.plugin.settings.downloadServer = value;
							await this.plugin.saveSettings();
						});
				});
		}
	}
}

import {App, PluginSettingTab, Setting, Platform, Notice} from 'obsidian';
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
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {
			text: 'MDFriday Publish',
			cls: 'friday-section-title',
		});

		new Setting(containerEl)
			.setName('Publish to Cloudflare')
			.setDesc(
				'Guest needs no account. Sign in via mdfriday.com Account to claim sites (same MDF Key). Content expires next UTC midnight until claimed.',
			);

		const mdfKey = this.plugin.settings.mdfKey;
		const kind = this.plugin.settings.mdfKeyKind;

		new Setting(containerEl)
			.setName('Credential (MDF Key)')
			.setDesc(
				mdfKey
					? `Key ${mdfKey.slice(0, 12)}… — kind shown beside: ${kind ?? 'unknown'}. Key string has no type prefix.`
					: 'Not created yet — issued on first publish (guest).',
			)
			.addExtraButton((btn) => {
				btn.setIcon('copy');
				btn.setTooltip('Copy Key');
				btn.setDisabled(!mdfKey);
				btn.onClick(async () => {
					if (!mdfKey) return;
					await navigator.clipboard.writeText(mdfKey);
					new Notice('MDF Key copied', 2000);
				});
			})
			.addButton((btn) => {
				btn.setButtonText(kind === 'user' ? 'User' : kind === 'guest' ? 'Guest' : '—');
				btn.setDisabled(true);
			})
			.addButton((btn) => {
				btn.setButtonText('Clear Key').setWarning();
				btn.setDisabled(!mdfKey);
				btn.onClick(async () => {
					this.plugin.settings.mdfKey = null;
					this.plugin.settings.mdfKeyKind = null;
					this.plugin.settings.mdfKeyPlan = null;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('Account (Free)')
			.setDesc(
				kind === 'user'
					? `Signed in as Free/Paid (plan: ${this.plugin.settings.mdfKeyPlan ?? '—'}).`
					: 'Opens mdfriday.com Account with your Key for Google login + claim. Plugin updates via deep link.',
			)
			.addButton((btn) => {
				btn.setButtonText('Open Account login');
				btn.setCta();
				btn.onClick(async () => {
					const mgr = this.plugin.projectServiceManager;
					if (!mgr) {
						new Notice('Publish service not ready', 3000);
						return;
					}
					const key = await mgr.ensureMdfKey();
					if (!key) {
						new Notice('Could not create guest Key', 3000);
						return;
					}
					const accountBase = (
						this.plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account'
					).replace(/\/$/, '');
					const url = `${accountBase}/?key=${encodeURIComponent(key)}`;
					window.open(url, '_blank');
					new Notice(
						'Complete Google sign-in on Account. Obsidian will refresh when deep link returns.',
						6000,
					);
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Refresh status');
				btn.onClick(async () => {
					const mgr = this.plugin.projectServiceManager;
					if (!mgr) return;
					const r = await mgr.refreshCloudflareAccount();
					if (!r.success) {
						new Notice(r.error || 'Refresh failed', 4000);
						return;
					}
					new Notice(`Account: ${r.kind} / ${r.plan}`, 3000);
					this.display();
				});
			});

		if (Platform.isDesktop) {
			containerEl.createEl('h3', {text: 'Advanced', cls: 'friday-section-title'});

			const env = this.plugin.settings.cloudflareEnv || 'auto';
			const resolved =
				this.plugin.settings.cloudflareResolvedEnv ||
				(env === 'auto' ? '…' : env);
			new Setting(containerEl)
				.setName('Cloudflare environment')
				.setDesc(
					`One switch for API / Share / Account. Auto = use local if :8787 is up, else staging. Now: ${resolved}. ` +
						`API ${this.plugin.settings.cloudflareApiBaseUrl} · Account ${this.plugin.settings.cloudflareAccountBaseUrl}`,
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption('auto', 'Auto (local if running)')
						.addOption('local', 'Local (127.0.0.1)')
						.addOption('staging', 'Staging (fsky.top)')
						.addOption('production', 'Production')
						.setValue(env)
						.onChange(async (value: string) => {
							this.plugin.settings.cloudflareEnv = value as
								| 'auto'
								| 'local'
								| 'staging'
								| 'production';
							await this.plugin.applyCloudflareEnv({ persist: true, noticeOnSwitch: true });
							this.display();
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
						.onChange(async (value: string) => {
							this.plugin.settings.downloadServer = value as 'global' | 'east';
							await this.plugin.saveSettings();
						});
				});
		}
	}
}

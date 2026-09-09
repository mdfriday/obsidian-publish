import {App, PluginSettingTab, Setting, Platform, Notice} from 'obsidian';
import type FridayPlugin from './main';
import { resolveAccountBaseUrl } from './cloudflare-env';

/** Obsidian official protocol: obsidian://mdfriday-publish?... */
export const OBSIDIAN_PROTOCOL_ACTION = 'mdfriday-publish';

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return '—';
	const d = new Date(ms);
	const utc = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
	const local = d.toLocaleString();
	return `${local} (${utc})`;
}

function clearAccountSnapshot(plugin: FridayPlugin): void {
	plugin.settings.mdfKey = null;
	plugin.settings.mdfKeyKind = null;
	plugin.settings.mdfKeyPlan = null;
	plugin.settings.mdfStorageBytes = null;
	plugin.settings.mdfQuotaStorageBytes = null;
	plugin.settings.mdfContentExpiresAt = null;
	plugin.settings.mdfProjectCount = null;
	plugin.settings.mdfQuotaMaxProjects = null;
	plugin.settings.mdfQuotaRetentionDays = null;
	plugin.settings.mdfQuotaMaxCustomDomains = null;
	plugin.settings.mdfQuotaFeatures = null;
	plugin.settings.mdfAccountEmail = null;
}

function buildPlanDesc(plugin: FridayPlugin): string {
	const mdfKey = plugin.settings.mdfKey;
	const kind = plugin.settings.mdfKeyKind;
	const plan = (plugin.settings.mdfKeyPlan || kind || '—').toLowerCase();
	const used = plugin.settings.mdfStorageBytes;
	const quotaBytes = plugin.settings.mdfQuotaStorageBytes;
	const expiresAt = plugin.settings.mdfContentExpiresAt;
	const projectCount = plugin.settings.mdfProjectCount;
	const maxProjects = plugin.settings.mdfQuotaMaxProjects;
	const retentionDays = plugin.settings.mdfQuotaRetentionDays;
	const storageLabel =
		used != null && quotaBytes != null
			? `${formatBytes(used)} / ${formatBytes(quotaBytes)}`
			: used != null
				? formatBytes(used)
				: '—';

	if (!mdfKey) {
		return 'Publish once or refresh after login to load plan limits.';
	}
	if (plan === 'guest') {
		return (
			`Guest · Storage ${storageLabel} · ` +
			`Content clears: ${formatExpiry(expiresAt)} · Sign in on Account to keep the same URL.`
		);
	}
	if (plan === 'free') {
		const proj =
			projectCount != null
				? `Projects ${projectCount}${maxProjects != null ? ` / ${maxProjects}` : ''}`
				: 'Projects —';
		const retain =
			retentionDays != null
				? `Retention ~${retentionDays} days without publish activity`
				: 'Retention per Free plan';
		const exp =
			expiresAt != null ? ` · Next content expiry: ${formatExpiry(expiresAt)}` : '';
		return `Free · Storage ${storageLabel} · ${proj} · ${retain}${exp}`;
	}
	if (plan === 'personal' || plan === 'pro') {
		const domains = plugin.settings.mdfQuotaMaxCustomDomains;
		const domainLabel =
			domains != null ? ` · Custom domains up to ${domains}` : '';
		return (
			`${plan.charAt(0).toUpperCase() + plan.slice(1)} · Storage ${storageLabel} · Permanent retention${domainLabel}`
		);
	}
	return `Plan: ${plan}. Use Refresh status to load quota.`;
}

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;
	private refreshingQuota = false;

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
				'Guest needs no account. Sign in via Account to claim sites (same MDF Key). Guest content clears at next UTC midnight until claimed.',
			);

		const mdfKey = this.plugin.settings.mdfKey;
		const kind = this.plugin.settings.mdfKeyKind;

		new Setting(containerEl)
			.setName('Credential (MDF Key)')
			.setDesc(
				mdfKey
					? `Key ${mdfKey.slice(0, 12)}… — kind: ${kind ?? 'unknown'}. Key string has no type prefix.`
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
					clearAccountSnapshot(this.plugin);
					await this.plugin.saveSettings();
					this.display();
				});
			});

		const needsQuotaFetch =
			!!mdfKey &&
			(this.plugin.settings.mdfQuotaStorageBytes == null ||
				this.plugin.settings.mdfStorageBytes == null);

		new Setting(containerEl)
			.setName('Plan & quota')
			.setDesc(
				needsQuotaFetch && this.refreshingQuota
					? 'Loading plan limits…'
					: buildPlanDesc(this.plugin),
			);

		if (needsQuotaFetch && !this.refreshingQuota) {
			this.refreshingQuota = true;
			void this.plugin.projectServiceManager
				?.refreshCloudflareAccount()
				.then((r) => {
					this.refreshingQuota = false;
					if (r?.success) this.display();
				})
				.catch(() => {
					this.refreshingQuota = false;
				});
		}

		new Setting(containerEl)
			.setName('Account')
			.setDesc(
				kind === 'user'
					? `Signed in (plan: ${this.plugin.settings.mdfKeyPlan ?? '—'}). Deep link refreshes after claim.`
					: 'Opens Account with your Key for Google login + claim. Plugin updates via deep link.',
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
					const accountBase = resolveAccountBaseUrl(this.plugin.settings);
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
					const used = this.plugin.settings.mdfStorageBytes;
					const quota = this.plugin.settings.mdfQuotaStorageBytes;
					const detail =
						used != null && quota != null
							? ` · ${formatBytes(used)} / ${formatBytes(quota)}`
							: '';
					new Notice(`Account: ${r.kind} / ${r.plan}${detail}`, 4000);
					this.display();
				});
			});

		const planLower = (this.plugin.settings.mdfKeyPlan || '').toLowerCase();
		if (kind === 'user' && planLower === 'free') {
			new Setting(containerEl)
				.setName('Upgrade to Personal')
				.setDesc('Permanent hosting and larger storage. Opens Account to start checkout.')
				.addButton((btn) => {
					btn.setButtonText('Upgrade…');
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
						const accountBase = resolveAccountBaseUrl(this.plugin.settings);
						const url = `${accountBase}/?key=${encodeURIComponent(key)}`;
						window.open(url, '_blank');
						new Notice('Sign in on Account if needed, then click Upgrade to Personal.', 6000);
					});
				});
		}

		new Setting(containerEl)
			.setName('Cloudflare projects')
			.setDesc(
				'List remote sites on your Key. Personal: bind a custom domain (TXT + CNAME). Free/Guest: list only — domain requires upgrade.',
			)
			.addButton((btn) => {
				btn.setButtonText('Manage…');
				btn.onClick(() => {
					void this.plugin.openCloudflareProjectsModal();
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
					`One switch for API / Share / Account. Prefer Staging (not Auto) when testing Personal/domains — Auto may flip to Local if :8787 is up and clear your Key. Now: ${resolved}. ` +
						`API ${this.plugin.settings.cloudflareApiBaseUrl} · Account ${this.plugin.settings.cloudflareAccountBaseUrl}`,
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption('staging', 'Staging (fsky.top) — default for builds')
						.addOption('production', 'Production (mdfriday.com)')
						.addOption('local', 'Local (127.0.0.1)')
						.addOption('auto', 'Auto (local if :8787 up, else staging)')
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

import { App, Modal, Notice, Setting, SuggestModal } from 'obsidian';
import type FridayPlugin from '../main';
import { DomainWizardModal } from './domainWizardModal';

export type CloudflareRemoteProjectRow = {
	id: string;
	siteId?: string;
	title?: string;
	kind?: string;
	hostingMode?: string;
	status?: string;
	expiresAt?: number | null;
	domainHostname?: string;
	domainStatus?: string;
	domainCertStatus?: string;
};

/**
 * Lists remote Cloudflare projects (GET /v1/projects) and opens the domain wizard.
 */
export class CloudflareProjectsModal extends SuggestModal<CloudflareRemoteProjectRow> {
	private plugin: FridayPlugin;
	private projects: CloudflareRemoteProjectRow[] = [];

	constructor(app: App, plugin: FridayPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder('Search Cloudflare projects…');
		this.setInstructions([
			{ command: '↵', purpose: 'manage domain' },
			{ command: 'esc', purpose: 'close' },
		]);
	}

	async onOpen() {
		super.onOpen();
		await this.load();
	}

	private async load() {
		const mgr = this.plugin.projectServiceManager;
		if (!mgr) {
			new Notice('Publish service not ready', 3000);
			this.close();
			return;
		}
		const res = await mgr.listRemoteCloudflareProjects();
		if (!res.success) {
			const msg = res.error || 'Failed to list projects';
			new Notice(msg, 8000);
			console.error('[Friday] Cloudflare projects list failed:', msg);
			this.close();
			return;
		}
		this.projects = res.projects || [];
		if (!this.projects.length) {
			new Notice('No remote Cloudflare projects yet — publish once first.', 5000);
		}
		this.inputEl.dispatchEvent(new Event('input'));
	}

	getSuggestions(query: string): CloudflareRemoteProjectRow[] {
		const q = query.toLowerCase();
		return this.projects.filter((p) => {
			const hay =
				`${p.title || ''} ${p.siteId || ''} ${p.id} ${p.domainHostname || ''}`.toLowerCase();
			return hay.includes(q);
		});
	}

	renderSuggestion(p: CloudflareRemoteProjectRow, el: HTMLElement) {
		el.createDiv({ text: p.title || p.siteId || p.id });
		const meta = el.createDiv({ cls: 'setting-item-description' });
		const domainLine = this.formatDomainLine(p);
		const mode = p.hostingMode || 'share';
		const exp =
			p.expiresAt != null
				? ` · expires ${new Date(p.expiresAt).toISOString().slice(0, 10)}`
				: '';
		meta.setText(
			domainLine
				? `${domainLine} · ${mode} · ${p.status || '—'}${exp}`
				: `no custom domain · ${mode} · ${p.status || '—'}${exp}`,
		);
	}

	private formatDomainLine(p: CloudflareRemoteProjectRow): string | null {
		if (!p.domainHostname) return null;
		const st = (p.domainStatus || '').toLowerCase();
		const cert = (p.domainCertStatus || '').toLowerCase();
		if (st === 'active') return `${p.domainHostname} · active`;
		if (cert === 'provisioning' || st === 'pending') {
			return `${p.domainHostname} · ${cert === 'provisioning' ? 'SSL provisioning' : 'pending'}`;
		}
		return `${p.domainHostname} · ${st || cert || 'bound'}`;
	}

	async onChooseSuggestion(p: CloudflareRemoteProjectRow) {
		const plan = (this.plugin.settings.mdfKeyPlan || '').toLowerCase();
		const features = this.plugin.settings.mdfQuotaFeatures || [];
		const canDomain =
			features.includes('custom_domain') || plan === 'personal' || plan === 'pro';
		if (!canDomain) {
			new Notice(
				'Custom domains require Personal. Open Account or Upgrade in Settings.',
				6000,
			);
			return;
		}

		const foundry = this.plugin.foundryPublishService;
		const auth = await this.plugin.projectServiceManager?.resolveAuthToken();
		if (!foundry || !auth) {
			new Notice('No MDF Key', 3000);
			return;
		}

		const domains = await foundry.listDomains(auth.token, p.id);
		let pending = domains.domains?.find(
			(d) => d.status !== 'active' && d.status !== 'removed',
		);
		let active = domains.domains?.find((d) => d.status === 'active');

		// Catch up DB when CF SSL is already active but plugin still shows pending
		if (pending?.id && !active) {
			const sync = await foundry.syncDomainCert(auth.token, pending.id);
			if (sync.success && (sync.activated || sync.status === 'active')) {
				active = {
					id: pending.id,
					hostname: pending.hostname,
					status: 'active',
					certStatus: 'active',
				};
				pending = undefined;
			}
		}

		const localName =
			this.plugin.currentProjectName &&
			(await this.localProjectMatchesRemote(p.id))
				? this.plugin.currentProjectName
				: null;

		if (active?.hostname) {
			if (localName) {
				await foundry.markBindingCustom({
					workspacePath: this.plugin.absWorkspacePath,
					projectName: localName,
					hostname: active.hostname,
				});
			}
			const wizard = new DomainWizardModal(this.app, this.plugin, {
				projectId: p.id,
				projectTitle: p.title || p.siteId || p.id,
				localProjectName: localName,
				resume: {
					domainId: active.id,
					hostname: active.hostname,
					step: 'done',
				},
			});
			wizard.open();
			return;
		}

		if (pending?.id && pending.hostname) {
			const wizard = new DomainWizardModal(this.app, this.plugin, {
				projectId: p.id,
				projectTitle: p.title || p.siteId || p.id,
				localProjectName: localName,
				resume: {
					domainId: pending.id,
					hostname: pending.hostname,
					txtName: pending.ownershipToken
						? `_mdfriday-verify.${pending.hostname}`
						: undefined,
					txtValue: pending.ownershipToken,
					cnameTarget: domains.cnameTarget,
					step: pending.certStatus === 'pending' ? 'dns' : 'ssl',
				},
			});
			wizard.open();
			return;
		}

		const wizard = new DomainWizardModal(this.app, this.plugin, {
			projectId: p.id,
			projectTitle: p.title || p.siteId || p.id,
			localProjectName: localName,
		});
		wizard.open();
	}

	/** Best-effort: current local project binding equals this remote id. */
	private async localProjectMatchesRemote(remoteId: string): Promise<boolean> {
		const name = this.plugin.currentProjectName;
		if (!name || !this.plugin.foundryPublishService) return false;
		try {
			const auth = await this.plugin.projectServiceManager?.resolveAuthToken();
			if (!auth) return false;
			const bind = await this.plugin.foundryPublishService.ensureCloudflareBinding({
				workspacePath: this.plugin.absWorkspacePath,
				projectName: name,
				authToken: auth.token,
				hostingMode: 'share',
				apiBaseUrl: this.plugin.settings.cloudflareApiBaseUrl,
				publicBaseUrl: this.plugin.settings.cloudflarePublicBaseUrl,
			});
			return bind.success && bind.cloudflareProjectId === remoteId;
		} catch {
			return false;
		}
	}
}

/** Simple entry modal when SuggestModal is awkward on mobile — unused fallback. */
export class CloudflareProjectsInfoModal extends Modal {
	constructor(
		app: App,
		private plugin: FridayPlugin,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Cloudflare projects' });
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText('Open list');
			btn.setCta();
			btn.onClick(() => {
				this.close();
				new CloudflareProjectsModal(this.app, this.plugin).open();
			});
		});
	}
}

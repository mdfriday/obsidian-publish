import { App, Modal, Notice, Setting } from 'obsidian';
import type FridayPlugin from '../main';

type WizardStep = 'hostname' | 'dns' | 'ssl' | 'done';

type SslTxt = { txtName: string; txtValue: string; status?: string };
type DcvCname = { cname: string; cnameTarget: string };

/**
 * Custom domain wizard for a remote Cloudflare project (Personal+).
 * Flow: hostname → ownership TXT/CNAME → verify → SSL DCV TXT → active.
 */
export class DomainWizardModal extends Modal {
	private plugin: FridayPlugin;
	private projectId: string;
	private projectTitle: string;
	private localProjectName: string | null;
	private step: WizardStep = 'hostname';
	private hostnameInput = '';
	private domainId: string | null = null;
	private txtName = '';
	private txtValue = '';
	private cnameTarget = '';
	private sslTxts: SslTxt[] = [];
	private dcvCnames: DcvCname[] = [];
	private sslStatus = '';
	private certStatus = '';
	private statusMsg = '';
	private statusMsgError = false;
	private busy = false;

	private static readonly CERT_POLL_INTERVAL_MS = 30_000;
	private static readonly CERT_POLL_ROUNDS = 12;

	constructor(
		app: App,
		plugin: FridayPlugin,
		opts: {
			projectId: string;
			projectTitle?: string;
			localProjectName?: string | null;
			/** Resume an existing pending domain */
			resume?: {
				domainId: string;
				hostname: string;
				txtName?: string;
				txtValue?: string;
				cnameTarget?: string;
				step?: WizardStep;
			};
		},
	) {
		super(app);
		this.plugin = plugin;
		this.projectId = opts.projectId;
		this.projectTitle = opts.projectTitle || opts.projectId;
		this.localProjectName = opts.localProjectName ?? null;
		if (opts.resume) {
			this.domainId = opts.resume.domainId;
			this.hostnameInput = opts.resume.hostname;
			this.txtName = opts.resume.txtName || '';
			this.txtValue = opts.resume.txtValue || '';
			this.cnameTarget = opts.resume.cnameTarget || '';
			this.step = opts.resume.step || 'ssl';
		}
	}

	onOpen() {
		this.render();
		if (this.step === 'ssl' && this.domainId) {
			void this.pollCert(false);
		}
	}

	onClose() {
		this.contentEl.empty();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Custom domain' });
		contentEl.createEl('p', {
			text: `Project: ${this.projectTitle}`,
			cls: 'setting-item-description',
		});

		if (this.statusMsg) {
			contentEl.createEl('p', {
				text: this.statusMsg,
				cls: this.statusMsgError ? 'mod-warning' : 'setting-item-description',
			});
		}

		if (this.step === 'hostname') {
			contentEl.createEl('h3', { text: 'Step 1 · Enter your domain' });
			new Setting(contentEl)
				.setName('Domain')
				.setDesc('e.g. www.example.com — you need access to this domain’s DNS')
				.addText((t) => {
					t.setPlaceholder('www.example.com');
					t.setValue(this.hostnameInput);
					t.onChange((v) => {
						this.hostnameInput = v.trim().toLowerCase();
					});
				});
			new Setting(contentEl).addButton((btn) => {
				btn.setButtonText('Next');
				btn.setCta();
				btn.setDisabled(this.busy);
				btn.onClick(() => void this.submitHostname());
			});
			return;
		}

		if (this.step === 'dns') {
			contentEl.createEl('h3', { text: 'Step 2 · Add DNS records' });
			contentEl.createEl('p', {
				text:
					'Host field: do not include your root domain. If the panel already selected example.com, paste only the short Host — a full name becomes …example.com.example.com.',
				cls: 'setting-item-description',
			});
			this.copyRow(
				contentEl,
				'CNAME · Host',
				this.hostnameLeaf(this.hostnameInput),
			);
			this.copyRow(
				contentEl,
				'CNAME · Value',
				(this.cnameTarget || '').replace(/\.$/, ''),
			);
			if (this.txtName && this.txtValue) {
				this.copyRow(contentEl, 'TXT · Host', this.relativeHost(this.txtName));
				this.copyRow(contentEl, 'TXT · Value', this.txtValue);
			}

			new Setting(contentEl).addButton((btn) => {
				btn.setButtonText("I've added them — verify");
				btn.setCta();
				btn.setDisabled(this.busy);
				btn.onClick(() => void this.runVerify());
			});
			return;
		}

		if (this.step === 'ssl') {
			contentEl.createEl('h3', { text: 'Step 3 · Turn on HTTPS' });
			contentEl.createEl('p', {
				text:
					'Ownership looks good. Add the HTTPS record below (same Host rules). If you added a TXT on the same host earlier, remove that TXT and keep only this CNAME. Certificate usually finishes in a few minutes.',
				cls: 'setting-item-description',
			});

			if (this.dcvCnames.length) {
				for (const d of this.dcvCnames) {
					this.copyRow(contentEl, 'CNAME · Host', this.relativeHost(d.cname));
					this.copyRow(
						contentEl,
						'CNAME · Value',
						d.cnameTarget.replace(/\.$/, ''),
					);
				}
			} else if (this.sslTxts.length) {
				this.sslTxts.forEach((r, i) => {
					this.copyRow(
						contentEl,
						`TXT · Host #${i + 1}`,
						this.relativeHost(r.txtName),
					);
					this.copyRow(contentEl, `TXT · Value #${i + 1}`, r.txtValue);
				});
			} else {
				contentEl.createEl('p', {
					text: 'Records not ready yet — tap Refresh status in a few seconds.',
					cls: 'setting-item-description',
				});
			}

			new Setting(contentEl)
				.addButton((btn) => {
					btn.setButtonText('Refresh status');
					btn.setCta();
					btn.setDisabled(this.busy || !this.domainId);
					btn.onClick(() => void this.pollCert(false));
				})
				.addButton((btn) => {
					btn.setButtonText('Keep checking (about 1 min)');
					btn.setDisabled(this.busy || !this.domainId);
					btn.onClick(() => void this.pollCert(true));
				});
			return;
		}

		if (this.step === 'done') {
			contentEl.createEl('p', {
				text: `Bound ${this.hostnameInput}`,
			});
			contentEl.createEl('p', {
				text: 'Publish once more, then open your site on this domain.',
				cls: 'setting-item-description',
			});
			new Setting(contentEl).addButton((btn) => {
				btn.setButtonText('Close');
				btn.setCta();
				btn.onClick(() => this.close());
			});
		}
	}

	/** FQDN → registrar relative host for zone twer.vip etc. */
	private relativeHost(fqdn: string): string {
		const host = fqdn.replace(/\.$/, '').toLowerCase();
		// www.twer.vip → www; _acme-challenge.www.twer.vip → _acme-challenge.www
		const parts = host.split('.');
		if (parts.length >= 3) return parts.slice(0, -2).join('.');
		return host;
	}

	/** For registrar UIs that want relative host (www / _acme-challenge.www). */
	private hostnameLeaf(fqdn: string): string {
		return this.relativeHost(fqdn);
	}

	private copyRow(parent: HTMLElement, label: string, value: string) {
		new Setting(parent).setName(label).setDesc(value || '—').addButton((btn) => {
			btn.setButtonText('Copy');
			btn.onClick(async () => {
				if (!value) return;
				await navigator.clipboard.writeText(value);
				new Notice('Copied', 1500);
			});
		});
	}

	private applySslHints(sync: {
		sslStatus?: string | null;
		status?: string;
		validationRecords?: Array<{ txtName?: string; txtValue?: string; status?: string }>;
		dcvRecords?: Array<{ cname?: string; cnameTarget?: string }>;
	}) {
		this.sslStatus = sync.sslStatus || '';
		this.certStatus = sync.status || '';
		this.sslTxts = (sync.validationRecords || [])
			.filter((r) => r.txtName && r.txtValue)
			.map((r) => ({
				txtName: r.txtName!,
				txtValue: r.txtValue!,
				...(r.status ? { status: r.status } : {}),
			}));
		this.dcvCnames = (sync.dcvRecords || [])
			.filter((r) => r.cname && r.cnameTarget)
			.map((r) => ({ cname: r.cname!, cnameTarget: r.cnameTarget! }));
	}

	private async resolveAuth(): Promise<string | null> {
		const mgr = this.plugin.projectServiceManager;
		if (!mgr) return null;
		const auth = await mgr.resolveAuthToken();
		return auth?.token ?? null;
	}

	private setStatus(msg: string, error = false) {
		this.statusMsg = msg;
		this.statusMsgError = error;
	}

	private clearStatus() {
		this.statusMsg = '';
		this.statusMsgError = false;
	}

	private async submitHostname() {
		const host = this.hostnameInput.trim().toLowerCase();
		if (!host || host.includes('/') || host.includes(' ')) {
			this.setStatus('Enter a valid hostname.');
			this.render();
			return;
		}
		const foundry = this.plugin.foundryPublishService;
		if (!foundry) {
			this.setStatus('Publish service not ready.', true);
			this.render();
			return;
		}
		const token = await this.resolveAuth();
		if (!token) {
			this.setStatus('No MDF Key — publish once or open Account.', true);
			this.render();
			return;
		}

		this.busy = true;
		this.setStatus('Creating domain…');
		this.render();
		const res = await foundry.addDomain(token, this.projectId, host);
		this.busy = false;
		if (!res.success) {
			if (res.code === 'plan_required') {
				this.setStatus(
					'Custom domains require Personal. Upgrade from Account or Settings.',
					true,
				);
			} else if (res.code === 'conflict' && res.details?.reason === 'bound_other_project') {
				const title = String(res.details.boundProjectTitle || res.details.boundProjectId || '');
				this.setStatus(
					`This domain is bound to another site (“${title}”). Unbind it there first.`,
					true,
				);
			} else {
				this.setStatus(res.error || 'Failed to add domain', true);
			}
			this.render();
			return;
		}
		this.domainId = res.id || null;
		this.hostnameInput = res.hostname || host;
		this.cnameTarget = res.cnameTarget || this.cnameTarget;
		if (res.mode === 'rebind' || res.mode === 'already_bound' || res.activated) {
			await this.onActivated();
			return;
		}
		this.txtName = res.txtName || '';
		this.txtValue = res.txtValue || '';
		const st = (res.status || '').toLowerCase();
		if (res.mode === 'resume' && st && st !== 'pending' && st !== 'verifying') {
			this.step = 'ssl';
			this.clearStatus();
			this.render();
			await this.pollCert(false);
			return;
		}
		this.step = 'dns';
		this.clearStatus();
		this.render();
	}

	private async runVerify() {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry || !this.domainId) return;
		const token = await this.resolveAuth();
		if (!token) return;

		this.busy = true;
		this.setStatus('Checking ownership TXT…');
		this.render();
		const verified = await foundry.verifyDomain(token, this.domainId);
		this.busy = false;
		if (!verified.success) {
			this.setStatus(
				verified.error || 'Verify failed — is ownership TXT published?',
				true,
			);
			this.render();
			return;
		}
		if (verified.activated) {
			await this.onActivated();
			return;
		}
		this.applySslHints(verified);
		this.step = 'ssl';
		this.clearStatus();
		this.render();
		await this.pollCert(false);
	}

	private async pollCert(loop: boolean) {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry || !this.domainId) return;
		const token = await this.resolveAuth();
		if (!token) return;

		this.busy = true;
		const max = loop ? DomainWizardModal.CERT_POLL_ROUNDS : 1;
		for (let i = 0; i < max; i++) {
			this.setStatus(`Checking certificate… (${i + 1}/${max})`);
			this.render();
			const sync = await foundry.syncDomainCert(token, this.domainId);
			if (!sync.success) {
				this.setStatus(sync.error || 'sync-cert failed', true);
				this.busy = false;
				this.render();
				return;
			}
			this.applySslHints(sync);
			if (sync.activated || sync.status === 'active') {
				this.busy = false;
				await this.onActivated();
				return;
			}
			if (sync.sslStatus === 'active') {
				const again = await foundry.syncDomainCert(token, this.domainId);
				if (again.success && (again.activated || again.status === 'active')) {
					this.busy = false;
					await this.onActivated();
					return;
				}
			}
			this.setStatus('Certificate still provisioning…');
			this.step = 'ssl';
			this.render();
			if (i < max - 1) await sleep(DomainWizardModal.CERT_POLL_INTERVAL_MS);
		}
		this.busy = false;
		this.setStatus(
			'Still working. Confirm the HTTPS DNS record is live, wait 1–2 min, then Refresh status.',
		);
		this.render();
	}

	private async onActivated() {
		const foundry = this.plugin.foundryPublishService;
		if (foundry && this.localProjectName) {
			await foundry.markBindingCustom({
				workspacePath: this.plugin.absWorkspacePath,
				projectName: this.localProjectName,
				hostname: this.hostnameInput,
			});
		}
		this.step = 'done';
		this.clearStatus();
		new Notice(
			`Bound ${this.hostnameInput} — publish once more, then open https://${this.hostnameInput}/`,
			6000,
		);
		this.render();
	}
}


function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

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
	private busy = false;

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
			contentEl.createEl('p', { text: this.statusMsg, cls: 'mod-warning' });
		}

		if (this.step === 'hostname') {
			new Setting(contentEl)
				.setName('Hostname')
				.setDesc('e.g. www.example.com (no https://)')
				.addText((t) => {
					t.setPlaceholder('www.example.com');
					t.setValue(this.hostnameInput);
					t.onChange((v) => {
						this.hostnameInput = v.trim().toLowerCase();
					});
				});
			new Setting(contentEl).addButton((btn) => {
				btn.setButtonText('Continue');
				btn.setCta();
				btn.setDisabled(this.busy);
				btn.onClick(() => void this.submitHostname());
			});
			return;
		}

		if (this.step === 'dns') {
			contentEl.createEl('h3', { text: '1. Ownership DNS' });
			contentEl.createEl('p', {
				text: 'Add these at your DNS provider, wait a minute, then Verify.',
			});
			this.copyRow(contentEl, 'TXT host / name', this.txtName);
			this.copyRow(contentEl, 'TXT value', this.txtValue);
			this.copyRow(
				contentEl,
				'CNAME host',
				this.hostnameLeaf(this.hostnameInput),
			);
			this.copyRow(contentEl, 'CNAME target', this.cnameTarget);

			new Setting(contentEl)
				.addButton((btn) => {
					btn.setButtonText('I added DNS — Verify ownership');
					btn.setCta();
					btn.setDisabled(this.busy);
					btn.onClick(() => void this.runVerify());
				});
			return;
		}

		if (this.step === 'ssl') {
			contentEl.createEl('h3', { text: '2. SSL certificate (DCV)' });
			contentEl.createEl('p', {
				text:
					'Ownership is OK. For HTTPS, Cloudflare prefers a DCV CNAME (same name as ACME). ' +
					'Do NOT keep ACME TXT on the same host if you use DCV CNAME — they conflict. ' +
					`SSL: ${this.sslStatus || '—'} · cert: ${this.certStatus || 'provisioning'}`,
			});

			if (this.dcvCnames.length) {
				contentEl.createEl('p', {
					text: 'Recommended — delete any _acme-challenge TXT, then add this CNAME (Aliyun: host _acme-challenge.www):',
				});
				for (const d of this.dcvCnames) {
					this.copyRow(contentEl, 'DCV CNAME name (FQDN)', d.cname);
					this.copyRow(
						contentEl,
						'DCV CNAME host (Aliyun)',
						this.relativeHost(d.cname),
					);
					this.copyRow(contentEl, 'DCV CNAME target', d.cnameTarget.replace(/\.$/, ''));
				}
			} else if (this.sslTxts.length) {
				contentEl.createEl('p', {
					text: 'Fallback — ACME TXT (only if no DCV CNAME is shown):',
				});
				this.sslTxts.forEach((r, i) => {
					this.copyRow(contentEl, `ACME TXT name #${i + 1}`, r.txtName);
					this.copyRow(
						contentEl,
						`ACME TXT host (Aliyun) #${i + 1}`,
						this.relativeHost(r.txtName),
					);
					this.copyRow(contentEl, `ACME TXT value #${i + 1}`, r.txtValue);
				});
			} else {
				contentEl.createEl('p', {
					text: 'No DCV records returned yet — click Refresh in a few seconds.',
					cls: 'mod-warning',
				});
			}

			new Setting(contentEl)
				.addButton((btn) => {
					btn.setButtonText('Refresh cert status');
					btn.setCta();
					btn.setDisabled(this.busy || !this.domainId);
					btn.onClick(() => void this.pollCert(false));
				})
				.addButton((btn) => {
					btn.setButtonText('Poll for 1 minute');
					btn.setDisabled(this.busy || !this.domainId);
					btn.onClick(() => void this.pollCert(true));
				});
			return;
		}

		if (this.step === 'done') {
			contentEl.createEl('p', {
				text: `Domain active: https://${this.hostnameInput}/`,
			});
			contentEl.createEl('p', {
				text: 'Publish again so the site rebuilds with baseURL=/ (correct CSS/asset paths). The access link after publish will be this hostname.',
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

	private async submitHostname() {
		const host = this.hostnameInput.trim().toLowerCase();
		if (!host || host.includes('/') || host.includes(' ')) {
			this.statusMsg = 'Enter a valid hostname.';
			this.render();
			return;
		}
		const foundry = this.plugin.foundryPublishService;
		if (!foundry) {
			this.statusMsg = 'Publish service not ready.';
			this.render();
			return;
		}
		const token = await this.resolveAuth();
		if (!token) {
			this.statusMsg = 'No MDF Key — publish once or open Account.';
			this.render();
			return;
		}

		this.busy = true;
		this.statusMsg = 'Creating domain…';
		this.render();
		const res = await foundry.addDomain(token, this.projectId, host);
		this.busy = false;
		if (!res.success) {
			if (res.code === 'plan_required') {
				this.statusMsg =
					'Custom domains require Personal. Upgrade from Account or Settings.';
			} else {
				this.statusMsg = res.error || 'Failed to add domain';
			}
			this.render();
			return;
		}
		this.domainId = res.id || null;
		this.txtName = res.txtName || '';
		this.txtValue = res.txtValue || '';
		this.cnameTarget = res.cnameTarget || '';
		this.hostnameInput = res.hostname || host;
		this.step = 'dns';
		this.statusMsg = '';
		this.render();
	}

	private async runVerify() {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry || !this.domainId) return;
		const token = await this.resolveAuth();
		if (!token) return;

		this.busy = true;
		this.statusMsg = 'Checking ownership TXT…';
		this.render();
		const verified = await foundry.verifyDomain(token, this.domainId);
		this.busy = false;
		if (!verified.success) {
			this.statusMsg = verified.error || 'Verify failed — is ownership TXT published?';
			this.render();
			return;
		}
		if (verified.activated) {
			await this.onActivated();
			return;
		}
		this.applySslHints(verified);
		this.step = 'ssl';
		this.statusMsg =
			'Ownership verified. Add the SSL (ACME) records below, then Refresh.';
		this.render();
		await this.pollCert(false);
	}

	private async pollCert(loop: boolean) {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry || !this.domainId) return;
		const token = await this.resolveAuth();
		if (!token) return;

		this.busy = true;
		const max = loop ? 12 : 1;
		for (let i = 0; i < max; i++) {
			this.statusMsg = `Checking certificate… (${i + 1}/${max})`;
			this.render();
			const sync = await foundry.syncDomainCert(token, this.domainId);
			if (!sync.success) {
				this.statusMsg = sync.error || 'sync-cert failed';
				this.busy = false;
				this.render();
				return;
			}
			this.applySslHints(sync);
			// Only treat as done when control plane activated (DB status flipped)
			if (sync.activated || sync.status === 'active') {
				this.busy = false;
				await this.onActivated();
				return;
			}
			// CF may report ssl active a beat before DB write — one forced retry
			if (sync.sslStatus === 'active') {
				const again = await foundry.syncDomainCert(token, this.domainId);
				if (again.success && (again.activated || again.status === 'active')) {
					this.busy = false;
					await this.onActivated();
					return;
				}
			}
			this.statusMsg = `SSL: ${sync.sslStatus || 'pending'} · cert_status: ${sync.status || '—'}. Add ACME TXT below if still pending.`;
			this.step = 'ssl';
			this.render();
			if (i < max - 1) await sleep(5000);
		}
		this.busy = false;
		this.statusMsg =
			'Still provisioning. Confirm ACME TXT is live (dig TXT _acme-challenge.…), wait 1–2 min, Refresh again.';
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
		this.statusMsg = '';
		new Notice(
			`Domain ${this.hostnameInput} is active — publish again (baseURL=/). Open https://${this.hostnameInput}/`,
			6000,
		);
		this.render();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

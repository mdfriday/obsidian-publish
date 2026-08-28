<script lang="ts">
	import { Notice } from 'obsidian';
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let projectName: string;
	/** Called when domain becomes active so parent can refresh publish URL */
	export let onDomainActive: ((hostname: string) => void) | undefined = undefined;

	type DomainStep = 'idle' | 'hostname' | 'dns' | 'ssl' | 'done';

	let expanded = false;
	let loading = false;
	let busy = false;
	let statusMsg = '';
	let step: DomainStep = 'idle';
	let remoteProjectId: string | null = null;
	let hostnameInput = '';
	let domainId: string | null = null;
	let activeHostname: string | null = null;
	let domainStatus = '';
	let certStatus = '';
	let txtName = '';
	let txtValue = '';
	let cnameTarget = '';
	let sslTxts: Array<{ txtName: string; txtValue: string; status?: string }> = [];
	let dcvCnames: Array<{ cname: string; cnameTarget: string }> = [];
	let sslStatus = '';

	$: canDomain =
		(plugin.settings.mdfQuotaFeatures || []).includes('custom_domain') ||
		['personal', 'pro'].includes((plugin.settings.mdfKeyPlan || '').toLowerCase());

	$: summaryLine = activeHostname
		? activeHostname
		: remoteProjectId
			? 'Not bound'
			: '—';

	async function toggle() {
		expanded = !expanded;
		if (expanded) {
			await refresh();
		}
	}

	async function resolveAuth(): Promise<string | null> {
		const mgr = plugin.projectServiceManager;
		if (!mgr) return null;
		const auth = await mgr.resolveAuthToken();
		return auth?.token ?? null;
	}

	async function refresh() {
		if (!projectName || !plugin.foundryPublishService) return;
		loading = true;
		statusMsg = '';
		try {
			const foundry = plugin.foundryPublishService;
			const bind = await foundry.getCloudflareBinding({
				workspacePath: plugin.absWorkspacePath,
				projectName,
			});
			if (!bind.success || !bind.cloudflareProjectId) {
				remoteProjectId = null;
				activeHostname = null;
				step = 'idle';
				return;
			}
			remoteProjectId = bind.cloudflareProjectId;
			const token = await resolveAuth();
			if (!token) {
				statusMsg = 'No MDF Key — publish once or open Account.';
				return;
			}
			const res = await foundry.listDomains(token, remoteProjectId);
			if (!res.success) {
				statusMsg = res.error || 'Failed to load domains';
				return;
			}
			const domains = res.domains || [];
			const active = domains.find(
				(d) => d.status === 'active' || d.certStatus === 'active',
			);
			const pending = domains.find(
				(d) => d.status !== 'active' && d.status !== 'removed',
			);
			if (active?.hostname) {
				activeHostname = active.hostname;
				domainId = active.id;
				domainStatus = active.status || 'active';
				certStatus = active.certStatus || 'active';
				step = 'done';
				hostnameInput = active.hostname;
			} else if (pending) {
				activeHostname = null;
				domainId = pending.id;
				hostnameInput = pending.hostname;
				domainStatus = pending.status || 'pending';
				certStatus = pending.certStatus || '';
				cnameTarget = res.cnameTarget || '';
				if (pending.ownershipToken) {
					txtValue = pending.ownershipToken;
					txtName = `_mdfriday-verify.${pending.hostname}`;
				}
				// Ownership pending → DNS; otherwise resume SSL
				const st = (pending.status || '').toLowerCase();
				step = st === 'pending' || st === 'verifying' || !st ? 'dns' : 'ssl';
				if (step === 'ssl') {
					await pollCert(false);
				}
			} else {
				activeHostname = null;
				domainId = null;
				step = canDomain ? 'hostname' : 'idle';
			}
		} finally {
			loading = false;
		}
	}

	function relativeHost(fqdn: string): string {
		const host = fqdn.replace(/\.$/, '').toLowerCase();
		const parts = host.split('.');
		if (parts.length >= 3) return parts.slice(0, -2).join('.');
		return host;
	}

	async function copyText(value: string) {
		if (!value) return;
		await navigator.clipboard.writeText(value);
		new Notice('Copied', 1500);
	}

	function applySslHints(sync: {
		sslStatus?: string | null;
		status?: string;
		validationRecords?: Array<{ txtName?: string; txtValue?: string; status?: string }>;
		dcvRecords?: Array<{ cname?: string; cnameTarget?: string }>;
	}) {
		sslStatus = sync.sslStatus || '';
		certStatus = sync.status || '';
		sslTxts = (sync.validationRecords || [])
			.filter((r) => r.txtName && r.txtValue)
			.map((r) => ({
				txtName: r.txtName!,
				txtValue: r.txtValue!,
				...(r.status ? { status: r.status } : {}),
			}));
		dcvCnames = (sync.dcvRecords || [])
			.filter((r) => r.cname && r.cnameTarget)
			.map((r) => ({ cname: r.cname!, cnameTarget: r.cnameTarget! }));
	}

	async function submitHostname() {
		const host = hostnameInput.trim().toLowerCase();
		if (!host || host.includes('/') || host.includes(' ')) {
			statusMsg = 'Enter a valid hostname (e.g. www.example.com).';
			return;
		}
		const foundry = plugin.foundryPublishService;
		if (!foundry || !remoteProjectId) return;
		const token = await resolveAuth();
		if (!token) {
			statusMsg = 'No MDF Key';
			return;
		}
		busy = true;
		statusMsg = 'Creating domain…';
		const res = await foundry.addDomain(token, remoteProjectId, host);
		busy = false;
		if (!res.success) {
			statusMsg =
				res.code === 'plan_required'
					? 'Custom domains require Personal. Upgrade from Account.'
					: res.error || 'Failed to add domain';
			return;
		}
		domainId = res.id || null;
		txtName = res.txtName || '';
		txtValue = res.txtValue || '';
		cnameTarget = res.cnameTarget || '';
		hostnameInput = res.hostname || host;
		step = 'dns';
		statusMsg = '';
	}

	async function runVerify() {
		const foundry = plugin.foundryPublishService;
		if (!foundry || !domainId) return;
		const token = await resolveAuth();
		if (!token) return;
		busy = true;
		statusMsg = 'Checking ownership…';
		const verified = await foundry.verifyDomain(token, domainId);
		busy = false;
		if (!verified.success) {
			statusMsg = verified.error || 'Verify failed — is ownership TXT published?';
			return;
		}
		if (verified.activated) {
			await onActivated();
			return;
		}
		applySslHints(verified);
		step = 'ssl';
		statusMsg = 'Ownership verified. Add SSL records below, then Refresh.';
		await pollCert(false);
	}

	async function pollCert(loop: boolean) {
		const foundry = plugin.foundryPublishService;
		if (!foundry || !domainId) return;
		const token = await resolveAuth();
		if (!token) return;
		busy = true;
		const max = loop ? 12 : 1;
		for (let i = 0; i < max; i++) {
			statusMsg = `Checking certificate… (${i + 1}/${max})`;
			const sync = await foundry.syncDomainCert(token, domainId);
			if (!sync.success) {
				statusMsg = sync.error || 'sync-cert failed';
				busy = false;
				return;
			}
			applySslHints(sync);
			if (sync.activated || sync.status === 'active') {
				busy = false;
				await onActivated();
				return;
			}
			if (sync.sslStatus === 'active') {
				const again = await foundry.syncDomainCert(token, domainId);
				if (again.success && (again.activated || again.status === 'active')) {
					busy = false;
					await onActivated();
					return;
				}
			}
			domainStatus = sync.status || domainStatus;
			if (i < max - 1) {
				await new Promise((r) => setTimeout(r, 5000));
			}
		}
		busy = false;
		statusMsg =
			'Still provisioning. Confirm DNS is live, wait 1–2 min, then Refresh again.';
	}

	async function onActivated() {
		const foundry = plugin.foundryPublishService;
		if (foundry && projectName) {
			await foundry.markBindingCustom({
				workspacePath: plugin.absWorkspacePath,
				projectName,
				hostname: hostnameInput,
			});
		}
		activeHostname = hostnameInput;
		domainStatus = 'active';
		certStatus = 'active';
		step = 'done';
		statusMsg = '';
		new Notice(
			`Domain ${hostnameInput} is active — publish again so the site URL uses https://${hostnameInput}/`,
			6000,
		);
		onDomainActive?.(hostnameInput);
	}

	async function openAccountUpgrade() {
		await plugin.openAccountInBrowser();
	}
</script>

<div class="capability-section">
	<button
		type="button"
		class="subsection-toggle"
		on:click={toggle}
		aria-expanded={expanded}
	>
		<svg
			class="collapse-icon"
			class:is-collapsed={!expanded}
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<polyline points="6 9 12 15 18 9"></polyline>
		</svg>
		<span class="setting-item-name">Domain</span>
		<span class="capability-summary">{summaryLine}</span>
	</button>

	{#if expanded}
		<div class="capability-body">
			{#if loading}
				<p class="field-hint">Loading…</p>
			{:else if !remoteProjectId}
				<p class="field-hint">Publish this site once to bind a custom domain.</p>
			{:else if !canDomain && step !== 'done'}
				<p class="field-hint">
					Custom domains require Personal. After binding, publish URL becomes your hostname.
				</p>
				<button class="mod-cta" on:click={openAccountUpgrade}>Upgrade…</button>
			{:else if step === 'done' && activeHostname}
				<p class="domain-active-line">
					https://{activeHostname}/ · {certStatus || 'active'}
				</p>
				<p class="field-hint">
					Publish again so the site rebuilds with baseURL=/ and visitors use this hostname.
				</p>
				<button class="action-button" on:click={refresh} disabled={busy}>Refresh status</button>
			{:else if step === 'hostname'}
				<label class="section-label" for="domain-hostname">Hostname</label>
				<input
					id="domain-hostname"
					class="form-input"
					type="text"
					placeholder="www.example.com"
					bind:value={hostnameInput}
					disabled={busy}
				/>
				<button class="mod-cta" on:click={submitHostname} disabled={busy}>
					Continue
				</button>
			{:else if step === 'dns'}
				<p class="field-hint">Add these at your DNS provider, wait a minute, then Verify.</p>
				<div class="dns-row">
					<span class="dns-label">TXT name</span>
					<code class="dns-value">{txtName || '—'}</code>
					<button type="button" class="url-action-btn" on:click={() => copyText(txtName)}>Copy</button>
				</div>
				<div class="dns-row">
					<span class="dns-label">TXT value</span>
					<code class="dns-value">{txtValue || '—'}</code>
					<button type="button" class="url-action-btn" on:click={() => copyText(txtValue)}>Copy</button>
				</div>
				<div class="dns-row">
					<span class="dns-label">CNAME host</span>
					<code class="dns-value">{relativeHost(hostnameInput)}</code>
					<button type="button" class="url-action-btn" on:click={() => copyText(relativeHost(hostnameInput))}>Copy</button>
				</div>
				<div class="dns-row">
					<span class="dns-label">CNAME target</span>
					<code class="dns-value">{cnameTarget || '—'}</code>
					<button type="button" class="url-action-btn" on:click={() => copyText(cnameTarget)}>Copy</button>
				</div>
				<button class="mod-cta" on:click={runVerify} disabled={busy}>
					I added DNS — Verify
				</button>
			{:else if step === 'ssl'}
				<p class="field-hint">
					SSL: {sslStatus || '—'} · cert: {certStatus || 'provisioning'}
				</p>
				{#if dcvCnames.length}
					{#each dcvCnames as d}
						<div class="dns-row">
							<span class="dns-label">DCV CNAME</span>
							<code class="dns-value">{d.cname}</code>
							<button type="button" class="url-action-btn" on:click={() => copyText(d.cname)}>Copy</button>
						</div>
						<div class="dns-row">
							<span class="dns-label">DCV target</span>
							<code class="dns-value">{d.cnameTarget.replace(/\.$/, '')}</code>
							<button type="button" class="url-action-btn" on:click={() => copyText(d.cnameTarget.replace(/\.$/, ''))}>Copy</button>
						</div>
					{/each}
				{:else if sslTxts.length}
					{#each sslTxts as r, i}
						<div class="dns-row">
							<span class="dns-label">ACME TXT #{i + 1}</span>
							<code class="dns-value">{r.txtName}</code>
							<button type="button" class="url-action-btn" on:click={() => copyText(r.txtName)}>Copy</button>
						</div>
						<div class="dns-row">
							<span class="dns-label">Value #{i + 1}</span>
							<code class="dns-value">{r.txtValue}</code>
							<button type="button" class="url-action-btn" on:click={() => copyText(r.txtValue)}>Copy</button>
						</div>
					{/each}
				{/if}
				<div class="capability-actions">
					<button class="mod-cta" on:click={() => pollCert(false)} disabled={busy}>Refresh cert</button>
					<button class="action-button" on:click={() => pollCert(true)} disabled={busy}>Poll 1 min</button>
				</div>
			{:else}
				<button class="mod-cta" on:click={() => (step = 'hostname')}>Bind domain</button>
			{/if}

			{#if statusMsg}
				<p class="mod-warning capability-status">{statusMsg}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.domain-active-line {
		margin: 0;
		font-size: 13px;
		color: var(--mdf-primary, var(--interactive-accent));
		word-break: break-all;
	}

	.dns-row {
		display: grid;
		grid-template-columns: 88px 1fr auto;
		gap: 6px;
		align-items: center;
		font-size: 11px;
	}

	.dns-label {
		color: var(--text-muted);
	}

	.dns-value {
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: var(--background-primary);
		padding: 4px 6px;
		border-radius: 3px;
	}

	.capability-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.capability-status {
		margin: 0;
		font-size: 12px;
	}

	.section-label {
		font-size: 12px;
		font-weight: 500;
	}

	.form-input {
		width: 100%;
		padding: 6px 10px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		box-sizing: border-box;
	}
</style>

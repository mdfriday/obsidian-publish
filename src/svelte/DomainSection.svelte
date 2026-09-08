<script lang="ts">
	import { Notice } from 'obsidian';
	import { onMount } from 'svelte';
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let projectName: string;
	/** Called when domain becomes active so parent can refresh publish URL */
	export let onDomainActive: ((hostname: string) => void) | undefined = undefined;
	/** `embedded` = always expanded inside Advanced card (no fold chrome) */
	export let layout: 'fold' | 'embedded' = 'fold';

	type DomainStep = 'idle' | 'hostname' | 'dns' | 'ssl' | 'done';

	let expanded = layout === 'embedded';
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

	$: t = plugin.i18n?.t || ((key: string) => key);
	$: hasKey = !!plugin.settings.mdfKey;
	$: domainStatusKey = (() => {
		const st = `${domainStatus} ${certStatus} ${sslStatus}`.toLowerCase();
		const looksError =
			/\b(fail|error|invalid|expired|misconfig)/.test(st) ||
			sslStatus.toLowerCase().includes('fail');
		if (activeHostname) return 'active' as const;
		if (domainId || step === 'dns' || step === 'ssl') {
			return looksError ? ('error' as const) : ('pending' as const);
		}
		if (!hasKey) return 'need_auth' as const;
		if (!remoteProjectId) return 'publish_first' as const;
		if (!canDomain) return 'upgrade' as const;
		return 'not_configured' as const;
	})();
	$: summaryLine =
		domainStatusKey === 'active'
			? activeHostname || t('ui.domain_status_active')
			: domainStatusKey === 'pending'
				? t('ui.domain_status_pending')
				: domainStatusKey === 'error'
					? t('ui.domain_status_error')
					: domainStatusKey === 'need_auth'
						? t('ui.domain_status_need_auth')
						: domainStatusKey === 'publish_first'
							? t('ui.domain_status_publish_first')
							: domainStatusKey === 'upgrade'
								? t('ui.domain_status_upgrade')
								: t('ui.domain_status_not_configured');
	$: domainTitle = t('ui.custom_domain');

	$: if (layout === 'embedded' && !expanded) {
		expanded = true;
	}

	onMount(() => {
		if (layout === 'embedded' && projectName) void refresh();
	});

	let prevDomainProject = '';
	$: if (projectName !== prevDomainProject) {
		prevDomainProject = projectName;
		if (projectName) {
			void refresh();
		} else {
			remoteProjectId = null;
			activeHostname = null;
			domainId = null;
			hostnameInput = '';
			domainStatus = '';
			certStatus = '';
			sslStatus = '';
			txtName = '';
			txtValue = '';
			cnameTarget = '';
			sslTxts = [];
			dcvCnames = [];
			step = 'idle';
			statusMsg = '';
		}
	}

	async function toggle() {
		if (layout === 'embedded') return;
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

	async function revokeDomain() {
		if (!domainId || !plugin.foundryPublishService) return;
		const ok = confirm(
			`Remove custom domain ${activeHostname || hostnameInput}? Share URL will be used again after the next publish.`,
		);
		if (!ok) return;
		const token = await resolveAuth();
		if (!token) {
			statusMsg = 'No MDF Key';
			return;
		}
		busy = true;
		statusMsg = 'Removing domain…';
		const foundry = plugin.foundryPublishService;
		const res = await foundry.removeDomain(token, domainId);
		if (!res.success) {
			busy = false;
			statusMsg = res.error || 'Failed to remove domain';
			return;
		}
		if (projectName) {
			await foundry.markBindingShare({
				workspacePath: plugin.absWorkspacePath,
				projectName,
				publicBaseUrl: plugin.settings.cloudflarePublicBaseUrl,
			});
		}
		busy = false;
		domainId = null;
		activeHostname = null;
		hostnameInput = '';
		step = canDomain ? 'hostname' : 'idle';
		statusMsg = '';
		new Notice('Custom domain removed', 3000);
		await refresh();
	}

	$: cnameHost = hostnameInput ? relativeHost(hostnameInput) : 'notes';
	$: displayCnameTarget = cnameTarget || 'publish.mdfriday.com';
	$: dnsStatusLine = activeHostname
		? `Bound · ${certStatus || domainStatus || 'active'}`
		: domainStatus
			? `DNS: ${domainStatus}${certStatus ? ` · cert ${certStatus}` : ''}`
			: '';
</script>

<div class="capability-section mdf-fold" class:is-embedded={layout === 'embedded'}>
	{#if layout !== 'embedded'}
	<button
		type="button"
		class="subsection-toggle mdf-fold-toggle"
		on:click={toggle}
		aria-expanded={expanded}
	>
		<span class="setting-item-name">{domainTitle}</span>
		<span class="capability-summary">{summaryLine}</span>
		<svg
			class="mdf-fold-chevron"
			class:is-open={expanded}
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<polyline points="9 18 15 12 9 6"></polyline>
		</svg>
	</button>
	{/if}

	{#if expanded || layout === 'embedded'}
		<div class="capability-body">
			{#if layout === 'embedded'}
				<div class="embedded-status">
					<span class="domain-status" class:bound={!!activeHostname}>
						{activeHostname ? `${t('ui.domain_bound')} ${activeHostname}` : summaryLine}
					</span>
				</div>
			{/if}
			{#if loading}
				<p class="field-hint">Loading…</p>
			{:else if !hasKey}
				<p class="field-hint">{t('ui.domain_need_auth_hint')}</p>
				<button class="mod-cta" on:click={openAccountUpgrade}>{t('ui.account_go_verify')}</button>
			{:else if !remoteProjectId}
				<p class="field-hint">{t('ui.domain_publish_first_hint')}</p>
			{:else if !canDomain && step !== 'done'}
				<p class="field-hint">{t('ui.domain_upgrade_hint')}</p>
				<button class="mod-cta" on:click={openAccountUpgrade}>{t('ui.account_upgrade_personal')}</button>
			{:else}
				{#if step !== 'done'}
					<label class="section-label" for="domain-hostname">Domain</label>
					<input
						id="domain-hostname"
						class="form-input"
						type="text"
						placeholder="notes.example.com"
						bind:value={hostnameInput}
						disabled={busy || step === 'ssl'}
					/>
					{#if step === 'hostname' || step === 'idle'}
						<button class="mod-cta" on:click={submitHostname} disabled={busy}>
							Continue
						</button>
					{/if}
				{/if}

				{#if step === 'dns' || step === 'ssl'}
					<div class="dns-guide">
						<div class="dns-guide-title">DNS setup</div>
						<table class="dns-table">
							<thead>
								<tr>
									<th>Type</th>
									<th>Name</th>
									<th>Value</th>
									<th>Note</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>CNAME</td>
									<td>
										<code>{cnameHost}</code>
										<button type="button" class="copy-mini" on:click={() => copyText(cnameHost)}>Copy</button>
									</td>
									<td>
										<code>{displayCnameTarget}</code>
										<button type="button" class="copy-mini" on:click={() => copyText(displayCnameTarget)}>Copy</button>
									</td>
									<td>Required</td>
								</tr>
								{#if txtName && txtValue}
									<tr>
										<td>TXT</td>
										<td>
											<code>{txtName}</code>
											<button type="button" class="copy-mini" on:click={() => copyText(txtName)}>Copy</button>
										</td>
										<td>
											<code>{txtValue}</code>
											<button type="button" class="copy-mini" on:click={() => copyText(txtValue)}>Copy</button>
										</td>
										<td>Verify</td>
									</tr>
								{/if}
							</tbody>
						</table>
						<ol class="dns-steps">
							<li>Add the records at your DNS provider</li>
							<li>Wait for propagation (usually 5–30 minutes)</li>
							<li>Click Verify DNS</li>
						</ol>
						<div class="capability-actions">
							<button class="action-button" on:click={refresh} disabled={busy}>Check status</button>
							<button class="mod-cta" on:click={runVerify} disabled={busy}>Verify DNS</button>
						</div>
						{#if dnsStatusLine}
							<p class="dns-status">{dnsStatusLine}</p>
						{/if}
					</div>
				{/if}

				{#if step === 'ssl'}
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
				{/if}

				{#if step === 'done' && activeHostname}
					<div class="domain-bound">
						<div class="domain-bound-left">
							<span class="domain-check">✓</span>
							<span>Bound {activeHostname}</span>
							<a
								class="domain-open"
								href={`https://${activeHostname}/`}
								target="_blank"
								rel="noopener"
								title="Open"
							>↗</a>
						</div>
						<button
							class="action-button"
							type="button"
							on:click={revokeDomain}
							disabled={busy}
						>
							Revoke
						</button>
					</div>
					<p class="field-hint">
						Publish again so the site rebuilds with baseURL=/ and visitors use this hostname.
					</p>
					<button class="action-button" on:click={refresh} disabled={busy}>Check status</button>
				{/if}
			{/if}

			{#if statusMsg}
				<p class="mod-warning capability-status">{statusMsg}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.capability-sep {
		flex-shrink: 0;
		margin: 0 2px;
		color: var(--text-muted);
		font-weight: 400;
	}

	.capability-summary {
		margin-left: auto;
		font-size: 13px;
		color: var(--mdf-muted, #4d4f67);
		font-weight: 500;
		max-width: 55%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: right;
	}

	.mdf-fold-chevron {
		flex-shrink: 0;
		margin-left: 8px;
		color: var(--mdf-hint, #8b8fa3);
		transition: transform 0.12s ease;
	}

	.mdf-fold-chevron.is-open {
		transform: rotate(90deg);
	}

	.domain-bound {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary);
		font-size: 12px;
	}

	.domain-bound-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex-wrap: wrap;
	}

	.domain-check {
		color: var(--text-success);
		font-weight: 700;
	}

	.domain-open {
		color: var(--interactive-accent);
		text-decoration: none;
	}

	.dns-guide {
		margin-top: 10px;
		padding: 10px;
		border: 1px dashed var(--background-modifier-border);
		border-radius: 6px;
	}

	.dns-guide-title {
		font-size: 12px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	.dns-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
		margin-bottom: 8px;
	}

	.dns-table th,
	.dns-table td {
		border: 1px solid var(--background-modifier-border);
		padding: 4px 6px;
		text-align: left;
		vertical-align: top;
		word-break: break-all;
	}

	.dns-table th {
		color: var(--text-muted);
		font-weight: 500;
		background: var(--background-primary);
	}

	.dns-table code {
		font-size: 10px;
	}

	.copy-mini {
		display: inline;
		margin-left: 4px;
		padding: 0;
		border: none;
		background: none;
		color: var(--interactive-accent);
		font-size: 10px;
		cursor: pointer;
	}

	.dns-steps {
		margin: 0 0 10px;
		padding-left: 18px;
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.45;
	}

	.dns-status {
		margin: 8px 0 0;
		font-size: 11px;
		color: var(--text-muted);
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
		margin-bottom: 8px;
	}
</style>

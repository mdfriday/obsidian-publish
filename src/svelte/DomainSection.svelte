<script lang="ts">
	import { Notice } from 'obsidian';
	import { onMount } from 'svelte';
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let projectName: string;
	/** Called when domain becomes active so parent can refresh publish URL */
	export let onDomainActive: ((hostname: string) => void) | undefined = undefined;
	/** Called after successful unbind so parent can leave custom hostname URL */
	export let onDomainCleared: (() => void) | undefined = undefined;
	/** `embedded` = always expanded inside Advanced card (no fold chrome) */
	export let layout: 'fold' | 'embedded' = 'fold';

	type DomainStep = 'idle' | 'hostname' | 'dns' | 'ssl' | 'done';

	let expanded = layout === 'embedded';
	let loading = false;
	let busy = false;
	let statusMsg = '';
	let statusMsgError = false;
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
	let showHostAdvanced = false;

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
			clearStatus();
		}
	}

	function setStatus(msg: string, error = false) {
		statusMsg = msg;
		statusMsgError = error;
	}

	function clearStatus() {
		statusMsg = '';
		statusMsgError = false;
	}

	/** Cert poll: Cloudflare SaaS often needs 1–5+ min; 30s balances UX vs API load. */
	const CERT_POLL_INTERVAL_MS = 30_000;
	const CERT_POLL_ROUNDS = 12;

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
		clearStatus();
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
				setStatus(t('ui.domain_need_auth_hint'), true);
				return;
			}
			const res = await foundry.listDomains(token, remoteProjectId);
			if (!res.success) {
				setStatus(res.error || 'Failed to load domains', true);
				return;
			}
			const domains = (res.domains || []).filter((d) => {
				const st = (d.status || '').toLowerCase();
				return st !== 'removed' && st !== 'unbound';
			});
			const active = domains.find((d) => (d.status || '').toLowerCase() === 'active');
			const pending = domains.find((d) => (d.status || '').toLowerCase() !== 'active');
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
				const st = (pending.status || '').toLowerCase();
				step = st === 'pending' || st === 'verifying' || !st ? 'dns' : 'ssl';
				if (step === 'ssl') {
					await pollCert(false);
				}
			} else {
				resetLocalDomainState(canDomain ? 'hostname' : 'idle');
			}
		} finally {
			loading = false;
		}
	}

	/** Registrar host column: strip apex (assumes 2-label TLD like example.com). */
	function relativeHost(fqdn: string): string {
		const host = fqdn.replace(/\.$/, '').toLowerCase();
		const parts = host.split('.').filter(Boolean);
		if (parts.length >= 3) return parts.slice(0, -2).join('.');
		return host;
	}

	async function copyText(value: string) {
		if (!value) return;
		await navigator.clipboard.writeText(value);
		new Notice(t('ui.domain_copied'), 1500);
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
			setStatus(t('ui.domain_step1_hint'));
			return;
		}
		const foundry = plugin.foundryPublishService;
		if (!foundry || !remoteProjectId) return;
		const token = await resolveAuth();
		if (!token) {
			setStatus(t('ui.domain_need_auth_hint'), true);
			return;
		}
		busy = true;
		clearStatus();
		const res = await foundry.addDomain(token, remoteProjectId, host);
		busy = false;
		if (!res.success) {
			if (res.code === 'plan_required') {
				setStatus(t('ui.domain_upgrade_hint'), true);
			} else if (res.code === 'conflict' && res.details?.reason === 'bound_other_project') {
				const title = String(res.details.boundProjectTitle || res.details.boundProjectId || '');
				setStatus(t('ui.domain_conflict_other_project').replace('{{title}}', title), true);
			} else {
				setStatus(res.error || 'Failed to add domain', true);
			}
			return;
		}
		domainId = res.id || null;
		hostnameInput = res.hostname || host;
		cnameTarget = res.cnameTarget || cnameTarget;
		if (res.mode === 'rebind' || res.mode === 'already_bound' || res.activated) {
			await onActivated();
			return;
		}
		txtName = res.txtName || '';
		txtValue = res.txtValue || '';
		domainStatus = res.status || 'pending';
		const st = (res.status || '').toLowerCase();
		if (res.mode === 'resume' && st && st !== 'pending' && st !== 'verifying') {
			step = 'ssl';
			clearStatus();
			await pollCert(false);
			return;
		}
		step = 'dns';
		clearStatus();
	}

	async function runVerify() {
		const foundry = plugin.foundryPublishService;
		if (!foundry || !domainId) return;
		const token = await resolveAuth();
		if (!token) return;
		busy = true;
		clearStatus();
		const verified = await foundry.verifyDomain(token, domainId);
		busy = false;
		if (!verified.success) {
			setStatus(verified.error || t('ui.domain_status_error'), true);
			return;
		}
		if (verified.activated) {
			await onActivated();
			return;
		}
		applySslHints(verified);
		step = 'ssl';
		clearStatus();
		await pollCert(false);
	}

	async function pollCert(loop: boolean) {
		const foundry = plugin.foundryPublishService;
		if (!foundry || !domainId) return;
		const token = await resolveAuth();
		if (!token) return;
		busy = true;
		const max = loop ? CERT_POLL_ROUNDS : 1;
		for (let i = 0; i < max; i++) {
			setStatus(`${t('ui.domain_https_wait')} (${i + 1}/${max})`);
			const sync = await foundry.syncDomainCert(token, domainId);
			if (!sync.success) {
				setStatus(sync.error || 'sync-cert failed', true);
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
				await new Promise((r) => setTimeout(r, CERT_POLL_INTERVAL_MS));
			}
		}
		busy = false;
		if (dcvCnames.length || sslTxts.length) {
			clearStatus();
		} else {
			setStatus(t('ui.domain_https_records_missing'));
		}
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
		clearStatus();
		new Notice(
			`${t('ui.domain_bound_label')} ${hostnameInput} — ${t('ui.domain_done_hint')}`,
			6000,
		);
		onDomainActive?.(hostnameInput);
	}

	async function openAccountUpgrade() {
		await plugin.openAccountInBrowser({ intent: 'upgrade' });
	}

	function resetLocalDomainState(next: DomainStep) {
		domainId = null;
		activeHostname = null;
		hostnameInput = '';
		domainStatus = '';
		certStatus = '';
		sslStatus = '';
		txtName = '';
		txtValue = '';
		cnameTarget = '';
		sslTxts = [];
		dcvCnames = [];
		step = next;
		clearStatus();
	}

	async function revokeDomain() {
		if (!domainId || !plugin.foundryPublishService) return;
		const ok = confirm(
			t('ui.domain_unbind_confirm').replace(
				'{{host}}',
				activeHostname || hostnameInput || '',
			),
		);
		if (!ok) return;
		const token = await resolveAuth();
		if (!token) {
			setStatus(t('ui.domain_need_auth_hint'), true);
			return;
		}
		busy = true;
		clearStatus();
		const foundry = plugin.foundryPublishService;
		const removingId = domainId;
		const res = await foundry.removeDomain(token, removingId);
		if (!res.success) {
			busy = false;
			setStatus(res.error || 'Failed to unbind domain', true);
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
		resetLocalDomainState(canDomain ? 'hostname' : 'idle');
		onDomainCleared?.();
		new Notice(t('ui.domain_unbind_done'), 3000);
		await refresh();
	}

	$: cnameHost = hostnameInput ? relativeHost(hostnameInput) : 'www';
	$: displayCnameTarget = (cnameTarget || 'cname.sure40.com').replace(/\.$/, '');
	$: txtHost = txtName ? relativeHost(txtName) : '';
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
						{activeHostname
							? `${t('ui.domain_bound_label')} ${activeHostname}`
							: summaryLine}
					</span>
				</div>
			{/if}
			{#if loading}
				<p class="field-hint">…</p>
			{:else if !hasKey}
				<p class="field-hint">{t('ui.domain_need_auth_hint')}</p>
				<button class="btn btn-primary" on:click={openAccountUpgrade}>{t('ui.account_go_verify')}</button>
			{:else if !remoteProjectId}
				<p class="field-hint">{t('ui.domain_publish_first_hint')}</p>
			{:else if !canDomain && step !== 'done'}
				<p class="field-hint">{t('ui.domain_upgrade_hint')}</p>
				<button class="btn btn-primary" on:click={openAccountUpgrade}>{t('ui.account_upgrade_personal')}</button>
			{:else}
				{#if step === 'hostname' || step === 'idle'}
					<div class="dns-guide">
						<div class="dns-guide-title">{t('ui.domain_step1_title')}</div>
						<p class="field-hint">{t('ui.domain_step1_hint')}</p>
						<label class="section-label" for="domain-hostname">{t('ui.domain_input_label')}</label>
						<input
							id="domain-hostname"
							class="form-input"
							type="text"
							placeholder="www.example.com"
							bind:value={hostnameInput}
							disabled={busy}
						/>
						<button class="btn btn-primary" on:click={submitHostname} disabled={busy}>
							{t('ui.domain_step1_cta')}
						</button>
					</div>
				{/if}

				{#if step === 'dns'}
					<div class="dns-guide">
						<div class="dns-guide-title">{t('ui.domain_step2_title')}</div>
						<p class="dns-host-hint">{t('ui.domain_host_hint')}</p>
						<button
							type="button"
							class="copy-mini dns-advanced-toggle"
							on:click={() => (showHostAdvanced = !showHostAdvanced)}
						>
							{showHostAdvanced ? '▾' : '▸'} {t('ui.domain_host_hint_advanced')}
						</button>
						{#if showHostAdvanced}
							<p class="field-hint">{t('ui.domain_host_hint_advanced')}</p>
						{/if}
						<table class="dns-table">
							<thead>
								<tr>
									<th>{t('ui.domain_type_col')}</th>
									<th>{t('ui.domain_host_col')}</th>
									<th>{t('ui.domain_value_col')}</th>
									<th>{t('ui.domain_note_col')}</th>
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
									<td>{t('ui.domain_note_point')}</td>
								</tr>
								{#if txtHost && txtValue}
									<tr>
										<td>TXT</td>
										<td>
											<code>{txtHost}</code>
											<button type="button" class="copy-mini" on:click={() => copyText(txtHost)}>Copy</button>
										</td>
										<td>
											<code>{txtValue}</code>
											<button type="button" class="copy-mini" on:click={() => copyText(txtValue)}>Copy</button>
										</td>
										<td>{t('ui.domain_note_verify')}</td>
									</tr>
								{/if}
							</tbody>
						</table>
						<ol class="dns-steps">
							<li>{t('ui.domain_step2_li1')}</li>
							<li>{t('ui.domain_step2_li2')}</li>
							<li>{t('ui.domain_step2_li3')}</li>
						</ol>
						<div class="capability-actions">
							<button class="btn btn-primary" on:click={runVerify} disabled={busy}>
								{t('ui.domain_verify_cta')}
							</button>
						</div>
					</div>
				{/if}

				{#if step === 'ssl'}
					<div class="dns-guide">
						<div class="dns-guide-title">{t('ui.domain_step3_title')}</div>
						<p class="field-hint">{t('ui.domain_https_hint')}</p>
						{#if dcvCnames.length || sslTxts.length}
							<p class="dns-host-hint">{t('ui.domain_host_hint')}</p>
							<table class="dns-table">
								<thead>
									<tr>
										<th>{t('ui.domain_type_col')}</th>
										<th>{t('ui.domain_host_col')}</th>
										<th>{t('ui.domain_value_col')}</th>
										<th>{t('ui.domain_note_col')}</th>
									</tr>
								</thead>
								<tbody>
									{#each dcvCnames as d}
										<tr>
											<td>CNAME</td>
											<td>
												<code>{relativeHost(d.cname)}</code>
												<button
													type="button"
													class="copy-mini"
													on:click={() => copyText(relativeHost(d.cname))}
												>Copy</button>
											</td>
											<td>
												<code>{d.cnameTarget.replace(/\.$/, '')}</code>
												<button
													type="button"
													class="copy-mini"
													on:click={() => copyText(d.cnameTarget.replace(/\.$/, ''))}
												>Copy</button>
											</td>
											<td>{t('ui.domain_note_https')}</td>
										</tr>
									{/each}
									{#if !dcvCnames.length}
										{#each sslTxts as r}
											<tr>
												<td>TXT</td>
												<td>
													<code>{relativeHost(r.txtName)}</code>
													<button
														type="button"
														class="copy-mini"
														on:click={() => copyText(relativeHost(r.txtName))}
													>Copy</button>
												</td>
												<td>
													<code>{r.txtValue}</code>
													<button type="button" class="copy-mini" on:click={() => copyText(r.txtValue)}>Copy</button>
												</td>
												<td>{t('ui.domain_note_https')}</td>
											</tr>
										{/each}
									{/if}
								</tbody>
							</table>
							<p class="dns-status">{t('ui.domain_https_wait')}</p>
						{:else}
							<p class="field-hint">{t('ui.domain_https_records_loading')}</p>
						{/if}
						<div class="capability-actions">
							<button class="btn btn-primary" on:click={() => pollCert(false)} disabled={busy}>
								{t('ui.domain_refresh_status')}
							</button>
							<button class="btn btn-secondary" on:click={() => pollCert(true)} disabled={busy}>
								{t('ui.domain_wait_refresh')}
							</button>
						</div>
					</div>
				{/if}

				{#if step === 'done' && activeHostname}
					<div class="domain-bound">
						<div class="domain-bound-left">
							<span class="domain-check">✓</span>
							<span>{t('ui.domain_bound_label')} {activeHostname}</span>
							<a
								class="domain-open"
								href={`https://${activeHostname}/`}
								target="_blank"
								rel="noopener"
								title="Open"
							>↗</a>
						</div>
						<button
							class="btn btn-secondary"
							type="button"
							on:click={revokeDomain}
							disabled={busy}
						>
							{t('ui.domain_revoke')}
						</button>
					</div>
					<p class="field-hint">{t('ui.domain_done_hint')}</p>
				{/if}
			{/if}

			{#if statusMsg}
				<p class="capability-status" class:is-error={statusMsgError}>{statusMsg}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
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

	.dns-host-hint {
		margin: 0 0 8px;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-muted);
	}

	.dns-advanced-toggle {
		display: block;
		margin: 0 0 8px;
		text-align: left;
		opacity: 0.85;
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
		margin: 8px 0;
		font-size: 11px;
		color: var(--text-muted);
	}

	.capability-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.capability-status {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.capability-status.is-error {
		color: var(--text-error, var(--text-accent));
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

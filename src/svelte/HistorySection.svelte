<script lang="ts">
	import { Notice } from 'obsidian';
	import type FridayPlugin from '../main';
	import { computeShareBaseUrl } from '../services/project';

	export let plugin: FridayPlugin;
	export let projectName: string;
	export let onRolledBack: (() => void) | undefined = undefined;
	/** Same as publish-tab revoke: take live share offline. */
	export let onUnpublish: (() => void | Promise<void>) | undefined = undefined;
	/** Bump after publish success to reload release count without expanding. */
	export let refreshKey: number = 0;
	/** `tab` = always expanded (Apple history tab); `fold` = collapsible section */
	export let layout: 'fold' | 'tab' = 'fold';
	/**
	 * Local plan gate (no network). Personal/Pro can rollback without a custom domain.
	 * When false, show upgrade hint and disable rollback.
	 */
	export let canRollback: boolean = false;

	type ReleaseRow = {
		id: string;
		seq: number;
		state: string;
		publishedAt?: number | null;
		fileCount?: number;
		totalBytes?: number;
	};

	let expanded = layout === 'tab';
	let loading = false;
	let busy = false;
	/** Release id currently rolling back — drives in-button label. */
	let rollingBackId: string | null = null;
	let statusMsg = '';
	let remoteProjectId: string | null = null;
	let liveReleaseId: string | null = null;
	let publicUrl = '';
	let releases: ReleaseRow[] = [];

	$: published = releases.filter(
		(r) => r.state === 'published' || r.state === 'superseded',
	);
	$: summaryLine = String(published.length);
	$: isZh = (plugin.i18n?.getCurrentLanguage?.() || '').toLowerCase().startsWith('zh');

	let prevProjectName = '';
	let prevRefreshKey = -1;

	$: {
		const nameChanged = projectName !== prevProjectName;
		const keyChanged = refreshKey !== prevRefreshKey;
		if (projectName && (nameChanged || keyChanged)) {
			prevProjectName = projectName;
			prevRefreshKey = refreshKey;
			void refresh();
		}
	}

	async function toggle() {
		expanded = !expanded;
		if (expanded) {
			await refresh();
		}
	}

	$: if (layout === 'tab' && !expanded) {
		expanded = true;
	}

	async function resolveAuth(): Promise<string | null> {
		const mgr = plugin.projectServiceManager;
		if (!mgr) return null;
		const auth = await mgr.resolveAuthToken();
		return auth?.token ?? null;
	}

	function resolvePublicUrl(opts: {
		apiPublicUrl?: string;
		siteId?: string;
		bindingPublicBaseUrl?: string;
		hostingMode?: 'share' | 'custom';
	}): string {
		if (opts.apiPublicUrl) return opts.apiPublicUrl;
		const siteId = opts.siteId;
		if (siteId && opts.hostingMode !== 'custom') {
			const root =
				plugin.settings.cloudflarePublicBaseUrl ||
				opts.bindingPublicBaseUrl ||
				'https://share.fsky.top';
			return `${computeShareBaseUrl(root, siteId).replace(/\/$/, '')}/index.html`;
		}
		const bindBase = (opts.bindingPublicBaseUrl || '').replace(/\/?$/, '');
		if (bindBase.includes('/s/')) {
			return `${bindBase}/index.html`;
		}
		return '';
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
				releases = [];
				publicUrl = '';
				return;
			}
			remoteProjectId = bind.cloudflareProjectId;
			const token = await resolveAuth();
			if (!token) {
				statusMsg = 'No MDF Key';
				return;
			}
			const res = await foundry.listReleases(token, remoteProjectId);
			if (!res.success) {
				statusMsg = res.error || 'Failed to load history';
				return;
			}
			releases = res.releases || [];
			liveReleaseId = res.liveReleaseId ?? null;
			publicUrl = resolvePublicUrl({
				apiPublicUrl: res.publicUrl,
				siteId: res.siteId || bind.siteId,
				bindingPublicBaseUrl: bind.publicBaseUrl,
				hostingMode: res.hostingMode || (bind.hostingMode === 'custom' ? 'custom' : 'share'),
			});
		} finally {
			loading = false;
		}
	}

	function pad2(n: number): string {
		return n < 10 ? `0${n}` : String(n);
	}

	/** User-friendly card title: 今天 14:08 / Today 2:08 PM */
	function formatFriendlyTime(ms?: number | null): string {
		if (ms == null || !Number.isFinite(ms)) return '—';
		const d = new Date(ms);
		const now = new Date();
		const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		const dayDiff = Math.round((startToday - startThat) / 86400000);
		const hm = isZh
			? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
			: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

		if (dayDiff === 0) {
			return isZh ? `今天 ${hm}` : `Today ${hm}`;
		}
		if (dayDiff === 1) {
			return isZh ? `昨天 ${hm}` : `Yesterday ${hm}`;
		}
		if (isZh) {
			if (d.getFullYear() === now.getFullYear()) {
				return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
			}
			return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
		}
		if (d.getFullYear() === now.getFullYear()) {
			return `${d.toLocaleString(undefined, { month: 'short', day: 'numeric' })} ${hm}`;
		}
		return `${d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${hm}`;
	}

	function viewLive() {
		if (!publicUrl) {
			new Notice(
				plugin.i18n?.t?.('ui.history_no_url') || 'No public URL for this project yet.',
				3000,
			);
			return;
		}
		window.open(publicUrl, '_blank');
	}

	async function unpublishLive() {
		if (!onUnpublish) return;
		busy = true;
		try {
			await onUnpublish();
			liveReleaseId = null;
			await refresh();
		} finally {
			busy = false;
		}
	}

	async function rollback(release: ReleaseRow) {
		if (!canRollback) {
			new Notice(
				plugin.i18n?.t?.('ui.account_history_personal_only') ||
					'Rollback requires Personal',
				5000,
			);
			return;
		}
		if (release.id === liveReleaseId) {
			new Notice(plugin.i18n?.t?.('ui.history_already_live') || 'This release is already live.', 2500);
			return;
		}
		const label = formatFriendlyTime(release.publishedAt);
		const confirmTpl =
			plugin.i18n?.t?.('ui.history_rollback_confirm') ||
			'Roll back to「{{time}}」? The live site will be replaced by this version but stay public.';
		const ok = confirm(confirmTpl.replace('{{time}}', label));
		if (!ok) return;

		const foundry = plugin.foundryPublishService;
		if (!foundry || !remoteProjectId) return;
		const token = await resolveAuth();
		if (!token) return;

		busy = true;
		rollingBackId = release.id;
		statusMsg = '';
		try {
			const res = await foundry.rollbackRelease(token, remoteProjectId, release.id);
			if (!res.success) {
				new Notice(
					res.code === 'plan_required'
						? res.error || 'Rollback not available on this plan'
						: res.error || 'Rollback failed',
					5000,
				);
				return;
			}
			liveReleaseId = res.liveReleaseId || release.id;
			new Notice(
				plugin.i18n?.t?.('ui.history_rollback_done') || `Live traffic rolled back to ${label}`,
				4000,
			);
			await refresh();
			onRolledBack?.();
		} finally {
			busy = false;
			rollingBackId = null;
		}
	}

	function t(key: string, fallback: string): string {
		return plugin.i18n?.t?.(key) || fallback;
	}
</script>

<div class="capability-section mdf-fold" class:is-tab={layout === 'tab'}>
	{#if layout !== 'tab'}
		<button
			type="button"
			class="subsection-toggle mdf-fold-toggle"
			on:click={toggle}
			aria-expanded={expanded}
		>
			<span class="setting-item-name">{t('ui.history', 'History')}</span>
			<span class="history-count-badge">{summaryLine}</span>
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

	{#if expanded || layout === 'tab'}
		<div class="capability-body">
			{#if loading}
				<p class="field-hint">{t('ui.loading', 'Loading…')}</p>
			{:else if !remoteProjectId}
				<p class="field-hint">
					{t('ui.history_empty_hint', 'Publish this site once to see release history.')}
				</p>
			{:else}
				{#if !canRollback}
					<p class="field-hint">
						{t('ui.account_history_personal_only', 'Rollback requires Personal')}
					</p>
				{/if}

				{#if published.length === 0}
					<div class="history-empty">
						<div class="ico" aria-hidden="true">◌</div>
						<p>{t('ui.history_empty', 'No history yet')}</p>
					</div>
				{:else}
					<ul class="history-list">
						{#each published as r (r.id)}
							{@const isLive = r.id === liveReleaseId}
							<li class="history-item" class:is-live={isLive}>
								<div class="hi-top">
									<span class="hi-time">{formatFriendlyTime(r.publishedAt)}</span>
									{#if isLive}
										<span class="hi-badge">{t('ui.history_live', 'Live')}</span>
									{/if}
								</div>
								{#if publicUrl}
									<div class="hi-meta">{publicUrl}</div>
								{/if}
								<div class="hi-actions">
									{#if isLive}
										<button
											type="button"
											class="hi-btn"
											disabled={busy}
											on:click={viewLive}
										>
											{t('ui.history_view', 'View')}
										</button>
										<button
											type="button"
											class="hi-btn hi-btn-danger"
											disabled={busy || !onUnpublish}
											on:click={unpublishLive}
										>
											{t('ui.history_unpublish', 'Unpublish')}
										</button>
									{:else}
										{@const isRolling = rollingBackId === r.id}
										<button
											type="button"
											class="hi-btn"
											disabled={busy || !canRollback}
											on:click={() => rollback(r)}
										>
											{isRolling
												? t('ui.history_rolling_back', 'Rolling back…')
												: t('ui.history_rollback', 'Rollback')}
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			{#if statusMsg}
				<p class="mod-warning capability-status">{statusMsg}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: min(52vh, 420px);
		overflow-y: auto;
	}

	.history-item {
		background: var(--apple-white, var(--background-primary));
		border: 1px solid var(--apple-divider, var(--background-modifier-border));
		border-radius: 12px;
		padding: 12px;
	}

	.history-item.is-live {
		border-color: rgba(0, 113, 227, 0.28);
		box-shadow: 0 0 0 1px rgba(0, 113, 227, 0.08);
	}

	.hi-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}

	.hi-time {
		font-size: 13px;
		font-weight: 600;
		color: var(--apple-text, var(--text-normal));
		letter-spacing: -0.01em;
	}

	.hi-badge {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(52, 199, 89, 0.12);
		color: #1b7a3a;
	}

	.hi-meta {
		font-size: 11px;
		color: var(--apple-secondary, var(--text-muted));
		margin-bottom: 8px;
		line-height: 1.4;
		word-break: break-all;
	}

	.hi-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hi-btn {
		appearance: none;
		border: none;
		background: var(--apple-gray-fill, var(--background-modifier-hover));
		color: var(--apple-text, var(--text-normal));
		font-size: 12px;
		font-weight: 600;
		padding: 6px 12px;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		line-height: 1.2;
	}

	.hi-btn:hover:not(:disabled) {
		background: var(--apple-gray-hover, var(--background-modifier-border));
	}

	.hi-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.hi-btn-danger {
		background: transparent;
		color: var(--apple-danger, #ff3b30);
		padding: 6px 8px;
	}

	.hi-btn-danger:hover:not(:disabled) {
		background: rgba(255, 59, 48, 0.06);
	}

	.history-empty {
		text-align: center;
		padding: 32px 16px;
		color: var(--apple-secondary, var(--text-muted));
		font-size: 13px;
	}

	.history-empty .ico {
		font-size: 28px;
		margin-bottom: 8px;
		opacity: 0.5;
	}

	.capability-status {
		margin: 8px 0 0;
		font-size: 12px;
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

	:global(.history-count-badge),
	.history-count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		min-width: 0;
		height: auto;
		padding: 0;
		border-radius: 0;
		background: transparent;
		color: var(--mdf-hint, #8b8fa3);
		font-size: 12px;
		font-weight: 500;
	}
</style>

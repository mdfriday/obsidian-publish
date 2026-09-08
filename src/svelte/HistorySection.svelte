<script lang="ts">
	import { Notice } from 'obsidian';
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let projectName: string;
	export let onRolledBack: (() => void) | undefined = undefined;
	/** Bump after publish success to reload release count without expanding. */
	export let refreshKey: number = 0;
	/** `tab` = always expanded (Apple history tab); `fold` = collapsible section */
	export let layout: 'fold' | 'tab' = 'fold';

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
	let statusMsg = '';
	let remoteProjectId: string | null = null;
	let hostingMode: 'share' | 'custom' = 'share';
	let liveReleaseId: string | null = null;
	let releases: ReleaseRow[] = [];

	$: published = releases.filter(
		(r) => r.state === 'published' || r.state === 'superseded',
	);
	$: canRollback = hostingMode === 'custom';
	$: summaryLine = String(published.length);

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
				return;
			}
			remoteProjectId = bind.cloudflareProjectId;
			hostingMode = bind.hostingMode === 'custom' ? 'custom' : 'share';
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
			if (res.hostingMode) hostingMode = res.hostingMode;
		} finally {
			loading = false;
		}
	}

	function formatTime(ms?: number | null): string {
		if (ms == null || !Number.isFinite(ms)) return '—';
		return new Date(ms).toLocaleString();
	}

	async function rollback(release: ReleaseRow) {
		if (!canRollback) {
			new Notice(
				'Rollback requires a custom domain (custom hosting). Bind a domain first.',
				5000,
			);
			return;
		}
		if (release.id === liveReleaseId) {
			new Notice('This release is already live.', 2500);
			return;
		}
		const foundry = plugin.foundryPublishService;
		if (!foundry || !remoteProjectId) return;
		const token = await resolveAuth();
		if (!token) return;

		busy = true;
		statusMsg = `Rolling back to #${release.seq}…`;
		const res = await foundry.rollbackRelease(token, remoteProjectId, release.id);
		busy = false;
		if (!res.success) {
			statusMsg =
				res.code === 'plan_required'
					? res.error || 'Rollback not available on this plan/hosting mode'
					: res.error || 'Rollback failed';
			return;
		}
		liveReleaseId = res.liveReleaseId || release.id;
		statusMsg = '';
		new Notice(`Live traffic rolled back to release #${release.seq}`, 4000);
		await refresh();
		onRolledBack?.();
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
		<span class="setting-item-name">{plugin.i18n?.t?.('ui.history') || 'History'}</span>
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
				<p class="field-hint">Loading…</p>
			{:else if !remoteProjectId}
				<p class="field-hint">{plugin.i18n?.t?.('ui.history_empty_hint') || 'Publish this site once to see release history.'}</p>
			{:else}
				{#if !canRollback}
					<p class="field-hint">
						{plugin.i18n?.t?.('ui.account_history_personal_only') ||
							'Rollback requires Personal (and a custom domain)'}
					</p>
				{/if}

				{#if published.length === 0}
					<p class="field-hint">{plugin.i18n?.t?.('ui.history_empty') || 'No published releases yet.'}</p>
				{:else}
					<ul class="history-list">
						{#each published as r (r.id)}
							<li class="history-item" class:is-live={r.id === liveReleaseId}>
								<div class="history-main">
									<span class="history-seq">#{r.seq}</span>
									{#if r.id === liveReleaseId}
										<span class="live-badge">Live</span>
									{/if}
									<span class="history-time">{formatTime(r.publishedAt)}</span>
								</div>
								<div class="history-actions">
									{#if canRollback && r.id !== liveReleaseId}
										<button
											type="button"
											class="url-action-btn"
											disabled={busy}
											on:click={() => rollback(r)}
										>
											{plugin.i18n?.t?.('ui.history_rollback') || 'Rollback'}
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				<button class="action-button" on:click={refresh} disabled={busy || loading}>
					{plugin.i18n?.t?.('ui.refresh') || 'Refresh'}
				</button>
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
		gap: 6px;
		max-height: 220px;
		overflow-y: auto;
	}

	.history-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 10px;
		background: var(--background-primary);
		border-radius: 4px;
		border: 1px solid transparent;
	}

	.history-item.is-live {
		border-color: var(--mdf-primary, var(--interactive-accent));
	}

	.history-main {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex-wrap: wrap;
	}

	.history-seq {
		font-weight: 600;
		font-size: 13px;
	}

	.history-time {
		font-size: 11px;
		color: var(--text-muted);
	}

	.live-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 3px;
		background: var(--mdf-primary-soft, rgba(99, 91, 255, 0.12));
		color: var(--mdf-primary, var(--interactive-accent));
	}

	.capability-status {
		margin: 0;
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

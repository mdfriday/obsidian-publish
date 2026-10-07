<script lang="ts">
	/**
	 * Advanced options ▸ Subscribe card (subscribe capability).
	 * Values are persisted by Site.svelte (params.subscribe); project/endpoint + server PATCH happen at publish.
	 */
	import { Menu } from 'obsidian';
	import type FridayPlugin from '../main';
	import type { CatalogEntry } from '../theme/types';
	import { themeSupportsSubscribe } from '../subscribe/subscribe-core';
	import {
		dashboardAudienceUrl,
		exportSubscribers,
		getAudienceStatus,
		type AudienceStatus,
		type ExportFormat,
	} from '../subscribe/subscribe-service';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;
	export let projectName: string;
	export let isGuest: boolean;
	/** Theme currently applied (null for faithful / unknown) — drives the capability hint. */
	export let themeEntry: CatalogEntry | null = null;
	export let enabled = false;
	export let title = '';
	export let description = '';
	/** Vault path of the published note/folder (export fallback when the API has no sourcePath). */
	export let sourcePath: string | null = null;
	/** Bump after publish / account change to reload the count. */
	export let refreshKey = 0;
	export let onChange: (fields: { enabled: boolean; title: string; description: string }) => void;

	let status: AudienceStatus | null = null;
	let loading = false;
	let exporting = false;
	let loadSeq = 0;

	$: showThemeHint = !isGuest && enabled && !!themeEntry && !themeSupportsSubscribe(themeEntry);
	$: pendingPublish = !isGuest && !!status && status.subscribeEnabled !== enabled;
	$: void load(projectName, isGuest, refreshKey);

	async function load(name: string, guest: boolean, _key: number) {
		const seq = ++loadSeq;
		if (guest || !name) {
			status = null;
			return;
		}
		loading = true;
		try {
			const s = await getAudienceStatus(plugin, name);
			if (seq === loadSeq) status = s;
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	function toggle() {
		if (isGuest) return;
		onChange({ enabled: !enabled, title, description });
	}

	function onTitle(e: Event) {
		onChange({ enabled, title: (e.currentTarget as HTMLInputElement).value, description });
	}

	function onDesc(e: Event) {
		onChange({ enabled, title, description: (e.currentTarget as HTMLInputElement).value });
	}

	function openDashboard() {
		if (!status) return;
		window.open(dashboardAudienceUrl(plugin, status.projectId), '_blank');
	}

	async function runExport(format: ExportFormat) {
		if (!status || exporting) return;
		exporting = true;
		try {
			await exportSubscribers(plugin, { projectId: status.projectId, format, localSourcePath: sourcePath });
		} finally {
			exporting = false;
		}
	}

	function openExportMenu(e: MouseEvent) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(t('ui.subscribe_export_csv')).setIcon('table').onClick(() => void runExport('csv')));
		menu.addItem((i) => i.setTitle(t('ui.subscribe_export_md')).setIcon('file-text').onClick(() => void runExport('md')));
		menu.showAtMouseEvent(e);
	}
</script>

<section class="adv-block mdf-subscribe-settings">
	<header class="adv-block-head">
		<span class="adv-block-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
				<circle cx="9" cy="7" r="3.5" />
				<path d="M19 8v6M22 11h-6" />
			</svg>
		</span>
		<div class="adv-block-text">
			<div class="adv-block-title">{t('ui.adv_subscribe_title')}</div>
			<div class="adv-block-desc">{t('ui.adv_subscribe_desc')}</div>
		</div>
		<div
			class="toggle"
			class:on={enabled && !isGuest}
			class:is-disabled={isGuest}
			role="switch"
			aria-checked={enabled && !isGuest}
			aria-disabled={isGuest}
			tabindex={isGuest ? -1 : 0}
			aria-label={t('ui.subscribe_toggle')}
			on:click={toggle}
			on:keydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					toggle();
				}
			}}
		></div>
	</header>
	<div class="adv-block-body">
		{#if isGuest}
			<p class="helper lock">{t('ui.subscribe_guest_hint')}</p>
		{:else}
			{#if enabled}
				<div class="field-label mdf-sub-sublabel">{t('ui.subscribe_title')}</div>
				<input
					class="field-input"
					type="text"
					maxlength="120"
					placeholder={t('ui.subscribe_default_title')}
					value={title}
					on:input={onTitle}
				/>
				<div class="field-label mdf-sub-sublabel">{t('ui.subscribe_description')}</div>
				<input
					class="field-input"
					type="text"
					maxlength="300"
					placeholder={t('ui.subscribe_default_description')}
					value={description}
					on:input={onDesc}
				/>
				<p class="helper">{t('ui.subscribe_field_helper')}</p>
			{:else}
				<p class="helper">{t('ui.subscribe_helper')}</p>
			{/if}
			{#if showThemeHint}
				<p class="helper lock">{t('ui.subscribe_theme_hint')}</p>
			{/if}
			{#if status}
				<div class="mdf-sub-stats">
					<div class="mdf-sub-stats-count">
						<div class="mdf-sub-stats-num">{status.subscriberCount}</div>
						<div class="mdf-sub-stats-label">{t('ui.adv_subscribe_total')}</div>
					</div>
					<div class="mdf-sub-stats-actions">
						<button type="button" class="adv-secondary-btn" on:click={openDashboard}>
							{t('ui.subscribe_view_dashboard')}
						</button>
						<button
							type="button"
							class="adv-secondary-btn"
							disabled={exporting}
							on:click={openExportMenu}
						>
							<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2.5v8M5 8l3 3 3-3"/><path d="M3 12.5h10"/></svg>
							{t('ui.subscribe_export')}
						</button>
					</div>
				</div>
				{#if pendingPublish}
					<p class="helper mdf-sub-pending">{t('ui.subscribe_pending_publish')}</p>
				{/if}
			{:else if enabled && !loading}
				<p class="helper">{t('ui.subscribe_count_unpublished')}</p>
			{/if}
		{/if}
	</div>
</section>

<style>
	.mdf-sub-sublabel {
		margin-top: 8px;
		font-size: 12px;
		opacity: 0.8;
	}
	.mdf-sub-stats {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		padding: 12px 14px;
		border-radius: 10px;
		background: #f5f8ff;
		border: 1px solid #e3ebff;
		flex-wrap: wrap;
	}
	.mdf-sub-stats-num {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.1;
		color: var(--apple-text, #1d1d1f);
	}
	.mdf-sub-stats-label {
		margin-top: 2px;
		font-size: 11px;
		font-weight: 500;
		color: var(--apple-secondary, #86868b);
	}
	.mdf-sub-stats-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.mdf-sub-pending {
		color: var(--text-accent);
		margin-top: 8px;
	}
</style>

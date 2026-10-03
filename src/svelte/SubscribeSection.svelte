<script lang="ts">
	/**
	 * Advanced options ▸ Subscribe form (subscribe capability, arch/drafts/subscribe-design.md §7.1–7.2).
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
	export let onSignIn: () => void;

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

<div class="field-group mdf-subscribe-settings">
	<div class="toggle-row">
		<span class="field-label" style="margin:0;">{t('ui.subscribe_toggle')}</span>
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
	</div>
	{#if isGuest}
		<p class="helper lock">
			{t('ui.subscribe_guest_hint')} ·
			<button type="button" class="link" on:click={onSignIn}>{t('ui.subscribe_sign_in')}</button>
		</p>
	{:else}
		<p class="helper">{t('ui.subscribe_helper')}</p>
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
		{/if}
		{#if showThemeHint}
			<p class="helper lock">{t('ui.subscribe_theme_hint')}</p>
		{/if}
		{#if status}
			<p class="helper mdf-sub-status">
				<span>{t('ui.subscribe_count', { count: status.subscriberCount })}</span>
				· <button type="button" class="link" on:click={openDashboard}>{t('ui.subscribe_view_dashboard')}</button>
				· <button type="button" class="link" disabled={exporting} on:click={openExportMenu}>{t('ui.subscribe_export')} ▾</button>
				{#if pendingPublish}
					· <span class="mdf-sub-pending">{t('ui.subscribe_pending_publish')}</span>
				{/if}
			</p>
		{:else if enabled && !loading}
			<p class="helper">{t('ui.subscribe_count_unpublished')}</p>
		{/if}
	{/if}
</div>

<style>
	.mdf-sub-sublabel {
		margin-top: 8px;
		font-size: 12px;
		opacity: 0.8;
	}
	.mdf-sub-status {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: baseline;
	}
	.mdf-sub-pending {
		color: var(--text-accent);
	}
</style>

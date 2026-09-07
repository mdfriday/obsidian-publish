<script lang="ts">
	import type { PublishMode } from '../../types/publish-config';
	import type { CatalogEntry } from '../../theme/types';
	import ThemePicker from './ThemePicker.svelte';

	export let mode: PublishMode;
	export let label: string;
	export let faithfulLabel: string;
	export let themedLabel: string;
	export let hint: string;
	export let onChange: (mode: PublishMode) => void;

	export let folderFixed: boolean = false;
	export let folderFixedLabel: string = '';

	export let showThemes: boolean = false;
	export let themes: CatalogEntry[] = [];
	export let selectedThemeSlug: string = '';
	export let themesLoading: boolean = false;
	export let themeLabel: string = 'Theme';
	export let liveDemoLabel: string = 'Live demo';
	export let allThemesLabel: string = 'All themes';
	export let onSelectTheme: (slug: string) => void = () => {};
	export let onOpenThemesCatalog: () => void = () => {};
</script>

<section class="mdf-mode">
	{#if folderFixed}
		<div class="mdf-mode-top">
			<div class="mdf-label">{label}</div>
			<div class="mdf-fixed">{folderFixedLabel}</div>
		</div>
		{#if hint}
			<p class="mdf-hint">{hint}</p>
		{/if}
	{:else}
		<div class="mdf-label">{label}</div>
		<div class="mdf-seg" role="group" aria-label={label}>
			<button
				type="button"
				class="mdf-seg-btn"
				class:is-active={mode === 'faithful'}
				on:click={() => onChange('faithful')}
			>
				{faithfulLabel}
			</button>
			<button
				type="button"
				class="mdf-seg-btn"
				class:is-active={mode === 'themed'}
				on:click={() => onChange('themed')}
			>
				{themedLabel}
			</button>
		</div>
		{#if hint}
			<p class="mdf-hint">{hint}</p>
		{/if}
	{/if}

	{#if showThemes}
		<div class="mdf-mode-themes">
			<ThemePicker
				label={themeLabel}
				{themes}
				selectedSlug={selectedThemeSlug}
				loading={themesLoading}
				{liveDemoLabel}
				{allThemesLabel}
				onSelect={onSelectTheme}
				onOpenCatalog={onOpenThemesCatalog}
				embedded
			/>
		</div>
	{/if}
</section>

<style>
	.mdf-mode {
		padding: 10px 0;
		border: none;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-mode-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.mdf-label {
		font-family: var(--font-interface);
		font-size: 12px;
		font-weight: 500;
		color: var(--mdf-hint, #8b8fa3);
		margin-bottom: 6px;
	}
	.mdf-mode-top .mdf-label {
		margin-bottom: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
	}
	.mdf-fixed {
		font-size: 12px;
		font-weight: 500;
		color: var(--mdf-muted, #4d4f67);
	}
	.mdf-seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		height: 32px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		overflow: hidden;
		background: transparent;
	}
	.mdf-seg-btn {
		padding: 0 8px;
		height: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--mdf-hint, #8b8fa3);
		font-family: var(--font-interface);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.mdf-seg-btn + .mdf-seg-btn {
		border-left: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-seg-btn.is-active {
		background: var(--mdf-soft, #e7e9ee);
		color: var(--mdf-ink, #2e303b);
		font-weight: 600;
	}
	.mdf-hint {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.4;
	}
	.mdf-mode-themes {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--mdf-stroke, #bdc0cb);
	}
</style>

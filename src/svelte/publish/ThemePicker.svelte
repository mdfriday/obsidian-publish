<script lang="ts">
	import type { CatalogEntry } from '../../theme/types';

	export let label: string;
	export let themes: CatalogEntry[];
	export let selectedSlug: string;
	export let loading: boolean;
	export let liveDemoLabel: string;
	export let allThemesLabel: string;
	export let onSelect: (slug: string) => void;
	export let onOpenCatalog: () => void;
	/** When true, nest inside publish-mode card (no outer card chrome). */
	export let embedded: boolean = false;

	function demoUrl(theme: CatalogEntry): string {
		return `https://mdfriday.com/demo/${theme.slug || ''}/index.html`;
	}
</script>

<section class="mdf-themes" class:is-embedded={embedded}>
	<div class="mdf-label">{label}</div>
	{#if loading && themes.length === 0}
		<p class="mdf-hint">…</p>
	{:else}
		<ul class="mdf-theme-list">
			{#each themes.filter((t) => t.packUrl) as theme (theme.slug)}
				<li class="mdf-theme-row">
					<label class="mdf-theme-pick">
						<input
							type="radio"
							name="mdf-theme"
							value={theme.slug}
							checked={selectedSlug === theme.slug}
							on:change={() => onSelect(theme.slug)}
						/>
						<span class="mdf-theme-name">{theme.name}</span>
					</label>
					<a
						class="mdf-live"
						href={demoUrl(theme)}
						target="_blank"
						rel="noopener noreferrer"
						on:click|stopPropagation
					>
						{liveDemoLabel} ↗
					</a>
				</li>
			{/each}
		</ul>
		<button type="button" class="mdf-catalog-link" on:click={onOpenCatalog}>
			{allThemesLabel} ↗
		</button>
	{/if}
</section>

<style>
	.mdf-themes {
		margin-bottom: var(--mdf-gap, 12px);
	}
	.mdf-themes.is-embedded {
		margin-bottom: 0;
	}
	.mdf-label {
		font-size: 12px;
		font-weight: 500;
		margin-bottom: 6px;
		color: var(--mdf-hint, #8b8fa3);
	}
	.mdf-theme-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		overflow: hidden;
		background: transparent;
	}
	.mdf-themes.is-embedded .mdf-theme-list {
		background: transparent;
	}
	.mdf-theme-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 32px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-theme-row:last-child {
		border-bottom: none;
	}
	.mdf-theme-pick {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		cursor: pointer;
		font-size: 13px;
		color: var(--mdf-ink, #2e303b);
	}
	.mdf-theme-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mdf-live {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		text-decoration: none;
	}
	.mdf-live:hover {
		color: var(--mdf-primary, #9375ef);
	}
	.mdf-catalog-link {
		margin-top: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--mdf-hint, #8b8fa3);
		font-size: 12px;
		cursor: pointer;
	}
	.mdf-hint {
		margin: 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
	}
</style>

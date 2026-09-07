<script lang="ts">
	export let title: string;
	export let statusReady: string;
	export let statusOff: string;
	export let statusPreparing: string;
	export let linkLabel: string;
	export let refreshLabel: string;
	export let exportLabel: string;
	export let exportingLabel: string;
	export let hint: string;
	export let generateLabel: string;
	export let previewUrl: string;
	export let hasPreview: boolean;
	export let isPreviewBuilding: boolean;
	export let buildProgress: number;
	export let isExporting: boolean;
	export let disabled: boolean;
	export let onPreview: () => void;
	export let onExport: () => void;

	let expanded = false;
</script>

<section class="mdf-collapse">
	<button
		type="button"
		class="mdf-collapse-toggle"
		aria-expanded={expanded}
		on:click={() => (expanded = !expanded)}
	>
		<svg class="mdf-chevron" class:is-collapsed={!expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<polyline points="6 9 12 15 18 9"></polyline>
		</svg>
		<span class="mdf-collapse-title">{title}</span>
		<span class="mdf-collapse-summary">
			{isPreviewBuilding ? statusPreparing : hasPreview ? statusReady : statusOff}
		</span>
	</button>

	{#if expanded}
		<div class="mdf-collapse-body">
			{#if isPreviewBuilding}
				<p class="mdf-hint">{statusPreparing} {buildProgress}%</p>
			{:else if hasPreview && previewUrl}
				<p class="mdf-label">{linkLabel}</p>
				<a class="mdf-url" href={previewUrl} target="_blank" rel="noopener noreferrer">{previewUrl}</a>
				<div class="mdf-row">
					<button type="button" class="mdf-btn-primary" on:click={onPreview} {disabled}>{refreshLabel}</button>
					<button type="button" class="mdf-btn-secondary" on:click={onExport} disabled={isExporting}>
						{isExporting ? exportingLabel : exportLabel}
					</button>
				</div>
			{:else}
				<p class="mdf-hint">{hint}</p>
				<button type="button" class="mdf-btn-primary" on:click={onPreview} {disabled}>{generateLabel}</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.mdf-collapse {
		margin-bottom: 10px;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: 6px;
		overflow: hidden;
	}
	.mdf-collapse-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: none;
		background: var(--background-secondary);
		cursor: pointer;
		text-align: left;
	}
	.mdf-chevron {
		transition: transform 0.15s ease;
	}
	.mdf-chevron.is-collapsed {
		transform: rotate(-90deg);
	}
	.mdf-collapse-title {
		flex: 1;
		font-size: 13px;
		font-weight: 500;
	}
	.mdf-collapse-summary {
		font-size: 11px;
		color: var(--text-muted);
	}
	.mdf-collapse-body {
		padding: 10px 12px 12px;
		border-top: 1px solid var(--mdf-border, var(--background-modifier-border));
		background: var(--background-primary);
	}
	.mdf-label {
		font-size: 12px;
		color: var(--text-muted);
		margin: 0 0 4px;
	}
	.mdf-url {
		display: block;
		font-size: 12px;
		word-break: break-all;
		color: var(--mdf-primary, var(--interactive-accent));
		margin-bottom: 10px;
	}
	.mdf-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.mdf-btn-primary {
		padding: 8px 12px;
		border: none;
		border-radius: 6px;
		background: var(--mdf-primary, var(--interactive-accent));
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.mdf-btn-primary:disabled {
		opacity: 0.4;
	}
	.mdf-btn-secondary {
		padding: 8px 12px;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: 6px;
		background: var(--background-secondary);
		font-size: 12px;
		cursor: pointer;
	}
	.mdf-hint {
		margin: 0 0 8px;
		font-size: 11px;
		color: var(--text-muted);
	}
</style>

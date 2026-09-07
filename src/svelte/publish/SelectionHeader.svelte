<script lang="ts">
	export let fileName: string;
	export let pathLabel: string;
	export let kind: 'note' | 'folder';
	export let badgeNote: string;
	export let badgeWiki: string;
	export let emptyHint: string;
</script>

<section class="mdf-selection">
	{#if pathLabel || fileName}
		<div class="mdf-selection-row" title={pathLabel || fileName}>
			{#if kind === 'folder'}
				<svg class="mdf-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
				</svg>
			{:else}
				<svg class="mdf-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
					<polyline points="14 2 14 8 20 8"></polyline>
				</svg>
			{/if}
			<span class="mdf-name">{fileName || pathLabel}</span>
			<span class="mdf-badge">{kind === 'folder' ? badgeWiki : badgeNote}</span>
		</div>
	{:else}
		<p class="mdf-empty">{emptyHint}</p>
	{/if}
</section>

<style>
	.mdf-selection {
		padding: 10px 0;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-selection-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 6px 0;
		border: none;
		border-radius: 0;
		background: transparent;
		box-sizing: border-box;
	}
	.mdf-icon {
		flex-shrink: 0;
		color: var(--mdf-hint, #8b8fa3);
	}
	.mdf-name {
		flex: 1;
		min-width: 0;
		font-family: var(--font-interface);
		font-size: 13px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mdf-badge {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 500;
		padding: 1px 7px;
		border-radius: 4px;
		background: var(--mdf-soft, #e7e9ee);
		color: var(--mdf-muted, #4d4f67);
		border: none;
	}
	.mdf-empty {
		margin: 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.4;
	}
</style>

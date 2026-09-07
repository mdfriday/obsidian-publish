<script lang="ts">
	export let title: string;
	export let autoPublishLabel: string;
	export let autoPublishHint: string;
	export let autoPublishEnabled: boolean;
	export let isPublishing: boolean;
	export let onAutoPublishChange: (enabled: boolean) => void;

	let expanded = false;

	function onToggle(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		onAutoPublishChange(input.checked);
	}
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
	</button>

	{#if expanded}
		<div class="mdf-collapse-body">
			<label class="mdf-auto">
				<input
					type="checkbox"
					checked={autoPublishEnabled}
					disabled={isPublishing}
					on:change={onToggle}
				/>
				<span>
					<span class="mdf-auto-label">{autoPublishLabel}</span>
					<span class="mdf-auto-hint">{autoPublishHint}</span>
				</span>
			</label>
			<slot />
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
	.mdf-chevron.is-collapsed {
		transform: rotate(-90deg);
	}
	.mdf-collapse-title {
		font-size: 13px;
		font-weight: 500;
	}
	.mdf-collapse-body {
		padding: 10px 12px 12px;
		border-top: 1px solid var(--mdf-border, var(--background-modifier-border));
		background: var(--background-primary);
	}
	.mdf-auto {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.mdf-auto-label {
		display: block;
		font-weight: 500;
	}
	.mdf-auto-hint {
		display: block;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 11px;
	}
</style>

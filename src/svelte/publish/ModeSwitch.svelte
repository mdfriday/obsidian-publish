<script lang="ts">
	import type { PublishMode } from '../../types/publish-config';

	export let mode: PublishMode;
	export let label: string;
	export let faithfulLabel: string;
	export let themedLabel: string;
	export let hint: string;
	export let onChange: (mode: PublishMode) => void;
</script>

<section class="mdf-mode">
	<div class="mdf-mode-card">
		<div class="mdf-mode-top">
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
		</div>
		{#if hint}
			<p class="mdf-hint">{hint}</p>
		{/if}
	</div>
</section>

<style>
	.mdf-mode {
		margin-bottom: var(--mdf-gap, 12px);
	}
	.mdf-mode-card {
		padding: 12px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: var(--mdf-radius, 8px);
		background: var(--mdf-card, #fff);
		box-sizing: border-box;
	}
	.mdf-mode-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.mdf-label {
		flex-shrink: 0;
		font-family: var(--font-interface);
		font-size: 14px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
	}
	.mdf-seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-width: 0;
		flex: 1;
		max-width: 220px;
		height: 36px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		overflow: hidden;
		background: var(--mdf-card, #fff);
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
		margin: 8px 0 0;
		font-size: 12px;
		font-weight: 400;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.45;
	}
</style>

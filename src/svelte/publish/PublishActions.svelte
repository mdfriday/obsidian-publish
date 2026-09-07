<script lang="ts">
	export let publishLabel: string;
	export let previewLabel: string;
	export let stopLabel: string;
	export let buildingLabel: string;
	export let previewBuildingLabel: string;
	export let authTip: string;
	export let showAuthTip: boolean;
	export let disabled: boolean;
	export let hasContent: boolean = true;
	export let isPublishing: boolean;
	export let isPreviewBuilding: boolean;
	export let autoPublishEnabled: boolean;
	export let publishProgress: number;
	export let buildProgress: number;
	export let onPublish: () => void;
	export let onPreview: () => void;
	export let onStop: () => void;

	$: publishBusy = isPublishing;
	$: previewBusy = isPreviewBuilding && !isPublishing;
	$: publishText = publishBusy
		? `${buildingLabel} ${Math.max(0, Math.min(100, Math.round(publishProgress)))}%`
		: publishLabel;
	$: previewText = previewBusy
		? `${previewBuildingLabel} ${Math.max(0, Math.min(100, Math.round(buildProgress)))}%`
		: previewLabel;
</script>

<section class="mdf-actions">
	{#if showAuthTip}
		<div class="mdf-auth-tip" role="status">{authTip}</div>
	{/if}

	{#if autoPublishEnabled && isPublishing}
		<div class="mdf-auto-row">
			<span class="mdf-auto-text">{publishText}</span>
			<button type="button" class="mdf-btn mdf-btn-secondary" on:click={onStop}>{stopLabel}</button>
		</div>
	{:else}
		<div class="mdf-btn-row">
			<button
				type="button"
				class="mdf-btn mdf-btn-primary"
				on:click={onPublish}
				disabled={disabled || previewBusy}
			>
				<span class="mdf-btn-label">{publishText}</span>
				{#if publishBusy}
					<span
						class="mdf-btn-progress"
						style="width: {Math.max(0, Math.min(100, publishProgress))}%"
					></span>
				{/if}
			</button>
			<button
				type="button"
				class="mdf-btn mdf-btn-secondary"
				on:click={onPreview}
				disabled={!hasContent || isPublishing || previewBusy}
			>
				<span class="mdf-btn-label">{previewText}</span>
				{#if previewBusy}
					<span
						class="mdf-btn-progress mdf-btn-progress-secondary"
						style="width: {Math.max(0, Math.min(100, buildProgress))}%"
					></span>
				{/if}
			</button>
		</div>
	{/if}
</section>

<style>
	.mdf-actions {
		padding: 10px 0;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-auth-tip {
		margin-bottom: 8px;
		padding: 8px 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.4;
	}
	.mdf-btn-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.mdf-btn {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 32px;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 8px;
		font-family: var(--font-interface);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		box-shadow: none;
		box-sizing: border-box;
	}
	.mdf-btn-label {
		position: relative;
		z-index: 1;
	}
	.mdf-btn-progress {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: rgba(255, 255, 255, 0.9);
		transition: width 0.15s ease;
	}
	.mdf-btn-progress-secondary {
		background: var(--mdf-primary, #9375ef);
		opacity: 0.55;
	}
	.mdf-btn-primary {
		border: none;
		background: var(--mdf-primary, #9375ef);
		color: #ffffff;
	}
	.mdf-btn-primary:disabled,
	.mdf-btn-secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.mdf-btn-secondary {
		border: 1px solid var(--mdf-primary, #9375ef);
		background: transparent;
		color: var(--mdf-primary, #9375ef);
	}
	.mdf-auto-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.mdf-auto-text {
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
	}
</style>

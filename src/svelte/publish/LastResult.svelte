<script lang="ts">
	export let success: boolean;
	export let url: string;
	export let error: string;
	export let successTitle: string;
	export let openLabel: string;
	export let copyLabel: string;
	export let revokeLabel: string;
	export let retryLabel: string;
	export let onOpen: () => void;
	export let onCopy: () => void;
	export let onRevoke: () => void;
	export let onRetry: () => void;
</script>

{#if success && url}
	<section class="mdf-result mdf-result-ok">
		<div class="mdf-result-title">✓ {successTitle}</div>
		<a class="mdf-url" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
		<div class="mdf-result-actions">
			<button type="button" class="mdf-chip-btn" on:click={onOpen}>{openLabel}</button>
			<button type="button" class="mdf-chip-btn" on:click={onCopy}>{copyLabel}</button>
			<button type="button" class="mdf-chip-btn mdf-chip-danger" on:click={onRevoke}>{revokeLabel}</button>
		</div>
	</section>
{:else if error}
	<section class="mdf-result mdf-result-err">
		<div class="mdf-result-title">{error}</div>
		<button type="button" class="mdf-chip-btn" on:click={onRetry}>{retryLabel}</button>
	</section>
{/if}

<style>
	.mdf-result {
		margin-bottom: 14px;
		padding: 12px;
		border-radius: 6px;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
	}
	.mdf-result-ok {
		background: var(--mdf-success-bg, #f0fdf4);
	}
	.mdf-result-err {
		background: #fef2f2;
	}
	.mdf-result-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-success, #166534);
		margin-bottom: 8px;
	}
	.mdf-result-err .mdf-result-title {
		color: var(--mdf-danger, #b42318);
	}
	.mdf-url {
		display: block;
		font-size: 12px;
		word-break: break-all;
		color: var(--mdf-primary, #3e57da);
		margin-bottom: 10px;
		text-decoration: none;
	}
	.mdf-result-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.mdf-chip-btn {
		padding: 6px 10px;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: 4px;
		background: var(--background-primary);
		font-size: 12px;
		cursor: pointer;
	}
	.mdf-chip-danger {
		color: var(--mdf-danger, #b42318);
	}
</style>

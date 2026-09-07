<script lang="ts">
	export let title: string;
	export let onlineLabel: string;
	export let previewLabel: string;
	export let openLabel: string;
	export let copyLabel: string;
	export let revokeLabel: string;
	export let emptyOnline: string;
	export let emptyPreview: string;
	export let tab: 'online' | 'preview';
	export let onlineUrl: string;
	export let previewUrl: string;
	export let onlineError: string;
	export let onTabChange: (tab: 'online' | 'preview') => void;
	export let onOpenOnline: () => void;
	export let onCopyOnline: () => void;
	export let onRevoke: () => void;
	export let onOpenPreview: () => void;
	export let onCopyPreview: () => void;

	$: activeUrl = tab === 'online' ? onlineUrl : previewUrl;
	$: showRevoke = tab === 'online' && !!onlineUrl;
	$: emptyText = tab === 'online' ? emptyOnline : emptyPreview;
	$: hasRow = tab === 'online' ? !!(onlineUrl || onlineError) : !!previewUrl;
</script>

<section class="mdf-output">
	<div class="mdf-output-head">
		<span class="mdf-output-title">{title}</span>
		<div class="mdf-seg" role="tablist">
			<button
				type="button"
				class="mdf-seg-btn"
				class:is-active={tab === 'online'}
				role="tab"
				aria-selected={tab === 'online'}
				on:click={() => onTabChange('online')}
			>
				{onlineLabel}
			</button>
			<button
				type="button"
				class="mdf-seg-btn"
				class:is-active={tab === 'preview'}
				role="tab"
				aria-selected={tab === 'preview'}
				on:click={() => onTabChange('preview')}
			>
				{previewLabel}
			</button>
		</div>
	</div>

	{#if hasRow}
		<div class="mdf-output-row">
			{#if tab === 'online' && onlineError && !onlineUrl}
				<span class="mdf-dot is-err" aria-hidden="true"></span>
				<span class="mdf-url is-err" title={onlineError}>{onlineError}</span>
			{:else}
				<span class="mdf-dot" aria-hidden="true"></span>
				<span class="mdf-url" title={activeUrl}>{activeUrl}</span>
				<div class="mdf-links">
					{#if tab === 'online'}
						<button type="button" class="mdf-link" on:click={onOpenOnline}>{openLabel}</button>
						<button type="button" class="mdf-link" on:click={onCopyOnline}>{copyLabel}</button>
						{#if showRevoke}
							<button type="button" class="mdf-link is-danger" on:click={onRevoke}>{revokeLabel}</button>
						{/if}
					{:else}
						<button type="button" class="mdf-link" on:click={onOpenPreview}>{openLabel}</button>
						<button type="button" class="mdf-link" on:click={onCopyPreview}>{copyLabel}</button>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<div class="mdf-output-empty">{emptyText}</div>
	{/if}
</section>

<style>
	.mdf-output {
		padding: 10px 0;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
		background: transparent;
	}
	.mdf-output-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 28px;
	}
	.mdf-output-title {
		font-family: var(--font-interface);
		font-size: 13px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
	}
	.mdf-seg {
		display: inline-grid;
		grid-template-columns: 1fr 1fr;
		height: 26px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		overflow: hidden;
		background: transparent;
		flex-shrink: 0;
	}
	.mdf-seg-btn {
		padding: 0 8px;
		height: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--mdf-hint, #8b8fa3);
		font-family: var(--font-interface);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		line-height: 1;
	}
	.mdf-seg-btn + .mdf-seg-btn {
		border-left: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-seg-btn.is-active {
		background: var(--mdf-soft, #e7e9ee);
		color: var(--mdf-ink, #2e303b);
		font-weight: 600;
	}
	.mdf-output-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 28px;
		margin-top: 8px;
		padding: 0;
		background: transparent;
	}
	.mdf-dot {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #34c759;
	}
	.mdf-dot.is-err {
		background: var(--mdf-danger, #e05454);
	}
	.mdf-url {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--mdf-ink, #2e303b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mdf-url.is-err {
		color: var(--mdf-danger, #e05454);
	}
	.mdf-links {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}
	.mdf-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--mdf-muted, #4d4f67);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.mdf-link:hover {
		color: var(--mdf-ink, #2e303b);
	}
	.mdf-link.is-danger {
		color: var(--mdf-danger, #e05454);
	}
	.mdf-output-empty {
		margin-top: 8px;
		padding: 0;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		background: transparent;
	}
</style>

<script lang="ts">
	export let label: string;
	export let encryptedLabel: string;
	export let offLabel: string;
	export let value: string;
	export let placeholder: string;
	export let showLabel: string;
	export let hideLabel: string;
	export let onChange: (value: string) => void;

	let expanded = false;
	let showPassword = false;

	$: hasPassword = !!value.trim();
	$: statusLabel = hasPassword ? encryptedLabel : offLabel;

	function toggleExpand() {
		expanded = !expanded;
		if (!expanded) showPassword = false;
	}
</script>

<section class="mdf-setting-block">
	<button type="button" class="mdf-setting-row" on:click={toggleExpand} aria-expanded={expanded}>
		<span class="mdf-setting-title">
			{label}
			<span class="mdf-sep">·</span>
			<span class="mdf-status">{statusLabel}</span>
		</span>
		<svg
			class="mdf-chevron"
			class:is-open={expanded}
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<polyline points="9 18 15 12 9 6"></polyline>
		</svg>
	</button>

	{#if expanded}
		<div class="mdf-setting-body">
			<div class="mdf-password-row">
				<input
					class="mdf-input"
					type={showPassword ? 'text' : 'password'}
					value={value}
					{placeholder}
					autocomplete="new-password"
					on:input={(e) => onChange(e.currentTarget.value)}
					on:change={(e) => onChange(e.currentTarget.value)}
					on:blur={(e) => onChange(e.currentTarget.value)}
				/>
				<button
					type="button"
					class="mdf-eye"
					title={showPassword ? hideLabel : showLabel}
					on:click={() => (showPassword = !showPassword)}
				>
					{#if showPassword}
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
							<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
							<line x1="1" y1="1" x2="23" y2="23"/>
						</svg>
					{:else}
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
							<circle cx="12" cy="12" r="3"/>
						</svg>
					{/if}
				</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.mdf-setting-block {
		margin-bottom: var(--mdf-gap, 12px);
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: var(--mdf-radius, 8px);
		background: var(--mdf-card, #fff);
		overflow: hidden;
		box-shadow: none;
	}
	.mdf-setting-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 12px;
		border: none;
		background: transparent;
		color: var(--mdf-ink, #2e303b);
		cursor: pointer;
		text-align: left;
		box-sizing: border-box;
	}
	.mdf-setting-title {
		flex: 1;
		min-width: 0;
		font-family: var(--font-interface);
		font-size: 14px;
		font-weight: 600;
	}
	.mdf-sep {
		margin: 0 4px;
		color: var(--mdf-hint, #8b8fa3);
		font-weight: 400;
	}
	.mdf-status {
		color: var(--mdf-muted, #4d4f67);
		font-weight: 500;
	}
	.mdf-chevron {
		flex-shrink: 0;
		color: var(--mdf-hint, #8b8fa3);
		transition: transform 0.12s ease;
	}
	.mdf-chevron.is-open {
		transform: rotate(90deg);
	}
	.mdf-setting-body {
		padding: 12px;
		border-top: 1px solid var(--mdf-stroke, #bdc0cb);
		background: var(--mdf-card, #fff);
	}
	.mdf-password-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mdf-input {
		flex: 1;
		min-width: 0;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		background: var(--mdf-card, #fff);
		color: var(--mdf-ink, #2e303b);
		font-size: 13px;
		box-sizing: border-box;
	}
	.mdf-eye {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		background: var(--mdf-card, #fff);
		color: var(--mdf-hint, #8b8fa3);
		cursor: pointer;
	}
</style>

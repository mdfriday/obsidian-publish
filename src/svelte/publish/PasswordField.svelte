<script lang="ts">
	export let label: string;
	export let value: string;
	export let placeholder: string;
	export let hint: string;
	export let showPassword: boolean;
	export let showLabel: string;
	export let hideLabel: string;
	export let onToggleShow: () => void;
	export let onChange: (value: string) => void;
</script>

<section class="mdf-password">
	<div class="mdf-label">{label}</div>
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
			on:click={onToggleShow}
		>
			{#if showPassword}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
					<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
					<line x1="1" y1="1" x2="23" y2="23"/>
				</svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
					<circle cx="12" cy="12" r="3"/>
				</svg>
			{/if}
		</button>
	</div>
	<p class="mdf-hint">{hint}</p>
</section>

<style>
	.mdf-password {
		margin-bottom: 14px;
	}
	.mdf-label {
		font-size: 12px;
		font-weight: 500;
		margin-bottom: 6px;
	}
	.mdf-password-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mdf-input {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: 6px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
	}
	.mdf-eye {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: 6px;
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: pointer;
	}
	.mdf-hint {
		margin: 6px 0 0;
		font-size: 11px;
		color: var(--mdf-muted, var(--text-muted));
		line-height: 1.4;
	}
</style>

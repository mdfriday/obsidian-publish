<script lang="ts">
	export let title: string;
</script>

<header class="mdf-brand-header">
	<span class="mdf-brand-title">{title}</span>
</header>

<style>
	.mdf-brand-header {
		padding: 0 0 12px;
		margin: 0;
		border: none;
	}
	.mdf-brand-title {
		font-family: var(--font-interface);
		font-size: 16px;
		font-weight: 700;
		line-height: 1.3;
		color: var(--mdf-ink, #2e303b);
	}
</style>

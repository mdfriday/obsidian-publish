<script lang="ts">
	export let title: string;
	export let logoUrl: string = 'https://gohugo.net/mdfriday.svg';
	export let homeUrl: string = 'https://mdfriday.com';
</script>

<header class="mdf-brand-header">
	<a class="mdf-brand-link" href={homeUrl} target="_blank" rel="noopener noreferrer" title="MDFriday">
		<img src={logoUrl} alt="MDFriday" class="mdf-logo" width="18" height="18" />
		<span class="mdf-brand-title">{title}</span>
	</a>
</header>

<style>
	.mdf-brand-header {
		padding: 0 0 10px;
		margin: 0 0 0;
		border-bottom: 1px solid var(--mdf-stroke, #bdc0cb);
	}
	.mdf-brand-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}
	.mdf-brand-link:hover .mdf-brand-title {
		color: var(--mdf-primary, #9375ef);
	}
	.mdf-logo {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		border-radius: 4px;
	}
	.mdf-brand-title {
		font-family: var(--font-interface);
		font-size: 14px;
		font-weight: 700;
		line-height: 1.3;
		color: var(--mdf-ink, #2e303b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>

<script lang="ts">
	import { App } from 'obsidian';
	import Site from './Site.svelte';
	import FridayPlugin from '../main';

	export let app: App;
	export let plugin: FridayPlugin;
</script>

<div class="friday-plugin-main site-builder">
	<section id="friday-plugin-main" class="friday-plugin-shell">
		<Site {app} {plugin} />
	</section>
</div>

<style>
	.friday-plugin-main {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.friday-plugin-shell {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>

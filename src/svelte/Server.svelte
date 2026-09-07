<script lang="ts">
	import {App} from "obsidian";
	import Site from "./Site.svelte"
	import {onMount, onDestroy} from "svelte";
	import FridayPlugin from "../main";

	// 接收 props
	export let app: App;
	export let plugin: FridayPlugin;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	// Note: This component is only loaded on desktop (via dynamic import in main.ts)
	// No platform check needed here

	onMount(async () => {
		// Desktop-only initialization can go here
	});

	onDestroy(() => {
	});

</script>


<div class="friday-plugin-main site-builder">
	<section id="friday-plugin-main" class="friday-plugin-shell">
		<!-- 标签页内容 -->
		<div class="friday-tab-content">
				<div
					class="friday-tab-panel"
					role="tabpanel" 
					id="panel-site" 
					aria-labelledby="tab-site" 
					tabindex="0"
				>
					<Site {app} {plugin} />
				</div>
		</div>
	</section>
</div>

<style>
	.friday-plugin-main {
		padding: 0;
		width: 100%;
		height: 100%;
		min-height: 0;
		position: relative;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
	}

	.friday-plugin-shell {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.friday-tab-content {
		flex: 1;
		min-height: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.friday-tab-panel {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.friday-tab-panel :global(.mdf-publish-panel) {
		flex: 1;
		min-height: 0;
	}
</style>

<script lang="ts">
	import type FridayPlugin from '../../main';
	import type { PublishMode, SelectionKind } from '../../types/publish-config';
	import type { CatalogEntry } from '../../theme/types';
	import BrandHeader from './BrandHeader.svelte';
	import SelectionHeader from './SelectionHeader.svelte';
	import ModeSwitch from './ModeSwitch.svelte';
	import ThemePicker from './ThemePicker.svelte';
	import ProtectPanel from './ProtectPanel.svelte';
	import PublishActions from './PublishActions.svelte';
	import RecentOutput from './RecentOutput.svelte';
	import DomainSection from '../DomainSection.svelte';
	import HistorySection from '../HistorySection.svelte';
	import AccountFooter from '../AccountFooter.svelte';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;

	export let selectionKind: SelectionKind;
	export let fileName: string;
	export let pathLabel: string;
	export let publishMode: PublishMode;
	export let showModeSwitch: boolean;
	export let showFolderModeFixed: boolean;
	export let showThemePicker: boolean;
	export let modeHint: string;

	export let themeList: CatalogEntry[];
	export let selectedThemeSlug: string;
	export let themesLoading: boolean;

	export let sitePassword: string;

	export let showAuthTip: boolean;
	export let isPublishing: boolean;
	export let publishProgress: number;
	export let autoPublishEnabled: boolean;
	export let publishUrl: string;
	export let publishError: string;
	export let hasContent: boolean;

	export let previewUrl: string;
	export let isPreviewBuilding: boolean;
	export let buildProgress: number;

	export let outputTab: 'online' | 'preview';
	export let projectName: string;

	export let onSetMode: (mode: PublishMode) => void;
	export let onSelectTheme: (slug: string) => void;
	export let onOpenThemesCatalog: () => void;
	export let onPasswordChange: (value: string) => void;
	export let onPublish: () => void;
	export let onPreview: () => void;
	export let onStopPublish: () => void;
	export let onOpenUrl: () => void;
	export let onCopyUrl: () => void;
	export let onRevokeShare: () => void;
	export let onOpenPreview: () => void;
	export let onCopyPreview: () => void;
	export let onOutputTabChange: (tab: 'online' | 'preview') => void;
	export let onContinueAuth: () => void;
	export let onOpenAccount: () => void;
	export let onDomainActive: (hostname: string) => void;

	$: publishLabel = publishUrl
		? t('ui.publish_again')
		: selectionKind === 'folder'
			? t('ui.publish_site')
			: t('ui.publish');
	$: actionsDisabled = !hasContent || isPublishing;
</script>

<div class="mdf-publish-panel site-builder">
	<div class="mdf-panel-header">
		<BrandHeader title="MDFriday Publish" />
	</div>

	<div class="mdf-panel-scroll">
		<SelectionHeader
			{fileName}
			{pathLabel}
			kind={selectionKind}
			badgeNote={t('ui.badge_note')}
			badgeWiki={t('ui.badge_wiki')}
			emptyHint={t('ui.no_content_selected_hint')}
		/>

		{#if showModeSwitch}
			<ModeSwitch
				mode={publishMode}
				label={t('ui.publish_mode')}
				faithfulLabel={t('ui.mode_faithful')}
				themedLabel={t('ui.mode_themed')}
				hint={modeHint}
				onChange={onSetMode}
			/>
		{:else if showFolderModeFixed}
			<section class="mdf-fixed-mode">
				<div class="mdf-label">{t('ui.publish_mode')}</div>
				<div class="mdf-fixed-card">{t('ui.mode_themed_fixed')}</div>
			</section>
		{/if}

		{#if showThemePicker}
			<ThemePicker
				label={t('ui.theme')}
				themes={themeList}
				selectedSlug={selectedThemeSlug}
				loading={themesLoading}
				liveDemoLabel={t('ui.theme_live_demo')}
				allThemesLabel={t('ui.theme_all')}
				onSelect={onSelectTheme}
				onOpenCatalog={onOpenThemesCatalog}
			/>
		{/if}

		<ProtectPanel
			label={t('ui.encrypt')}
			encryptedLabel={t('ui.encrypted')}
			offLabel={t('ui.encrypt_off')}
			value={sitePassword}
			placeholder={t('ui.site_password_placeholder')}
			showLabel={t('settings.show_password')}
			hideLabel={t('settings.hide_password')}
			onChange={onPasswordChange}
		/>

		<div class="mdf-domain-slot">
			<DomainSection {plugin} {projectName} onDomainActive={onDomainActive} />
		</div>

		<PublishActions
			{publishLabel}
			previewLabel={t('ui.preview_action')}
			stopLabel={t('ui.stop')}
			buildingLabel={t('ui.publish_building')}
			previewBuildingLabel={t('ui.preview_preparing')}
			authTip={t('ui.publish_auth_tip')}
			{showAuthTip}
			disabled={actionsDisabled}
			hasContent={hasContent}
			{isPublishing}
			{isPreviewBuilding}
			{autoPublishEnabled}
			{publishProgress}
			{buildProgress}
			onPublish={onPublish}
			onPreview={onPreview}
			onStop={onStopPublish}
		/>

		<RecentOutput
			title={t('ui.recent_output')}
			onlineLabel={t('ui.output_online')}
			previewLabel={t('ui.output_preview')}
			openLabel={t('ui.open')}
			copyLabel={t('ui.copy')}
			revokeLabel={t('ui.revoke_share')}
			emptyOnline={t('ui.output_empty_online')}
			emptyPreview={t('ui.output_empty_preview')}
			tab={outputTab}
			onlineUrl={publishUrl}
			{previewUrl}
			onlineError={publishError}
			onTabChange={onOutputTabChange}
			onOpenOnline={onOpenUrl}
			onCopyOnline={onCopyUrl}
			onRevoke={onRevokeShare}
			onOpenPreview={onOpenPreview}
			onCopyPreview={onCopyPreview}
		/>

		<HistorySection {plugin} {projectName} />
	</div>

	<div class="mdf-panel-footer">
		<AccountFooter {plugin} {onContinueAuth} {onOpenAccount} />
	</div>
</div>

<style>
	.mdf-publish-panel {
		--mdf-panel: #eff1f5;
		--mdf-card: #ffffff;
		--mdf-soft: #e7e9ee;
		--mdf-stroke: #bdc0cb;
		--mdf-ink: #2e303b;
		--mdf-muted: #4d4f67;
		--mdf-hint: #8b8fa3;
		--mdf-primary: #9375ef;
		--mdf-danger: #e05454;
		--mdf-radius: 8px;
		--mdf-gap: 12px;
		--mdf-pad: 16px;

		height: 100%;
		min-height: 0;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		padding: var(--mdf-pad);
		gap: 0;
		font-family: var(--font-interface);
		color: var(--mdf-ink);
		background: var(--mdf-panel);
	}

	.mdf-panel-header {
		flex-shrink: 0;
		padding: 0;
	}

	.mdf-panel-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0;
	}

	.mdf-panel-footer {
		flex-shrink: 0;
		padding: var(--mdf-gap) 0 0;
		border-top: none;
		background: transparent;
	}

	.mdf-label {
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 8px;
		color: var(--mdf-ink);
	}

	.mdf-fixed-mode {
		margin-bottom: var(--mdf-gap);
	}

	.mdf-fixed-card {
		min-height: 40px;
		padding: 12px;
		border-radius: var(--mdf-radius);
		font-size: 13px;
		color: var(--mdf-hint);
		border: 1px solid var(--mdf-stroke);
		background: var(--mdf-card);
		box-sizing: border-box;
	}

	.mdf-domain-slot {
		margin-bottom: 0;
	}

	/* Domain / History fold cards — match ProtectPanel */
	.mdf-panel-scroll :global(.capability-section) {
		margin-bottom: var(--mdf-gap);
		border: 1px solid var(--mdf-stroke);
		border-radius: var(--mdf-radius);
		background: var(--mdf-card);
		overflow: hidden;
		box-shadow: none;
	}

	.mdf-panel-scroll :global(.mdf-fold-toggle),
	.mdf-panel-scroll :global(.capability-section > .subsection-toggle) {
		min-height: 40px;
		padding: 12px;
		gap: 4px;
		background: transparent;
		box-shadow: none;
	}

	.mdf-panel-scroll :global(.setting-item-name) {
		flex: 0 0 auto;
		font-size: 14px;
		font-weight: 600;
		color: var(--mdf-ink);
	}

	.mdf-panel-scroll :global(.capability-sep) {
		margin: 0 4px;
		color: var(--mdf-hint);
	}

	.mdf-panel-scroll :global(.capability-summary) {
		margin-left: 0 !important;
		text-align: left !important;
		font-size: 13px;
		color: var(--mdf-muted);
		font-weight: 500;
	}

	.mdf-panel-scroll :global(.mdf-fold-chevron) {
		margin-left: auto;
		color: var(--mdf-hint);
	}

	.mdf-panel-scroll :global(.capability-body) {
		padding: 12px;
		border-top: 1px solid var(--mdf-stroke);
		background: var(--mdf-card);
		gap: 8px;
	}

	.mdf-panel-scroll :global(.history-count-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--mdf-soft);
		color: var(--mdf-muted);
		font-size: 11px;
		font-weight: 600;
	}
</style>

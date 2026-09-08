<script lang="ts">
	import type FridayPlugin from '../../main';
	import type { PublishMode, SelectionKind } from '../../types/publish-config';
	import type { CatalogEntry } from '../../theme/types';
	import DomainSection from '../DomainSection.svelte';
	import HistorySection from '../HistorySection.svelte';
	import { filterThemesForSelection } from '../../utils/theme';
	import { onDestroy, onMount } from 'svelte';

	export let plugin: FridayPlugin;
	export let t: (key: string, params?: Record<string, unknown>) => string;

	export let selectionKind: SelectionKind;
	export let fileName: string;
	export let pathLabel: string;
	export let publishMode: PublishMode;
	export let showModeSwitch: boolean;
	export let showFolderModeFixed: boolean;
	export let showThemePicker: boolean;

	export let themeList: CatalogEntry[];
	export let selectedThemeSlug: string;
	export let themesLoading: boolean;

	export let sitePassword: string;

	export let showAuthTip: boolean;
	export let authPrepareStep: 'idle' | 'prepare' | 'waiting' = 'idle';
	export let isPublishing: boolean;
	export let publishProgress: number;
	export let publishUrl: string;
	export let publishError: string;
	export let publishErrorAction: 'claim_free' | 'upgrade_personal' | null = null;
	export let hasContent: boolean;
	export let publishRevoked: boolean = false;
	export let pathRemembered: boolean = false;

	export let previewUrl: string;
	export let isPreviewBuilding: boolean;
	export let buildProgress: number;
	export let hasPreview: boolean = false;
	export let previewWasStopped: boolean = false;

	export let lastCompletedAction: 'preview' | 'publish' | null = null;

	export let historyRefreshKey: number = 0;
	/** Bump when account quota snapshot changes (forces banner re-read). */
	export let quotaRevision: number = 0;
	/** Bump after claim / account refresh — closes softgate and re-reads plan. */
	export let accountEpoch: number = 0;
	export let projectName: string;

	export let onSetMode: (mode: PublishMode) => void;
	export let onSelectTheme: (slug: string) => void;
	export let onOpenThemesCatalog: () => void;
	export let onPasswordChange: (value: string) => void;
	export let onPublish: () => void;
	export let onPreview: () => void;
	export let onStopPreview: () => void;
	export let onOpenUrl: () => void;
	export let onCopyUrl: () => void;
	export let onRevokeShare: () => void;
	export let onRolledBack: (() => void | Promise<void>) | undefined = undefined;
	/** Called when user opens Account claim in browser — start focus/poll refresh. */
	export let onClaimStarted: (() => void) | undefined = undefined;
	export let onOpenPreview: () => void;
	export let onCopyPreview: () => void;
	export let onContinueAuth: () => void;
	export let onOpenAccount: () => void;
	export let onDomainActive: (hostname: string) => void;
	export let onDismissResult: () => void;
	export let onDismissAuthTip: () => void = () => {};

	type PanelTab = 'publish' | 'history';
	type PlanTier = 'guest' | 'free' | 'personal';

	let activeTab: PanelTab = 'publish';
	let planOpen = false;
	let advancedOpen = false;
	let softgateOpen = false;
	let passwordOn = false;

	$: kind = (accountEpoch, quotaRevision, (plugin.settings.mdfKeyKind || '').toLowerCase());
	$: plan = (accountEpoch, quotaRevision, (plugin.settings.mdfKeyPlan || '').toLowerCase());
	$: hasKey = !!(accountEpoch, quotaRevision, plugin.settings.mdfKey);
	$: planTier = (
		!hasKey || kind === 'guest' || plan === 'guest'
			? 'guest'
			: plan === 'personal' || plan === 'pro'
				? 'personal'
				: 'free'
	) as PlanTier;
	$: isPersonal = planTier === 'personal';
	$: isGuest = planTier === 'guest';

	let prevAccountEpoch = 0;
	$: if (accountEpoch !== prevAccountEpoch) {
		prevAccountEpoch = accountEpoch;
		softgateOpen = false;
		planOpen = false;
		activeTab = 'publish';
	}
	$: filteredThemes = filterThemesForSelection(themeList, selectionKind);
	$: showThemes = showThemePicker || (showFolderModeFixed && publishMode === 'themed');
	$: themeSectionLabel =
		selectionKind === 'folder' ? t('ui.theme_section_wiki') : t('ui.theme_section_note');

	$: needVerify =
		showAuthTip || authPrepareStep === 'prepare' || authPrepareStep === 'waiting';
	$: building = isPublishing || isPreviewBuilding;
	$: progressPct = isPublishing ? publishProgress : buildProgress;
	$: resultKind = !building && lastCompletedAction ? lastCompletedAction : null;
	$: panelView = (softgateOpen
		? 'softgate'
		: needVerify
			? 'verify'
			: building
				? 'building'
				: resultKind
					? 'result'
					: 'idle') as 'idle' | 'verify' | 'building' | 'result' | 'softgate';
	$: showActions = activeTab === 'publish' && panelView === 'idle';
	$: publishPrimaryLabel =
		isGuest && !hasKey
			? t('ui.verify_and_publish')
			: publishUrl
				? t('ui.publish_again')
				: selectionKind === 'folder'
					? t('ui.publish_site')
					: t('ui.publish');
	$: actionsDisabled = !hasContent || building;
	$: projectStatus = (publishRevoked
		? 'revoked'
		: publishUrl
			? 'published'
			: 'unpublished') as 'published' | 'unpublished' | 'revoked';
	$: previewLive = hasPreview && !!previewUrl && !isPreviewBuilding;
	$: accountUrl = (plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account').replace(
		/\/$/,
		'',
	);

	$: if (sitePassword) passwordOn = true;

	$: projectUsed = (quotaRevision, plugin.settings.mdfProjectCount);
	$: projectMax =
		(quotaRevision,
		plugin.settings.mdfQuotaMaxProjects ??
			(planTier === 'guest' ? 1 : planTier === 'free' ? 3 : null));
	$: storageUsed = (quotaRevision, plugin.settings.mdfStorageBytes);
	$: storageMax =
		(quotaRevision,
		plugin.settings.mdfQuotaStorageBytes ??
			(planTier === 'guest' ? 5 * 1024 * 1024 : planTier === 'free' ? 50 * 1024 * 1024 : null));

	function formatBytesShort(n: number | null | undefined): string {
		if (n == null || !Number.isFinite(n)) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
		return `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
	}

	$: projectsLine =
		projectMax == null
			? projectUsed != null
				? t('ui.quota_projects_unlimited').replace('{{used}}', String(projectUsed))
				: t('ui.quota_projects_unlimited_label')
			: t('ui.quota_projects')
					.replace('{{used}}', String(projectUsed ?? 0))
					.replace('{{max}}', String(projectMax));

	$: storageLine = t('ui.quota_storage')
		.replace('{{used}}', formatBytesShort(storageUsed ?? 0))
		.replace('{{max}}', formatBytesShort(storageMax));

	$: bannerPrimary =
		planTier === 'guest'
			? t('ui.banner_guest_lead')
			: planTier === 'free'
				? t('ui.banner_free_lead')
				: '';

	$: bannerCtaLabel =
		planTier === 'guest' ? t('ui.plan_cta_claim_sites') : t('ui.plan_cta_upgrade_sites');

	function accountUrlWithKey(extra = '') {
		const key = plugin.settings.mdfKey;
		const q = new URLSearchParams();
		if (key) q.set('key', key);
		if (extra === 'upgrade') q.set('upgrade', 'personal');
		const qs = q.toString();
		return qs ? `${accountUrl}/?${qs}` : `${accountUrl}/`;
	}

	function togglePlan(e?: MouseEvent) {
		e?.stopPropagation();
		planOpen = !planOpen;
	}

	function onDocClick(ev: MouseEvent) {
		const target = ev.target as HTMLElement | null;
		if (
			!target?.closest?.('.plan-popover') &&
			!target?.closest?.('.plan-pill') &&
			!target?.closest?.('.upgrade-banner')
		) {
			planOpen = false;
		}
	}

	function onKey(ev: KeyboardEvent) {
		if (ev.key === 'Escape') {
			planOpen = false;
			softgateOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
	});
	onDestroy(() => {
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
	});

	function setTab(tab: PanelTab) {
		activeTab = tab;
		planOpen = false;
		softgateOpen = false;
	}

	function openSoftgate(e?: MouseEvent) {
		e?.stopPropagation();
		softgateOpen = true;
		planOpen = false;
		activeTab = 'publish';
	}

	function closeSoftgate() {
		softgateOpen = false;
	}

	function openPlans(e?: MouseEvent) {
		e?.stopPropagation();
		softgateOpen = false;
		planOpen = true;
	}

	function openClaimAccount(e?: MouseEvent) {
		e?.stopPropagation();
		const url = accountUrlWithKey();
		window.open(url, '_blank', 'noopener');
		onClaimStarted?.();
	}

	function onQuotaCta(e?: MouseEvent) {
		e?.stopPropagation();
		if (publishErrorAction === 'claim_free' || planTier === 'guest') {
			openClaimAccount(e);
			return;
		}
		window.open(accountUrlWithKey('upgrade'), '_blank', 'noopener');
	}

	function toggleAdvanced() {
		advancedOpen = !advancedOpen;
	}

	function togglePassword() {
		if (!isPersonal) return;
		passwordOn = !passwordOn;
		if (!passwordOn) onPasswordChange('');
	}

	function onPwdInput(e: Event) {
		onPasswordChange((e.currentTarget as HTMLInputElement).value);
	}

	function demoUrl(entry: CatalogEntry): string {
		if (entry.demoUrl) return entry.demoUrl;
		return `https://mdfriday.com/demo/${entry.slug}/index.html`;
	}

	function openDemo(e: MouseEvent, entry: CatalogEntry) {
		e.stopPropagation();
		e.preventDefault();
		window.open(demoUrl(entry), '_blank', 'noopener');
	}

	function copyProjectUrl() {
		if (!publishUrl || projectStatus === 'revoked') return;
		void onCopyUrl();
	}

	function handlePublishClick() {
		onPublish();
	}

	function handleResultBack() {
		onDismissResult();
	}

	function handleStopPreview() {
		onStopPreview();
		if (resultKind === 'preview') onDismissResult();
	}
</script>

<div class="mdf-apple-panel">
	<div class="panel-header">
		<div class="panel-title-row">
			<header class="mdf-brand-header">
				<a
					class="mdf-brand-link"
					href="https://mdfriday.com"
					target="_blank"
					rel="noopener noreferrer"
					title="MDFriday"
				>
					<img
						class="mdf-logo"
						src="https://gohugo.net/mdfriday.svg"
						width="18"
						height="18"
						alt="MDFriday"
					/>
					<span class="mdf-brand-title">MDFriday Publish</span>
				</a>
			</header>
			<button
				type="button"
				class="plan-pill {planTier}"
				class:open={planOpen}
				title={t('ui.plan_pill_title')}
				on:click={togglePlan}
			>
				{planTier === 'guest' ? 'Guest' : planTier === 'free' ? 'Free' : 'Personal'}
			</button>
		</div>

		<div class="panel-tabs">
			<button
				type="button"
				class="panel-tab"
				class:active={activeTab === 'publish'}
				on:click={() => setTab('publish')}
			>
				{t('ui.tab_publish')}
			</button>
			<button
				type="button"
				class="panel-tab"
				class:active={activeTab === 'history'}
				on:click={() => setTab('history')}
			>
				{t('ui.tab_history')}
			</button>
		</div>

		{#if planOpen}
			<div class="plan-popover" role="dialog" aria-label={t('ui.plan_compare')}>
				<div class="pp-title">{t('ui.plan_choose')}</div>
				<div class="pp-note">{t('ui.plan_note')}</div>

				<div class="pp-tier" class:current={planTier === 'guest'}>
					<div class="pp-head">
						<div class="pp-name">Guest</div>
						<span class="pp-tag">{planTier === 'guest' ? t('ui.plan_current') : t('ui.plan_tier')}</span>
					</div>
					<div class="pp-best">{t('ui.plan_guest_best')}</div>
					<div class="pp-price"><span class="muted">{t('ui.plan_guest_price')}</span></div>
					<ul class="pp-benefits">
						<li>{t('ui.plan_guest_b1')}</li>
						<li>{t('ui.plan_guest_b_projects')}</li>
						<li>{t('ui.plan_guest_b3')}</li>
						<li>{t('ui.plan_guest_b4')}</li>
						<li>{t('ui.plan_guest_b5')}</li>
						<li class="note">{t('ui.plan_guest_note')}</li>
					</ul>
					{#if planTier === 'guest'}
						<span class="pp-cta current-cta">{t('ui.plan_current')}</span>
					{:else}
						<a
							class="pp-cta secondary"
							href="https://obsidian.md/plugins?search=mdfriday-publish"
							target="_blank"
							rel="noopener">{t('ui.plan_install_plugin')}</a
						>
					{/if}
				</div>

				<div class="pp-tier" class:current={planTier === 'free'}>
					<div class="pp-head">
						<div class="pp-name">Free</div>
						<span class="pp-tag">{planTier === 'free' ? t('ui.plan_current') : t('ui.plan_upgrade')}</span>
					</div>
					<div class="pp-best">{t('ui.plan_free_best')}</div>
					<div class="pp-price"><span class="muted">{t('ui.plan_free_price')}</span></div>
					<ul class="pp-benefits">
						<li>{t('ui.plan_free_b1')}</li>
						<li>{t('ui.plan_free_b_projects')}</li>
						<li>{t('ui.plan_free_b3')}</li>
						<li>{t('ui.plan_free_b4')}</li>
						<li>{t('ui.plan_free_b5')}</li>
						<li class="note">{t('ui.plan_free_note')}</li>
					</ul>
					{#if planTier === 'free'}
						<button type="button" class="pp-cta current-cta" on:click={onOpenAccount}>{t('ui.account_manage')}</button>
					{:else}
						<a class="pp-cta" href={accountUrlWithKey()} target="_blank" rel="noopener">{t('ui.plan_cta_claim_sites')}</a>
					{/if}
				</div>

				<div class="pp-tier" class:current={planTier === 'personal'}>
					<div class="pp-head">
						<div class="pp-name">Personal</div>
						<span class="pp-tag">{planTier === 'personal' ? t('ui.plan_current') : t('ui.plan_upgrade')}</span>
					</div>
					<div class="pp-best">{t('ui.plan_personal_best')}</div>
					<div class="pp-price">$5 <span class="muted">{t('ui.plan_per_month')}</span></div>
					<ul class="pp-benefits">
						<li>{t('ui.plan_personal_b1')}</li>
						<li>{t('ui.plan_personal_b_projects')}</li>
						<li>{t('ui.plan_personal_b2')}</li>
						<li>{t('ui.plan_personal_b3')}</li>
						<li>{t('ui.plan_personal_b4')}</li>
						<li>{t('ui.plan_personal_b5')}</li>
					</ul>
					{#if planTier === 'personal'}
						<button type="button" class="pp-cta current-cta" on:click={onOpenAccount}>{t('ui.account_manage_sub')}</button>
					{:else}
						<a class="pp-cta" href={accountUrlWithKey('upgrade')} target="_blank" rel="noopener">{t('ui.plan_cta_upgrade_sites')}</a>
					{/if}
				</div>

				<div class="pp-footer">{t('ui.plan_footer')}</div>
			</div>
		{/if}
	</div>

	{#if activeTab === 'publish'}
		<div class="panel-scroll">
			{#if panelView === 'idle'}
				{#if projectStatus === 'unpublished'}
					<div class="card" style="padding:10px 14px;">
						<div class="status-row" style="margin:0;">
							<span class="status-dot unpublished"></span>
							<span class="status-text" style="font-size:12px;font-weight:600;">{t('ui.project_unpublished')}</span>
						</div>
						<p class="helper" style="margin-top:4px;">{t('ui.project_unpublished_hint')}</p>
						{#if previewLive}
							<div class="preview-live-row">
								<span class="pl-dot" aria-hidden="true"></span>
								<div class="pl-body">
									<div class="pl-title">{t('ui.preview_live')}</div>
									<div class="pl-url">{previewUrl}</div>
								</div>
								<button type="button" class="pl-stop" on:click={handleStopPreview}>{t('ui.stop')}</button>
							</div>
						{:else if previewWasStopped}
							<div class="preview-stopped-row">
								<span class="ps-dot" aria-hidden="true"></span>
								<span>{t('ui.preview_stopped')}</span>
							</div>
						{/if}
					</div>
				{:else}
					<div class="project-strip" class:revoked={projectStatus === 'revoked'}>
						<div class="status-row">
							<span class="status-dot" class:revoked={projectStatus === 'revoked'}></span>
							<span class="status-text">
								{projectStatus === 'revoked' ? t('ui.project_revoked') : t('ui.project_published')}
							</span>
						</div>
						{#if publishUrl}
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								class="url-line"
								class:disabled={projectStatus === 'revoked'}
								title={t('ui.copy')}
								on:click={copyProjectUrl}
							>
								{publishUrl}
							</div>
						{/if}
						{#if pathRemembered}
							<div class="remember-badge">✓ {t('ui.project_remembered')}</div>
						{/if}
						{#if previewLive}
							<div class="preview-live-row">
								<span class="pl-dot" aria-hidden="true"></span>
								<div class="pl-body">
									<div class="pl-title">{t('ui.preview_live')}</div>
									<div class="pl-url">{previewUrl}</div>
								</div>
								<button type="button" class="pl-stop" on:click={handleStopPreview}>{t('ui.stop')}</button>
							</div>
						{:else if previewWasStopped}
							<div class="preview-stopped-row">
								<span class="ps-dot" aria-hidden="true"></span>
								<span>{t('ui.preview_stopped')}</span>
							</div>
						{/if}
					</div>
				{/if}

				<div class="section-label">{t('ui.target_label')}</div>
				<div class="card">
					<div class="target-card">
						<div class="target-icon" aria-hidden="true">
							{#if selectionKind === 'folder'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path
										d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
										fill="#AEAEB2"
									/>
									<path d="M3 10h18" stroke="#fff" stroke-width="1.5" opacity="0.5" />
								</svg>
							{:else}
								<svg width="16" height="18" viewBox="0 0 16 18" fill="none">
									<path
										d="M2.5 1.5h7.2L13.5 5.3V16a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z"
										fill="#fff"
										stroke="#C7C7CC"
										stroke-width="1"
									/>
									<path d="M9.5 1.5V5h3.8" stroke="#C7C7CC" stroke-width="1" />
									<path d="M4.5 9h7M4.5 11.5h7M4.5 14h4.5" stroke="#D1D1D6" stroke-width="1" stroke-linecap="round" />
								</svg>
							{/if}
						</div>
						<div class="target-info">
							<div class="target-name">{fileName || t('ui.no_content_selected_hint')}</div>
							<div class="target-path">{pathLabel || fileName || ''}</div>
						</div>
						<span class="target-kind-tag">
							{selectionKind === 'folder' ? t('ui.badge_wiki') : t('ui.badge_note')}
						</span>
					</div>
				</div>

				<div class="section-label">{t('ui.publish_method')}</div>
				<div class="card card-modes">
					<div class="mode-seg" role="radiogroup" aria-label={t('ui.publish_method')}>
						{#if showModeSwitch}
							<!-- Use div (not button) so Obsidian global button chrome cannot pill/reshape these options -->
							<div
								class="mode-option"
								class:active={publishMode === 'faithful'}
								role="radio"
								aria-checked={publishMode === 'faithful'}
								tabindex="0"
								on:click={() => onSetMode('faithful')}
								on:keydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSetMode('faithful');
									}
								}}
							>
								<div class="mode-row">
									<div class="mode-copy">
										<div class="mode-title">{t('ui.mode_faithful')}</div>
										<div class="mode-desc">{t('ui.mode_faithful_hint')}</div>
									</div>
									<span class="radio" aria-hidden="true"></span>
								</div>
							</div>
							<div
								class="mode-option"
								class:active={publishMode === 'themed'}
								role="radio"
								aria-checked={publishMode === 'themed'}
								tabindex="0"
								on:click={() => onSetMode('themed')}
								on:keydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSetMode('themed');
									}
								}}
							>
								<div class="mode-row">
									<div class="mode-copy">
										<div class="mode-title">{t('ui.mode_themed_note')}</div>
										<div class="mode-desc">{t('ui.mode_themed_hint')}</div>
									</div>
									<span class="radio" aria-hidden="true"></span>
								</div>
							</div>
							<p class="helper mode-helper">
								{publishMode === 'faithful'
									? t('ui.mode_faithful_helper')
									: t('ui.mode_themed_helper')}
							</p>
						{:else if showFolderModeFixed}
							<div class="mode-option is-disabled" aria-disabled="true">
								<div class="mode-row">
									<div class="mode-copy">
										<div class="mode-title">
											{t('ui.mode_faithful')}
											<span class="disabled-tag">{t('ui.mode_unavailable')}</span>
										</div>
										<div class="mode-desc">{t('ui.mode_folder_faithful_disabled')}</div>
									</div>
									<span class="radio" aria-hidden="true"></span>
								</div>
							</div>
							<div
								class="mode-option active"
								role="radio"
								aria-checked="true"
								tabindex="0"
								on:click={() => onSetMode('themed')}
								on:keydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSetMode('themed');
									}
								}}
							>
								<div class="mode-row">
									<div class="mode-copy">
										<div class="mode-title">{t('ui.mode_wiki')}</div>
										<div class="mode-desc">{t('ui.mode_folder_hint')}</div>
									</div>
									<span class="radio" aria-hidden="true"></span>
								</div>
							</div>
							<p class="helper mode-helper">{t('ui.mode_folder_helper')}</p>
						{/if}
					</div>
				</div>

				{#if showThemes}
					<div class="section-label">{themeSectionLabel}</div>
					{#if themesLoading}
						<p class="helper">{t('ui.loading')}…</p>
					{:else if filteredThemes.length === 0}
						<p class="helper">{t('ui.theme_empty')}</p>
						<button type="button" class="btn btn-ghost" on:click={onOpenThemesCatalog}>{t('ui.theme_all')}</button>
					{:else}
						<div class="theme-list">
							{#each filteredThemes as theme (theme.slug)}
								<button
									type="button"
									class="theme-row"
									class:selected={selectedThemeSlug === theme.slug}
									on:click={() => onSelectTheme(theme.slug)}
								>
									<div class="theme-meta">
										<div class="theme-name">{theme.name}</div>
									</div>
									<a
										class="theme-demo"
										href={demoUrl(theme)}
										target="_blank"
										rel="noopener"
										on:click={(e) => openDemo(e, theme)}>{t('ui.theme_live_demo')}</a
									>
									<div class="theme-check">✓</div>
								</button>
							{/each}
						</div>
					{/if}
				{/if}

				{#if bannerPrimary}
					<div class="upgrade-banner">
						<div class="ub-copy">
							<div class="ub-lead">{bannerPrimary}</div>
							<div class="ub-meta">{projectsLine} · {storageLine}</div>
						</div>
						<div class="ub-actions">
							<button type="button" class="link" on:click={openPlans}>{t('ui.view_plans')}</button>
							<span class="ub-sep" aria-hidden="true">·</span>
							{#if isGuest}
								<button type="button" class="link ub-cta" on:click={openClaimAccount}>{bannerCtaLabel}</button>
							{:else}
								<a
									class="link ub-cta"
									href={accountUrlWithKey('upgrade')}
									target="_blank"
									rel="noopener">{bannerCtaLabel}</a
								>
							{/if}
						</div>
					</div>
				{/if}

				<div class="advanced-card" class:open={advancedOpen}>
					<!-- div avoids Obsidian global button chrome (pill radius / min-height) -->
					<div
						class="advanced-toggle"
						role="button"
						tabindex="0"
						aria-expanded={advancedOpen}
						on:click={toggleAdvanced}
						on:keydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleAdvanced();
							}
						}}
					>
						<span class="adv-text">
							<span class="adv-label">{t('ui.advanced_options')}</span>
							<span class="adv-hint">{t('ui.advanced_options_hint')}</span>
						</span>
						<span class="chev" aria-hidden="true">
							<svg
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								stroke-width="2.2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M4 6l4 4 4-4" />
							</svg>
						</span>
					</div>
					{#if advancedOpen}
						<div class="advanced-body">
							<div class="field-group">
								<div class="toggle-row">
									<span class="field-label" style="margin:0;">{t('ui.access_password')}</span>
									<div
										class="toggle"
										class:on={passwordOn && isPersonal}
										class:is-disabled={!isPersonal}
										role="switch"
										aria-checked={passwordOn && isPersonal}
										aria-disabled={!isPersonal}
										tabindex={isPersonal ? 0 : -1}
										aria-label={t('ui.access_password')}
										on:click={togglePassword}
										on:keydown={(e) => {
											if (!isPersonal) return;
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												togglePassword();
											}
										}}
									></div>
								</div>
								<input
									class="field-input"
									type="password"
									placeholder={t('ui.site_password_placeholder')}
									value={sitePassword}
									disabled={!isPersonal || !passwordOn}
									on:input={onPwdInput}
								/>
								{#if isPersonal}
									<p class="helper">{t('ui.password_helper')}</p>
								{:else}
									<p class="helper lock">{t('ui.password_personal_only')}</p>
								{/if}
							</div>

							<div class="field-group">
								<div class="field-label">
									{t('ui.custom_domain')}
									{#if !isPersonal}
										<span class="domain-status">{t('ui.domain_unbound')}</span>
									{/if}
								</div>
								{#if isPersonal}
									<div class="apple-domain-slot">
										<DomainSection
											{plugin}
											{projectName}
											onDomainActive={onDomainActive}
											layout="embedded"
										/>
									</div>
								{:else}
									<input
										class="field-input"
										type="text"
										placeholder="notes.example.com"
										disabled
									/>
									<p class="helper lock">{t('ui.domain_personal_only')}</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				{#if publishError}
					<div class="quota-error" class:is-quota={!!publishErrorAction}>
						<p class="helper warn">{publishError}</p>
						{#if publishErrorAction}
							<button type="button" class="btn btn-primary btn-pill" on:click={onQuotaCta}>
								{publishErrorAction === 'claim_free'
									? t('ui.plan_cta_claim_sites')
									: t('ui.plan_cta_upgrade_sites')}
							</button>
						{/if}
					</div>
				{/if}
			{:else if panelView === 'verify'}
				<div class="state-view">
					<div class="verify-icon">🛡</div>
					<div class="state-title">{t('ui.verify_title')}</div>
					<div class="state-desc">{t('ui.verify_desc')}</div>
					<div class="verify-steps">
						<ol>
							<li>{t('ui.verify_step1')}</li>
							<li>{t('ui.verify_step2')}</li>
							<li>{t('ui.verify_step3')}</li>
						</ol>
					</div>
					<div style="width:100%;display:flex;flex-direction:column;gap:8px;">
						<button type="button" class="btn btn-primary btn-full" on:click={onContinueAuth}>
							{authPrepareStep === 'waiting' ? t('ui.publish_prepare_waiting') : t('ui.verify_go')}
						</button>
						<button type="button" class="btn btn-ghost" on:click={() => onDismissAuthTip()}>{t('ui.cancel')}</button>
					</div>
				</div>
			{:else if panelView === 'building'}
				<div class="state-view">
					<div class="spinner"></div>
					<div class="state-title">{t('ui.building_title')}</div>
					<div class="state-desc">
						{isPreviewBuilding ? t('ui.building_preview') : t('ui.building_publish')}
					</div>
					<div class="progress-track">
						<div class="progress-fill" style="width: {Math.max(4, progressPct)}%"></div>
					</div>
				</div>
			{:else if panelView === 'result' && resultKind}
				<div class="state-view state-result">
					<div class="result-badge {resultKind}">
						{resultKind === 'preview' ? t('ui.result_badge_preview') : t('ui.result_badge_publish')}
					</div>
					<div class="success-check" class:preview={resultKind === 'preview'} aria-hidden="true">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
							<path
								d="M5 12.5 9.5 17 19 7.5"
								stroke="currentColor"
								stroke-width="2.4"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<div class="state-title">
						{resultKind === 'preview' ? t('ui.result_title_preview') : t('ui.result_title_publish')}
					</div>
					<div class="state-desc">
						{resultKind === 'preview' ? t('ui.result_desc_preview') : t('ui.result_desc_publish')}
					</div>
					<div class="success-url-box">
						<div class="url">{resultKind === 'preview' ? previewUrl : publishUrl}</div>
						<div class="success-actions">
							<button
								type="button"
								class="btn btn-secondary btn-sm"
								on:click={resultKind === 'preview' ? onCopyPreview : onCopyUrl}>{t('ui.copy')}</button
							>
							<button
								type="button"
								class="btn btn-primary btn-sm"
								on:click={resultKind === 'preview' ? onOpenPreview : onOpenUrl}>{t('ui.open')}</button
							>
						</div>
					</div>
					{#if resultKind === 'preview'}
						<p class="result-helper">{t('ui.result_preview_helper')}</p>
					{/if}
					<div class="result-secondary-wrap">
						{#if resultKind === 'publish' && publishUrl}
							<button type="button" class="btn-danger-soft" on:click={onRevokeShare}>{t('ui.revoke_share')}</button>
						{:else if resultKind === 'preview'}
							<button type="button" class="btn-danger-soft" on:click={handleStopPreview}>{t('ui.stop_preview')}</button>
						{/if}
						<button type="button" class="btn btn-ghost" on:click={handleResultBack}>{t('ui.back')}</button>
					</div>
				</div>
			{:else if panelView === 'softgate'}
				<div class="state-view">
					<div style="font-size:32px;margin-bottom:12px;">✦</div>
					<div class="state-title">{t('ui.softgate_title')}</div>
					<div class="state-desc">{t('ui.softgate_desc')}</div>
					<div class="softgate-benefits">
						<div>{t('ui.softgate_b1')}</div>
						<div>{t('ui.softgate_b2')}</div>
						<div>{t('ui.softgate_b3')}</div>
					</div>
					<div style="width:100%;margin-top:20px;display:flex;flex-direction:column;gap:8px;">
						<button type="button" class="btn btn-primary btn-full" on:click={openClaimAccount}
							>{t('ui.plan_cta_claim_sites')}</button
						>
						<button type="button" class="btn btn-secondary btn-full" on:click={closeSoftgate}>{t('ui.softgate_later')}</button>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="panel-scroll">
			<div class="section-label">{t('ui.history_section')}</div>
			{#if !isPersonal}
				<div class="history-locked">
					<div class="ico" aria-hidden="true">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
							<path
								d="M7 11V8a5 5 0 0 1 10 0v3"
								stroke="#86868B"
								stroke-width="1.8"
								stroke-linecap="round"
							/>
							<rect x="5" y="11" width="14" height="10" rx="2.5" fill="#E8E8ED" stroke="#C7C7CC" stroke-width="1.2" />
							<circle cx="12" cy="16" r="1.4" fill="#86868B" />
						</svg>
					</div>
					<div class="hl-title">{t('ui.history_locked_title')}</div>
					<div class="hl-desc">{t('ui.history_locked_desc')}</div>
					<a
						class="btn btn-primary btn-pill"
						href={accountUrlWithKey('upgrade')}
						target="_blank"
						rel="noopener">{t('ui.account_upgrade_personal')}</a
					>
				</div>
			{:else}
				<div class="apple-history-slot">
					<HistorySection
						{plugin}
						{projectName}
						refreshKey={historyRefreshKey}
						layout="tab"
						canRollback={isPersonal}
						onUnpublish={onRevokeShare}
						onRolledBack={onRolledBack}
					/>
				</div>
			{/if}
		</div>
	{/if}

	<div class="panel-actions" class:is-hidden={!showActions}>
		<button type="button" class="btn btn-secondary" disabled={actionsDisabled} on:click={onPreview}>{t('ui.preview_action')}</button>
		<button type="button" class="btn btn-primary" disabled={actionsDisabled} on:click={handlePublishClick}>{publishPrimaryLabel}</button>
	</div>
</div>

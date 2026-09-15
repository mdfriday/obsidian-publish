<script lang="ts">
	import {App, Notice, TFolder, TFile} from "obsidian";
	import FridayPlugin from "../main";
	import PublishPanel from "./publish/PublishPanel.svelte";
	import {onMount, onDestroy, tick} from "svelte";
	import type { PublishMethod } from "../types/publish";
	import { normalizePublishMethod } from "../types/publish";
	import type { PublishMode } from "../types/publish-config";
	import {
		coercePublishMode,
		getDefaultPublishConfig,
		selectionKindFromContents,
	} from "../types/publish-config";
	import * as path from "path";
	import {GetBaseUrl} from "../main";
	import {themeApiService} from "../theme/themeApiService";
	import type { CatalogEntry } from "../theme/types";
	import type { ProjectState, ProgressUpdate, PublishProgressUpdate } from "../types/events";
	import { buildThemeConfigPatch } from "../theme/theme-config";
	import { resolvePublicBaseUrl, resolveSiteBaseUrl } from "../cloudflare-env";
	import { DEFAULT_THEME_SLUGS, filterThemesForSelection } from "../utils/theme";
	import {
		buildFaithfulToProject,
		serveFaithfulPublicDir,
		stopAllLocalPreviewServers,
	} from "../obsidian-local-preview";
	import {
		resolvePathPublishConfig,
		savePathPublishConfig,
		selectionVaultPath,
	} from "../services/path-config";
	import { normalizeVaultPath, pathsEqual } from "../services/project-path";

	// Receive props
	export let app: App;
	export let plugin: FridayPlugin;
	
	// 获取 site 实例
	$: site = plugin.site;
	$: languageContents = site ? site.languageContents : null;
	$: siteAssets = site ? site.siteAssets : null;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	/** True when catalog siteParams are not yet reflected in project config.params. */
	function configMissingSiteParams(
		params: Record<string, unknown> | undefined,
		siteParams: Record<string, unknown> | undefined,
	): boolean {
		if (!siteParams || Object.keys(siteParams).length === 0) return false;
		const p = params ?? {};
		return Object.keys(siteParams).some((key) => !(key in p));
	}

	// State variables
	let basePath = plugin.pluginDir;
	let absSelectedFolderPath = [];
	let absProjContentPath = [];
	let contentPath = '';
	
	// 从 site 实例获取响应式数据
	$: currentContents = $languageContents || [];
	$: currentAssets = $siteAssets || null;
	$: isForSingleFile = site ? site.isForSingleFile() : false;
	$: defaultContentLanguage = site ? site.getDefaultContentLanguage() : 'en';

	let projectName = '';

	// 用户可编辑的站点名称
	let siteName = '';
	
	// 跟踪之前的内容长度，用于检测首次添加内容
	let previousContentLength = 0;
	
	// 其他配置保持在本地管理
	let sitePath = '/';
	let selectedThemeDownloadUrl: string = '';
	let selectedThemeName: string = 'Quartz';
	let selectedThemeSlug: string = DEFAULT_THEME_SLUGS.QUARTZ;
	
	// 标志用户是否手动选择过主题
	let userHasSelectedTheme = false;
	
	// Publish mode: single note defaults to faithful; folder is always themed.
	let publishMode: PublishMode = 'faithful';
	let showAuthTip = false;
	let outputTab: 'online' | 'preview' = 'online';
	let historyRefreshKey = 0;
	/** Bump after account quota refresh so banner re-reads settings. */
	let quotaRevision = 0;
	/** Bump after claim / account refresh — closes softgate + refreshes plan pill. */
	let accountEpoch = 0;
	/** Bump when published-target list should reload (publish / rename / open). */
	let targetListRevision = 0;
	let claimPollTimer: ReturnType<typeof setInterval> | null = null;
	let claimPollUntil = 0;
	let userChoseMode = false;
	/** Skip path hydrate once (right-click defaults publish). */
	let skipPathHydrate = false;
	let lastHydratedPath: string | null = null;
	let pathConfigSaveTimeout: ReturnType<typeof setTimeout> | null = null;

	$: selectionKind = selectionKindFromContents(currentContents);
	$: showModeSwitch = selectionKind === 'note' && currentContents.length > 0;
	$: showFolderModeFixed = selectionKind === 'folder' && currentContents.length > 0;
	$: showThemePicker =
		currentContents.length > 0 &&
		(selectionKind === 'folder' || publishMode === 'themed');
	$: activeVaultPath = selectionVaultPath(currentContents);
	$: selectionFileName = currentContents[0]
		? currentContents[0].file?.name || currentContents[0].folder?.name || ''
		: '';
	$: selectionPathLabel = currentContents[0]
		? currentContents[0].file?.path ||
			currentContents[0].folder?.path ||
			''
		: '';
	$: modeHint =
		publishMode === 'faithful'
			? t('ui.mode_faithful_hint')
			: t('ui.mode_themed_hint');

	// Hydrate mode/theme from pathConfigs when selection changes (sidebar open).
	$: if (activeVaultPath && activeVaultPath !== lastHydratedPath) {
		void hydrateFromPathConfig(activeVaultPath);
	}
	$: if (!activeVaultPath) {
		lastHydratedPath = null;
	}

	// Advanced settings state
	let showAdvancedInSettings = false;
	let googleAnalyticsId = '';
	let disqusShortname = '';
	let sitePassword = '';
	
	// UI state
	let autoPublishEnabled = false;

	let themesDir = ''; // Directory for themes

	// Preview related state
	let isBuilding = false;
	/** True only while user-triggered local preview is preparing */
	let isPreviewBuilding = false;
	let buildProgress = 0;
	let previewUrl = '';
	let previewId = '';
	let lastCompletedAction: 'preview' | 'publish' | null = null;
	let publishRevoked = false;
	let previewWasStopped = false;
	let hasPreview = false;
	let absPreviewDir = '';

	// Publish related state
	let isPublishing = false;
	let publishProgress = 0;
	let publishSuccess = false;
	let publishUrl = '';
	let publishError = '';
	/** When set, show upgrade CTA under the error (quota / plan limits). */
	let publishErrorAction: 'claim_free' | 'upgrade_personal' | null = null;
	let selectedPublishOption: PublishMethod = normalizePublishMethod();

	/** Pre-auth: show inline before opening Turnstile browser */
	let authPrepareStep: 'idle' | 'prepare' | 'waiting' = 'idle';

	/** Collapsible project capability sections */
	let themeList: CatalogEntry[] = [];
	let themesLoading = false;

	let currentThemeWithSample: any = null;

	// Debounce timeout for auto-saving language configuration
	let languageConfigSaveTimeout: ReturnType<typeof setTimeout> | null = null;
	// Prevent infinite loop when saving language configuration
	let isSavingLanguageConfig: boolean = false;
	// Track last saved configuration to avoid unnecessary saves
	let lastSavedLanguageConfig: string = '';
	
	
	/**
	 * Apply language configuration from Foundry config to UI
	 */
	async function applyLanguageConfiguration(
		languages: Record<string, any>, 
		defaultLang: string,
		skipSave: boolean = false
	) {
		try {
			// Wait for current contents to be available
			await tick();

			if (currentContents.length === 0) {
				return;
			}

			// Build a mapping from contentDir to languageCode
			const contentDirToLang: Record<string, string> = {};
			for (const [langCode, langConfig] of Object.entries(languages)) {
				contentDirToLang[langConfig.contentDir] = langCode;
			}

			// The first content should use the default language
			// content -> defaultContentLanguage
			// content.zh -> zh
			// content.en -> en

			// Apply language to each content based on their index
			currentContents.forEach((content, index) => {
				let expectedLangCode: string;

				if (index === 0) {
					// First content uses default language
					expectedLangCode = defaultLang;
				} else {
					// Try to find language from contentDir mapping
					// This is tricky because we don't have contentDir in currentContents yet
					// So we need to iterate through languages to find non-default one
					const otherLangs = Object.keys(languages).filter(lang => lang !== defaultLang);
					if (otherLangs.length > index - 1) {
						expectedLangCode = otherLangs[index - 1];
					} else {
						// Fallback: keep current language
						expectedLangCode = content.languageCode;
					}
				}
				
				// Update language code if different
				if (content.languageCode !== expectedLangCode) {
					site.updateLanguageCode(content.id, expectedLangCode);
				}
			});
			
			// Wait for updates to complete
			await tick();

			// Save if not skipped
			if (!skipSave) {}
		} catch (error) {
			console.error('[Site] Error applying language configuration:', error);
		}
	}
	
	/**
	 * Save single config value to Foundry
	 * Skips during project initialization
	 */
	/**
	 * Save single config value to Foundry
	 * Uses event system to notify Main.ts
	 */
	async function saveFoundryConfig(key: string, value: any) {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			return;
		}
		
		try {
			// Handle complex nested structures
			let actualKey = key;
			let actualValue = value;
			
			if (key === 'module.imports.0.path') {
				// Save module.imports as an array
				actualKey = 'module';
				actualValue = {
					imports: [{ path: value }]
				};
			} else if (key === 'theme.catalog') {
				actualKey = 'theme';
				actualValue = value;
			} else if (key === 'services.googleAnalytics.id') {
				// Save services as a nested object
				actualKey = 'services';
				actualValue = {
					googleAnalytics: { id: value }
				};
			} else if (key === 'params.disqusShortname' || key === 'params.password' || key === 'params.autoPublish' || key === 'params.lastPublishUrl') {
				// For params, we need to merge with existing params
				const existingConfig = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
				const params = existingConfig['params'] || {};
				
				if (key === 'params.disqusShortname') {
					params.disqusShortname = value;
				} else if (key === 'params.password') {
					params.password = value;
				} else if (key === 'params.autoPublish') {
					params.autoPublish = value;
				} else if (key === 'params.lastPublishUrl') {
					params.lastPublishUrl = value;
				}
				
				actualKey = 'params';
				actualValue = params;
			}
			
			// Notify Main.ts to save configuration
			if (plugin.handleSiteEvent) {
				if (actualKey === 'theme') {
					const patch = actualValue as ReturnType<typeof buildThemeConfigPatch>;
					await plugin.handleSiteEvent('configChanged', { key: 'module', value: patch.module });
					// patch.params is already merged (siteParams + preserved user keys)
					await plugin.handleSiteEvent('configChanged', { key: 'params', value: patch.params });
				} else {
					await plugin.handleSiteEvent('configChanged', {
						key: actualKey,
						value: actualValue
					});
				}
			}
			
		} catch (error) {
			console.error('[Site] Error saving config:', error);
		}
	}
	
	async function applyThemeFromCatalog(entry: CatalogEntry) {
		if (!entry.packUrl) {
			console.warn('[Site] Cannot apply locked theme:', entry.slug);
			return;
		}
		const existingConfig = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
		const existingParams = (existingConfig?.['params'] ?? {}) as Record<string, unknown>;
		await saveFoundryConfig(
			'theme.catalog',
			buildThemeConfigPatch(entry, undefined, existingParams),
		);
		if (plugin.projectServiceManager && projectName) {
			await plugin.projectServiceManager.syncUserStaticConfig(projectName, entry);
		}
		// Themed builds always use Foundry default MarkdownIt (Phase 1.5)
		await saveFoundryConfig('markdown.useInternalRenderer', true);
	}

	async function resolveThemeFromConfig(config: Record<string, unknown>): Promise<CatalogEntry | null> {
		const mdfriday = (config.params as { mdfriday?: { family?: string; variant?: string } })?.mdfriday;
		if (mdfriday?.family && mdfriday?.variant) {
			const byMeta = await themeApiService.findByFamilyVariant(
				mdfriday.family,
				mdfriday.variant,
				plugin,
			);
			if (byMeta) return byMeta;
		}
		const imports = (config.module as { imports?: Array<{ path?: string }> })?.imports;
		const themeUrl = imports?.[0]?.path;
		if (themeUrl) {
			const allThemes = await themeApiService.getAllThemes(plugin);
			return allThemes.find((t) => t.packUrl === themeUrl) ?? null;
		}
		return null;
	}

	/**
	 * Initialize component with project state
	 * Called by Main.ts after project creation or when loading existing project.
	 * @param epoch — selectionEpoch from openOrFollowSelection; stale calls are ignored.
	 */
	export async function initialize(state: ProjectState, epoch?: number) {
		const stillCurrent = () =>
			epoch === undefined || epoch === plugin.selectionEpoch;
		if (!stillCurrent()) return;

		// Drop previous target's publish/preview/theme residue before loading the new project.
		resetProjectUiState({ keepSelection: true });
		if (!stillCurrent()) return;

		// Bind selection to this project (prevents stale apply from keeping another file selected).
		if (state.folder || state.file) {
			site.replaceSelection(state.folder ?? null, state.file ?? null);
		}

		const statePath = state.file?.path || state.folder?.path || null;
		const currentPath = selectionVaultPath(site.getCurrentContents());
		if (statePath && currentPath && statePath !== currentPath) {
			// Selection drifted — do not paint this project's publish status onto another file.
			return;
		}

		projectName = state.name;
		absPreviewDir = state.path;

		// Load configuration to UI
		if (state.config) {
			// 1. Load basic information
			if (state.config.title) {
				siteName = state.config.title;
			}
			if (state.config.baseURL) {
				sitePath = state.config.baseURL;
			}

			// 2. Load theme configuration
			const matchedTheme = await resolveThemeFromConfig(state.config);
			if (!stillCurrent()) return;
			if (matchedTheme) {
				selectedThemeSlug = matchedTheme.slug;
				selectedThemeName = matchedTheme.name;
				selectedThemeDownloadUrl = matchedTheme.packUrl || state.config.module?.imports?.[0]?.path || '';
				userHasSelectedTheme = true;
				currentThemeWithSample = matchedTheme;
				if (state.config.markdown?.useInternalRenderer === undefined) {
					await saveFoundryConfig('markdown.useInternalRenderer', true);
				}
				// Existing projects created before siteParams: backfill on open.
				if (
					configMissingSiteParams(
						state.config.params as Record<string, unknown> | undefined,
						matchedTheme.siteParams,
					)
				) {
					await applyThemeFromCatalog(matchedTheme);
				}
				// Do not force themed mode here — note default is faithful;
				// pathConfigs hydrate decides mode after selection is ready.
			} else if (state.config.module?.imports?.[0]?.path) {
				selectedThemeDownloadUrl = state.config.module.imports[0].path;
				userHasSelectedTheme = true;
			}

			// 3. Load publish configuration
			if (state.config.publish) {
				if (state.config.publish.method) {
					selectedPublishOption = normalizePublishMethod(state.config.publish.method);
				}
			}

		// 4. Load advanced settings
		if (state.config.services?.googleAnalytics?.id) {
			googleAnalyticsId = state.config.services.googleAnalytics.id;
		}
		if (state.config.params?.disqusShortname) {
			disqusShortname = state.config.params.disqusShortname;
		}
		if (state.config.params?.password) {
			sitePassword = state.config.params.password;
		}
		
		// Load auto-publish setting
		if (state.config.params?.autoPublish !== undefined) {
			autoPublishEnabled = state.config.params.autoPublish;
		}

			// 5. Load language configuration
			if (state.config.languages && state.config.defaultContentLanguage) {
				await applyLanguageConfiguration(
					state.config.languages,
					state.config.defaultContentLanguage,
					true
				);
			}
		}

		if (!stillCurrent()) return;

		// Publish status is path-scoped (remote sourcePath) — never trust another
		// project's leftover params.lastPublishUrl.
		await refreshPublishStatusForVaultPath(statePath || currentPath, epoch);

		if (!stillCurrent()) return;

		// Path-scoped mode wins over Foundry theme leftovers (note → faithful by default).
		if (activeVaultPath) {
			lastHydratedPath = null;
			await hydrateFromPathConfig(activeVaultPath);
		}

		if (!stillCurrent()) return;

		historyRefreshKey += 1;
		targetListRevision += 1;

		if (plugin.handleSiteEvent) {
			await plugin.handleSiteEvent('initialized', {
				projectName: state.name
			});
		}
	}

	/**
	 * Clear publish/preview/config UI that belongs to the previous target.
	 * Call before loading another project or soft-following an unpublished file.
	 */
	function resetProjectUiState(opts?: { keepSelection?: boolean }) {
		try {
			stopAllLocalPreviewServers();
		} catch {
			/* ignore */
		}

		isBuilding = false;
		isPreviewBuilding = false;
		buildProgress = 0;
		previewUrl = '';
		previewId = '';
		hasPreview = false;
		previewWasStopped = false;
		lastCompletedAction = null;
		absPreviewDir = '';

		isPublishing = false;
		publishProgress = 0;
		publishSuccess = false;
		publishUrl = '';
		publishError = '';
		publishErrorAction = null;
		publishRevoked = false;

		authPrepareStep = 'idle';
		showAuthTip = false;

		sitePassword = '';
		autoPublishEnabled = false;
		googleAnalyticsId = '';
		disqusShortname = '';
		sitePath = '';
		if (!opts?.keepSelection) {
			siteName = '';
			projectName = '';
		}

		userHasSelectedTheme = false;
		userChoseMode = false;
		currentThemeWithSample = null;
		selectedThemeSlug = '';
		selectedThemeName = '';
		selectedThemeDownloadUrl = '';

		lastHydratedPath = null;
		lastSavedLanguageConfig = '';
		isSavingLanguageConfig = false;

		historyRefreshKey += 1;
		targetListRevision += 1;
	}

	/**
	 * Update build progress (for preview/serve)
	 * Updated to support new Foundry progress phases and overallPercentage
	 */
	export function updateBuildProgress(progress: ProgressUpdate) {
		switch (progress.phase) {
			case "building":
				isBuilding = true;
				buildProgress = progress.percentage || 0;
				break;
			case "build-success":
				isBuilding = false;
				buildProgress = progress.percentage || 0;
				break;
			case "error":
				isBuilding = false;
				isPreviewBuilding = false;
				buildProgress = 0;
				break;
		}

		// Publish progress from preview+publish (realtime) or build+publish pipeline
		if (progress.phase === 'publishing' || progress.phase === 'publish-success') {
			// Publish pipeline owns its own progress; don't leave preview stuck "building"
			isBuilding = false;
			isPreviewBuilding = false;
			if (progress.phase === 'publishing') {
				isPublishing = true;
				publishSuccess = false;
				publishProgress = progress.percentage ?? publishProgress;
			} else if (progress.phase === 'publish-success') {
				isPublishing = false;
				publishSuccess = true;
				publishProgress = 100;
				publishRevoked = false;
				outputTab = 'online';
				historyRefreshKey += 1;
				lastCompletedAction = 'publish';
				if (progress.data?.publishUrl) {
					publishUrl = buildPublishUrl(progress.data.publishUrl);
					persistLastPublishUrl(publishUrl);
				}
			}
		}

		// Legacy: auto-publish sync via overallPercentage
		if (progress.overallPercentage !== undefined && autoPublishEnabled) {
			publishProgress = progress.overallPercentage;

			if (progress.phase === 'publishing') {
				isPublishing = true;
				publishSuccess = false;
				isBuilding = false;
				isPreviewBuilding = false;
			} else if (progress.phase === 'publish-success') {
				isPublishing = false;
				publishSuccess = true;
				isBuilding = false;
				isPreviewBuilding = false;
				outputTab = 'online';
				historyRefreshKey += 1;
				
				if (progress.data?.publishUrl) {
					publishUrl = buildPublishUrl(progress.data.publishUrl);
				}
			} else if (progress.phase === 'error') {
				isPublishing = false;
				publishProgress = 0;
				publishSuccess = false;
				isBuilding = false;
				isPreviewBuilding = false;
			}
		}
	}

	/**
	 * Update publish progress
	 */
	export function updatePublishProgress(progress: PublishProgressUpdate) {
		isPublishing = true;
		publishSuccess = false;

		// Map Foundry service phases to progress percentage
		// Phases: 'scanning' | 'uploading' | 'deploying' | 'complete'
		switch (progress.phase) {
			case 'scanning':
				// Build phase may forward absolute 0–40 via scanning
				publishProgress = Math.min(40, progress.percentage ?? publishProgress);
				break;
			case 'uploading':
				// 40-85%: Uploading files
				publishProgress = 40 + Math.min(45, (progress.percentage ?? 0) * 0.45);
				break;
			case 'deploying':
				// 85-95%: Deploying on server
				publishProgress = 85 + Math.min(10, (progress.percentage ?? 0) * 0.1);
				break;
			case 'complete':
				publishProgress = 100;
				break;
			default:
				publishProgress = progress.percentage ?? publishProgress;
		}
	}

	/**
	 * Build complete callback
	 */
	export function onBuildComplete(result: any) {
		buildProgress = 100;
		isBuilding = false;
	}

	/**
	 * Build error callback
	 */
	export function onBuildError(error: string) {
		buildProgress = 0;
		isBuilding = false;
		console.error('[Site] Build error:', error);
	}

	/**
	 * Preview started callback
	 */
	export function onPreviewStarted(result: any) {
		serverRunning = true;
		hasPreview = true;
		buildProgress = 100;
		isBuilding = false;
		isPreviewBuilding = false;
		if (result.port) serverPort = result.port;
		previewUrl = normalizeLocalPreviewUrl(result.url || '', result.port || serverPort);
		outputTab = 'preview';
		previewWasStopped = false;
		lastCompletedAction = 'preview';
		new Notice(t('ui.preview_success') || 'Local preview ready', 2500);
		if (previewUrl) {
			window.open(previewUrl, '_blank');
		}
		void persistPathConfigNow();
	}

	/**
	 * Local preview must be http://localhost:PORT[/path]. Absolute share baseURL must not be appended.
	 */
	function normalizeLocalPreviewUrl(raw: string, port: number): string {
		const fallback = `http://127.0.0.1:${port}/`;
		if (!raw) return fallback;
		// Broken: http://localhost:8090https://share…
		const glued = raw.match(/^(https?:\/\/[^/]+:\d+)(https?:\/\/.*)$/i);
		if (glued) return `${glued[1]}/`;
		if (/^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) {
			return fallback;
		}
		return raw;
	}

	/**
	 * Preview error callback
	 */
	export function onPreviewError(error: string) {
		serverRunning = false;
		hasPreview = false;
		buildProgress = 0;
		isBuilding = false;
		isPreviewBuilding = false;
		absPreviewDir = ''; // Clear preview directory path on error
		console.error('[Site] Preview error:', error);
	}

	/**
	 * Preview stopped callback
	 */
	export function onPreviewStopped() {
		serverRunning = false;
		hasPreview = false;
		previewWasStopped = true;
		absPreviewDir = ''; // Clear preview directory path when stopped
	}

	function buildPublishUrl(resultUrl: string): string {
		if (!resultUrl) return '';
		if (/^https?:\/\//i.test(resultUrl)) return resultUrl;
		const base = resolvePublicBaseUrl(plugin.settings);
		const path = resultUrl.startsWith('/') ? resultUrl : `/${resultUrl}`;
		return `${base}${path}`;
	}

	async function persistLastPublishUrl(url: string) {
		if (!url || !plugin.currentProjectName) return;
		await saveFoundryConfig('params.lastPublishUrl', url);
	}

	/**
	 * Publish complete callback
	 */
	export function onPublishComplete(result: any) {
		publishProgress = 100;
		isPublishing = false;
		isBuilding = false;
		isPreviewBuilding = false;
		publishSuccess = true;
		publishRevoked = false;
		authPrepareStep = 'idle';
		lastCompletedAction = 'publish';

		publishUrl = buildPublishUrl(result.url || '');
		if (publishUrl) {
			outputTab = 'online';
			historyRefreshKey += 1;
		}
		if (result.baseURL) {
			sitePath = result.baseURL;
		}
		if (publishUrl) {
			persistLastPublishUrl(publishUrl);
			plugin.settings.hasPublishedOnce = true;
			void plugin.saveSettings();
			new Notice(t('messages.site_published_successfully'), 5000);
		}
		targetListRevision += 1;
		if (!skipPathHydrate) {
			schedulePersistPathConfig();
		}
		void refreshQuotaSnapshot();
	}

	async function refreshQuotaSnapshot() {
		const mgr = plugin.projectServiceManager;
		if (!mgr) return;
		await mgr.refreshCloudflareAccount();
		quotaRevision += 1;
		accountEpoch += 1;
	}

	/** Deep link / claim success — leave softgate and show updated plan. */
	export function onAccountUpdated(_info?: {
		success?: boolean;
		plan?: string;
		kind?: string;
		source?: string;
	}) {
		stopClaimPoll();
		publishError = '';
		publishErrorAction = null;
		quotaRevision += 1;
		accountEpoch += 1;
	}

	function stopClaimPoll() {
		if (claimPollTimer) {
			clearInterval(claimPollTimer);
			claimPollTimer = null;
		}
		claimPollUntil = 0;
	}

	/** After opening Account in browser, poll until plan leaves guest (or timeout). */
	export function startClaimPoll() {
		stopClaimPoll();
		claimPollUntil = Date.now() + 3 * 60_000;
		claimPollTimer = setInterval(() => {
			void (async () => {
				if (Date.now() > claimPollUntil) {
					stopClaimPoll();
					return;
				}
				const mgr = plugin.projectServiceManager;
				if (!mgr) return;
				const r = await mgr.refreshCloudflareAccount();
				if (!r.success) return;
				const plan = (plugin.settings.mdfKeyPlan || '').toLowerCase();
				const kind = (plugin.settings.mdfKeyKind || '').toLowerCase();
				if (kind === 'user' || (plan && plan !== 'guest')) {
					stopClaimPoll();
					publishError = '';
					publishErrorAction = null;
					quotaRevision += 1;
					accountEpoch += 1;
					new Notice(
						plugin.i18n?.t?.('ui.claim_refresh_ok')?.replace('{{plan}}', plan || r.plan || 'free') ||
							`Signed in — plan: ${plan || r.plan}`,
						4000,
					);
				} else {
					quotaRevision += 1;
				}
			})();
		}, 2500);
	}

	function onFocusMaybeRefreshClaim() {
		if (!claimPollTimer) return;
		void plugin.projectServiceManager?.refreshCloudflareAccount().then((r) => {
			if (!r?.success) return;
			const plan = (plugin.settings.mdfKeyPlan || '').toLowerCase();
			const kind = (plugin.settings.mdfKeyKind || '').toLowerCase();
			if (kind === 'user' || (plan && plan !== 'guest')) {
				onAccountUpdated({ success: true, plan, kind, source: 'focus' });
			} else {
				quotaRevision += 1;
			}
		});
	}

	/**
	 * Publish error callback
	 */
	export function onPublishError(error: string, code?: string) {
		publishProgress = 0;
		isPublishing = false;
		isBuilding = false;
		isPreviewBuilding = false;
		publishSuccess = false;

		const planLower = (plugin.settings.mdfKeyPlan || plugin.settings.mdfKeyKind || 'guest')
			.toLowerCase();
		const raw = error || t('ui.publish_failed');
		const isQuota =
			code === 'quota_exceeded' ||
			/project limit|quota exceeded|storage quota|limit reached|allows only|allows \d+ sites|status 402|HTTP 402/i.test(
				raw,
			);
		const isStorage = /storage/i.test(raw);

		if (isQuota) {
			if (planLower === 'guest' || planLower === '' || !plugin.settings.mdfKeyPlan) {
				publishError = isStorage
					? t('ui.err_quota_storage_guest')
					: t('ui.err_quota_projects_guest');
				publishErrorAction = 'claim_free';
			} else if (planLower === 'free') {
				publishError = isStorage
					? t('ui.err_quota_storage_free')
					: t('ui.err_quota_projects_free');
				publishErrorAction = 'upgrade_personal';
			} else {
				publishError = isStorage ? t('ui.err_quota_storage_personal') : raw;
				publishErrorAction = null;
			}
		} else {
			publishError = raw;
			publishErrorAction = null;
		}

		console.error('[Site] Publish error:', error, code);
		new Notice(publishError, 7000);
		void refreshQuotaSnapshot();
	}

	/**
	 * Connection test success callback
	 */
	export function onConnectionTestSuccess(message?: string) {
		new Notice('Connection test successful');
	}

	/**
	 * Connection test error callback
	 */
	export function onConnectionTestError(error: string) {
		console.error('[Site] Connection test error:', error);
		new Notice(`Connection test failed: ${error}`);
	}

	// ==================== End Public Interface Methods ====================

	// HTTP server related
	let serverRunning = false;
	/** Bound preview port after listen(0); 0 means ask OS for an ephemeral port. */
	let serverPort = 0;

	onMount(async () => {
		themesDir = path.join(plugin.pluginDir, 'themes')
		await createThemesDirectory()

		basePath = plugin.vaultBasePath;
		
		// ==================== NEW ARCHITECTURE: Register component ====================
		// Register this component to Main.ts for direct method calls
		if (plugin.registerSiteComponent) {
			plugin.registerSiteComponent({
				// Core lifecycle methods
				initialize,
				
				// Progress and callback methods
				updateBuildProgress,
				updatePublishProgress,
				onBuildComplete,
				onBuildError,
				onPreviewStarted,
				onPreviewError,
				onPreviewStopped,
				onPublishComplete,
			onPublishError,
			onAccountUpdated,
			onConnectionTestSuccess,
			onConnectionTestError,
			
			// Quick share and utility methods (migrated from old architecture)
			setSitePath: setSitePathExternal,
			startPreviewAndWait,
			startPublish,
			applyDefaultsAndPublish,
			clearAllContent,
			followSelection,
			notifyTargetsChanged,
			openAccountFromGrowth,
			enableAutoPublish
		});
		}

		await loadThemeList();

		// Sync plan badge from API (cached settings may be stale / wrong after claim).
		if (plugin.settings.mdfKey) {
			void refreshQuotaSnapshot();
		}

		window.addEventListener('focus', onFocusMaybeRefreshClaim);

		// Keep sidebar selection in sync with the active markdown note (soft follow).
		const syncActiveNote = (file: TFile | null) => {
			if (!file || file.extension !== 'md') return;
			if (skipPathHydrate || isPublishing || isPreviewBuilding || plugin.isProjectInitializing) {
				return;
			}
			if (!plugin.isViewOpen?.()) return;
			const currentPath = selectionVaultPath(currentContents);
			if (currentPath === file.path) return;
			void plugin.openOrFollowSelection(null, file, { createIfMissing: false });
		};

		plugin.registerEvent(
			app.workspace.on('file-open', (file) => {
				syncActiveNote(file instanceof TFile ? file : null);
			}),
		);

		const activeFile = app.workspace.getActiveFile();
		if (activeFile instanceof TFile && activeFile.extension === 'md') {
			const currentPath = selectionVaultPath(currentContents);
			if (!currentPath) {
				syncActiveNote(activeFile);
			}
		}

		// Notify Main.ts that component is ready
		if (plugin.handleSiteEvent && plugin.currentProjectName) {
			await plugin.handleSiteEvent('initialized', {
				projectName: plugin.currentProjectName
			});
		}
	});
	
	// External method to set site path
	function setSitePathExternal(newPath: string) {
		sitePath = newPath;
	}
	
	// Start preview and return a promise that resolves when done
	async function startPreviewAndWait(): Promise<boolean> {
		try {
			await startPreview();
			return hasPreview;
		} catch (error) {
			console.error('Preview failed:', error);
			return false;
		}
	}

	async function openAccountFromGrowth(opts?: { intent?: 'claim' | 'upgrade' }) {
		await plugin.openAccountInBrowser({
			intent: opts?.intent === 'upgrade' ? 'upgrade' : 'claim',
		});
	}

	function needsGuestKeySetup(): boolean {
		const mgr = plugin.projectServiceManager;
		return !!mgr?.needsTurnstileForGuest() && !plugin.settings.mdfKey;
	}

	async function continueGuestKeySetup() {
		const mgr = plugin.projectServiceManager;
		if (!mgr) return;
		showAuthTip = false;
		authPrepareStep = 'waiting';
		const key = await mgr.requestGuestKey();
		authPrepareStep = 'idle';
		if (key) {
			await runPublish();
		}
	}

	function cancelGuestKeySetup() {
		authPrepareStep = 'idle';
	}

	function onDomainActive(hostname: string) {
		publishUrl = `https://${hostname.replace(/\/$/, '')}/`;
		publishSuccess = true;
		outputTab = 'online';
		sitePath = '/';
		void persistLastPublishUrl(publishUrl);
		void saveFoundryConfig('baseURL', '/');
	}

	function onDomainCleared() {
		void (async () => {
			try {
				const foundry = plugin.foundryPublishService;
				const name = plugin.currentProjectName || projectName;
				if (!foundry || !name) return;
				const bind = await foundry.getCloudflareBinding({
					workspacePath: plugin.absWorkspacePath,
					projectName: name,
				});
				const siteId = bind.success ? bind.siteId : undefined;
				const root = (
					(bind.success && bind.publicBaseUrl) ||
					plugin.settings.cloudflarePublicBaseUrl ||
					''
				).replace(/\/$/, '');
				if (siteId && root) {
					publishUrl = `${root}/s/${siteId}/`;
					sitePath = `/s/${siteId}/`;
					void persistLastPublishUrl(publishUrl);
					void saveFoundryConfig('baseURL', sitePath);
					return;
				}
			} catch (e) {
				console.warn('[Site] onDomainCleared binding read failed', e);
			}
			publishUrl = '';
			void persistLastPublishUrl('');
		})();
	}

	async function loadThemeList() {
		themesLoading = true;
		try {
			themeList = await themeApiService.getAllThemes(plugin);
		} catch (error) {
			console.warn('[Site] Failed to load themes:', error);
			themeList = [];
		} finally {
			themesLoading = false;
		}
	}

	async function applyThemeBySlug(slug: string) {
		const theme = themeList.find((item) => item.slug === slug);
		if (!theme || !theme.packUrl) return;

		selectedThemeDownloadUrl = theme.packUrl;
		selectedThemeName = theme.name;
		selectedThemeSlug = theme.slug;
		userHasSelectedTheme = true;
		userChoseMode = true;
		publishMode = 'themed';
		currentThemeWithSample = theme;
		await applyThemeFromCatalog(theme);
		schedulePersistPathConfig();
	}

	async function hydrateFromPathConfig(vaultPath: string) {
		if (skipPathHydrate) {
			lastHydratedPath = vaultPath;
			return;
		}
		const kind = selectionKindFromContents(currentContents);
		const cfg = resolvePathPublishConfig(plugin, vaultPath, kind);
		lastHydratedPath = vaultPath;

		publishMode = coercePublishMode(kind, cfg.mode);
		if (cfg.mode === 'themed' || kind === 'folder') {
			userChoseMode = true;
			userHasSelectedTheme = !!cfg.themeSlug;
			if (themeList.length === 0) {
				await loadThemeList();
			}
			const filtered = filterThemesForSelection(themeList, kind);
			const slug =
				(cfg.themeSlug && filtered.some((t) => t.slug === cfg.themeSlug)
					? cfg.themeSlug
					: null) ||
				filtered[0]?.slug ||
				(kind === 'folder' ? DEFAULT_THEME_SLUGS.QUARTZ : DEFAULT_THEME_SLUGS.NOTE);
			selectedThemeSlug = slug;
			const theme = themeList.find((item) => item.slug === slug);
			selectedThemeName = theme?.name || slug;
			if (theme?.packUrl) {
				selectedThemeDownloadUrl = theme.packUrl;
				currentThemeWithSample = theme;
			}
		} else {
			userChoseMode = !!plugin.settings.pathConfigs?.[vaultPath];
			userHasSelectedTheme = false;
			selectedThemeSlug = '';
			selectedThemeName = 'Obsidian (faithful)';
		}
		// Password plaintext is not restored from path config
		if (!cfg.hasPasswordFlag) {
			sitePassword = '';
		}
	}

	function schedulePersistPathConfig() {
		if (skipPathHydrate || !activeVaultPath || plugin.isProjectInitializing) {
			return;
		}
		if (pathConfigSaveTimeout) {
			clearTimeout(pathConfigSaveTimeout);
		}
		pathConfigSaveTimeout = setTimeout(() => {
			void persistPathConfigNow();
		}, 300);
	}

	async function persistPathConfigNow() {
		const vaultPath = activeVaultPath;
		if (!vaultPath) return;
		const kind = selectionKindFromContents(currentContents);
		const mode = coercePublishMode(kind, publishMode);
		await savePathPublishConfig(plugin, vaultPath, {
			mode,
			themeSlug: mode === 'themed' ? selectedThemeSlug || undefined : undefined,
			hasPasswordFlag: !!sitePassword.trim(),
		});
	}

	function handlePasswordChange(value: string) {
		sitePassword = value;
		schedulePersistPathConfig();
	}

	function setPublishMode(mode: PublishMode) {
		if (selectionKind === 'folder') {
			publishMode = 'themed';
			schedulePersistPathConfig();
			return;
		}
		userChoseMode = true;
		publishMode = mode;
		if (mode === 'faithful') {
			selectedThemeSlug = '';
			selectedThemeName = 'Obsidian (faithful)';
			userHasSelectedTheme = false;
		} else if (!selectedThemeSlug) {
			const filtered = filterThemesForSelection(themeList, 'note');
			const slug = filtered[0]?.slug || DEFAULT_THEME_SLUGS.NOTE;
			selectedThemeSlug = slug;
			selectedThemeName = filtered[0]?.name || slug;
			void applyThemeBySlug(selectedThemeSlug);
			return;
		} else {
			const filtered = filterThemesForSelection(themeList, 'note');
			if (!filtered.some((t) => t.slug === selectedThemeSlug)) {
				const slug = filtered[0]?.slug || DEFAULT_THEME_SLUGS.NOTE;
				void applyThemeBySlug(slug);
				return;
			}
		}
		schedulePersistPathConfig();
	}

	function openThemesCatalog() {
		window.open(`${resolveSiteBaseUrl(plugin.settings)}/themes`, '_blank');
	}

	$: displaySiteTitle = siteName || plugin.currentProjectName || 'MDFriday';
	$: planLower = (plugin.settings.mdfKeyPlan || '').toLowerCase();
	$: kindLower = (plugin.settings.mdfKeyKind || '').toLowerCase();
	/** Guest Key or no Key yet — nudge to Free via login */
	$: isGuestAccount =
		!plugin.settings.mdfKey ||
		kindLower === 'guest' ||
		planLower === 'guest';
	/** Signed-in Free — nudge to Personal */
	$: isFreeAccount = !isGuestAccount && planLower === 'free';
	$: isPaidAccount =
		planLower === 'personal' || planLower === 'pro';
	$: showUpgradeCard =
		!!publishUrl && !isPaidAccount && (isGuestAccount || isFreeAccount);
	
	// Enable auto-publish mode (called from main.ts for quick publish)
	export function enableAutoPublish() {
		autoPublishEnabled = true;
	}

	onDestroy(() => {
		// Clean up language config save timeout
		if (languageConfigSaveTimeout) {
			clearTimeout(languageConfigSaveTimeout);
			languageConfigSaveTimeout = null;
		}
		if (pathConfigSaveTimeout) {
			clearTimeout(pathConfigSaveTimeout);
			pathConfigSaveTimeout = null;
		}
		stopClaimPoll();
		window.removeEventListener('focus', onFocusMaybeRefreshClaim);

		// Clean up server
		if (serverRunning) {
			stopPreview();
			serverRunning = false;
		}
	});

	// 支持的语言列表
	const SUPPORTED_LANGUAGES = [
		{
			code: 'en',
			name: 'English',
			direction: 'ltr',
			englishName: 'English'
		},
		{
			code: 'zh',
			name: '中文',
			direction: 'ltr',
			englishName: 'Chinese'
		},
		{
			code: 'es',
			name: 'Español',
			direction: 'ltr',
			englishName: 'Spanish'
		},
		{
			code: 'fr',
			name: 'Français',
			direction: 'ltr',
			englishName: 'French'
		},
		{
			code: 'de',
			name: 'Deutsch',
			direction: 'ltr',
			englishName: 'German'
		},
		{
			code: 'ja',
			name: '日本語',
			direction: 'ltr',
			englishName: 'Japanese'
		},
		{
			code: 'ko',
			name: '한국어',
			direction: 'ltr',
			englishName: 'Korean'
		},
		{
			code: 'pt',
			name: 'Português',
			direction: 'ltr',
			englishName: 'Portuguese'
		}
	];

	// Reactive update: update related state when content changes
	$: contentPath = currentContents.length > 0 
		? (currentContents[0].folder?.name || currentContents[0].file?.name || '') 
		: '';
	
	// 只在首次添加内容时设置站点名称和加载默认发布配置（从0变为有内容）
	$: {
		if (previousContentLength === 0 && currentContents.length > 0 && !siteName) {
			const firstContent = currentContents[0];
			let defaultName = firstContent.folder?.name || firstContent.file?.basename || '';
			
			// If this is a content subfolder, use parent folder name as site name
			if (firstContent.folder) {
				const folderName = firstContent.folder.name.toLowerCase();
				if ((folderName === 'content' || folderName.startsWith('content.')) && firstContent.folder.parent) {
					defaultName = firstContent.folder.parent.name;
				}
			}
			
			siteName = defaultName;
		}
		previousContentLength = currentContents.length;
	}
	
	// 预览状态重置逻辑
	$: if (currentContents.length === 0) {
		hasPreview = false;
		previewUrl = '';
		previewId = '';
		siteName = ''; // 清空内容时也清空站点名称
		userHasSelectedTheme = false; // 重置主题选择标志，允许重新自动选择
		previousContentLength = 0; // 重置内容长度跟踪，允许下次首次添加时设置站点名称

		autoPublishEnabled = false;
		isPublishing = false;
		publishSuccess = false;
		publishProgress = 0;
		publishUrl = '';
		
		// Reset language config save state
		lastSavedLanguageConfig = '';
		isSavingLanguageConfig = false;
	}

	// 监听语言内容变化，自动保存语言配置
	// 当添加、删除或修改语言内容时触发
	$: {
		if (currentContents.length > 0 
			&& !plugin.isProjectInitializing 
			&& plugin.currentProjectName
			&& !isSavingLanguageConfig) {  // Prevent infinite loop
			
			// Build current configuration string for comparison
			const currentConfig = JSON.stringify({
				languages: currentContents.map(c => ({
					code: c.languageCode,
					contentDir: currentContents.indexOf(c) === 0 ? "content" : `content.${c.languageCode}`,
					weight: c.weight || (currentContents.indexOf(c) + 1)
				})),
				defaultLang: currentContents[0]?.languageCode || 'en'
			});
			
			// Only save if configuration actually changed
			if (currentConfig !== lastSavedLanguageConfig) {
				// Clear previous timeout to debounce rapid changes
				if (languageConfigSaveTimeout) {
					clearTimeout(languageConfigSaveTimeout);
				}
				
				// Set new timeout to save configuration after a small delay
				languageConfigSaveTimeout = setTimeout(() => {
					saveLanguageConfiguration().catch(err => {
						console.error('[Site] Failed to auto-save language configuration:', err);
					});
					languageConfigSaveTimeout = null;
				}, 300);
			}
		}
	}


	// 多语言相关函数
	async function updateLanguageCode(contentId: string, newLanguageCode: string) {
		site.updateLanguageCode(contentId, newLanguageCode);
		
		// Wait for Svelte to update reactive variables
		await tick();
		
		// Save updated language configuration to Foundry
		await saveLanguageConfiguration();
	}
	
	/**
	 * Save language configuration to Foundry project config
	 */
	async function saveLanguageConfiguration() {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			return;
		}
		
		// Prevent re-entry during save
		if (isSavingLanguageConfig) {
			return;
		}
		
		// Set saving flag
		isSavingLanguageConfig = true;
		
		try {
			// Build languages configuration from current contents
			const languages: Record<string, any> = {};
			
			currentContents.forEach((content, index) => {
				const contentDir = index === 0 ? "content" : `content.${content.languageCode}`;
				languages[content.languageCode] = {
					contentDir: contentDir,
					weight: content.weight || (index + 1)
				};
			});
			
			// Get the default language (first content's language)
			const defaultLang = currentContents.length > 0 
				? currentContents[0].languageCode 
				: 'en';
			
			// Build configuration string for tracking
			const configString = JSON.stringify({
				languages: currentContents.map(c => ({
					code: c.languageCode,
					contentDir: currentContents.indexOf(c) === 0 ? "content" : `content.${c.languageCode}`,
					weight: c.weight || (currentContents.indexOf(c) + 1)
				})),
				defaultLang: defaultLang
			});
			
			// Save both languages and defaultContentLanguage using event system
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('configChanged', {
					key: 'languages',
					value: languages
				});
				
				await plugin.handleSiteEvent('configChanged', {
					key: 'defaultContentLanguage',
					value: defaultLang
				});
			}
			
			// Update last saved config
			lastSavedLanguageConfig = configString;
		} catch (error) {
			console.error('[Site] Error saving language configuration:', error);
		} finally {
			// Always clear the saving flag
			isSavingLanguageConfig = false;
		}
	}

	function removeLanguageContent(contentId: string) {
		site.removeLanguageContent(contentId);
	}
	
	function clearAllContent(silent = false) {
		site.clearAllContent(silent);
	}

	/**
	 * Resolve「已发布」strictly by vault path against remote projects.source_path.
	 * Local Foundry params.lastPublishUrl is only a cache and can be polluted across
	 * projects — never use it as the sole source of truth when switching targets.
	 */
	async function refreshPublishStatusForVaultPath(
		vaultPath: string | null | undefined,
		epoch?: number,
	) {
		const stillCurrent = () =>
			epoch === undefined || epoch === plugin.selectionEpoch;

		publishUrl = '';
		publishSuccess = false;
		publishRevoked = false;
		lastCompletedAction = null;

		const path = normalizeVaultPath(vaultPath);
		if (!path) return;

		const mgr = plugin.projectServiceManager;
		if (!mgr || !plugin.settings.mdfKey) {
			return;
		}

		try {
			const res = await mgr.listRemoteCloudflareProjects();
			if (!stillCurrent()) return;
			if (!res.success || !res.projects?.length) {
				// No remote match → scrub stale local cache for the open project
				if (plugin.currentProjectName) {
					void saveFoundryConfig('params.lastPublishUrl', '');
				}
				return;
			}

			const match = res.projects.find(
				(p) =>
					pathsEqual(p.sourcePath, path) &&
					p.status !== 'deleted' &&
					p.status !== 'draft',
			);

			if (!match) {
				if (plugin.currentProjectName) {
					void saveFoundryConfig('params.lastPublishUrl', '');
				}
				return;
			}

			if (match.status === 'unpublished') {
				publishRevoked = true;
				publishSuccess = false;
				publishUrl = '';
				if (plugin.currentProjectName) {
					void saveFoundryConfig('params.lastPublishUrl', '');
				}
				return;
			}

			// status === 'published' (or equivalent live)
			let url = '';
			if (typeof match.publicUrl === 'string' && match.publicUrl) {
				url = buildPublishUrl(match.publicUrl);
			} else if (match.domainHostname && match.domainStatus === 'active') {
				url = `https://${match.domainHostname.replace(/\/$/, '')}/`;
			} else if (match.siteId) {
				const publicBase = resolvePublicBaseUrl(plugin.settings);
				url = `${publicBase}/s/${match.siteId}/index.html`;
			}

			if (!stillCurrent()) return;

			if (url && match.status === 'published') {
				publishUrl = url;
				publishSuccess = true;
				publishRevoked = false;
				outputTab = 'online';
				if (plugin.currentProjectName) {
					void persistLastPublishUrl(url);
				}
			} else {
				publishUrl = '';
				publishSuccess = false;
			}
		} catch (err) {
			console.warn('[Site] refreshPublishStatusForVaultPath failed', err);
			if (!stillCurrent()) return;
			publishUrl = '';
			publishSuccess = false;
		}
	}

	/** Soft-follow: swap selection UI without creating a Foundry project. */
	function followSelection(folder: TFolder | null, file: TFile | null) {
		resetProjectUiState();
		plugin.currentProjectName = null;
		site.replaceSelection(folder, file);
		publishUrl = '';
		publishSuccess = false;
		publishRevoked = false;
		lastCompletedAction = null;
		projectName = '';
		const path = folder?.path || file?.path || null;
		void refreshPublishStatusForVaultPath(path, plugin.selectionEpoch);
	}

	function notifyTargetsChanged() {
		targetListRevision += 1;
		historyRefreshKey += 1;
	}

	async function selectPublishedTarget(sourcePath: string) {
		const abstract = app.vault.getAbstractFileByPath(sourcePath);
		if (!abstract) {
			new Notice(t('messages.content_path_missing') || 'Path not found in vault', 3000);
			return;
		}
		if (abstract instanceof TFolder) {
			await plugin.openOrFollowSelection(abstract, null, { createIfMissing: true });
		} else if (abstract instanceof TFile && abstract.extension === 'md') {
			await plugin.openOrFollowSelection(null, abstract, { createIfMissing: true });
		}
	}
	
	// Reactive statement to ensure theme name updates
	$: displayThemeName = selectedThemeName || 'Quartz';


	function normalizeSitePath(path: string): string {
		// Ensure path starts with / and doesn't end with / (unless it's just "/")
		if (!path.startsWith('/')) {
			path = '/' + path;
		}
		if (path.length > 1 && path.endsWith('/')) {
			path = path.slice(0, -1);
		}
		return path;
	}

	function handleSitePathChange() {
		sitePath = normalizeSitePath(sitePath);

		saveFoundryConfig('baseURL', sitePath)
	}

	/**
	 * Reset publish UI state
	 */
	function resetPublishState() {
		isPublishing = true;
		publishProgress = 0;
		publishSuccess = false;
		publishError = '';
		publishErrorAction = null;
		lastCompletedAction = null;
		publishRevoked = false;
	}

	async function resolveProjectPublicDir(): Promise<string | null> {
		const name = plugin.currentProjectName;
		if (!name || !plugin.projectServiceManager) return null;
		const info = await plugin.projectServiceManager.getProjectInfo(name);
		if (!info?.path) return null;
		return path.join(info.path, 'public');
	}

	async function startPreview() {
		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		if (!plugin.currentProjectName) {
			const ok = await plugin.ensureProjectForSelection();
			if (!ok) {
				new Notice(t('messages.no_folder_or_file_selected'), 3000);
				return;
			}
		}

		const firstContent = currentContents[0];
		const kind = selectionKindFromContents(currentContents);
		const mode = coercePublishMode(kind, publishMode);
		const useFaithful = kind === 'note' && mode === 'faithful' && !!firstContent.file;

		if (hasPreview || serverRunning) {
			try {
				if (plugin.currentProjectName) {
					await stopPreview();
				}
				stopAllLocalPreviewServers();
				await new Promise(resolve => setTimeout(resolve, 300));
			} catch (error) {
				console.warn('[Site] Error stopping previous preview:', error);
			}
		}

		isBuilding = true;
		isPreviewBuilding = true;
		buildProgress = 0;
		hasPreview = false;
		lastCompletedAction = null;
		previewWasStopped = false;

		try {
			if (useFaithful) {
				if (!plugin.currentProjectName) {
					new Notice('No project selected. Please right-click a note first.', 3000);
					isBuilding = false;
					isPreviewBuilding = false;
					return;
				}
				const publicDir = await resolveProjectPublicDir();
				if (!publicDir) {
					throw new Error('Project path unavailable');
				}
				buildProgress = 30;
				await buildFaithfulToProject(plugin, {
					file: firstContent.file!,
					publicDir,
					password: sitePassword.trim() || undefined,
				});
				buildProgress = 80;
				const server = await serveFaithfulPublicDir(publicDir);
				previewUrl = server.url;
				previewId = publicDir;
				absPreviewDir = publicDir;
				hasPreview = true;
				isPreviewBuilding = false;
				isBuilding = false;
				buildProgress = 100;
				outputTab = 'preview';
				lastCompletedAction = 'preview';
				previewWasStopped = false;
				new Notice(t('ui.preview_success') || 'Local preview ready', 2500);
				window.open(previewUrl, '_blank');
				await persistPathConfigNow();
				return;
			}

			if (!plugin.currentProjectName) {
				new Notice('No project selected. Please right-click a folder first.', 3000);
				isBuilding = false;
				isPreviewBuilding = false;
				return;
			}

			// Persist access password before themed build (same as publish).
			await saveFoundryConfig('params.password', sitePassword.trim() || '');

			// Themed: Foundry default SSG serve (no custom Obsidian renderer)
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('previewRequested', {
					projectName: plugin.currentProjectName,
					port: serverPort,
					publishConfig: undefined,
				});
			}

			if (plugin.hugoverse) {
				plugin.hugoverse.sendCounter('preview').catch(error => {
					console.warn('Counter request failed (non-critical):', error);
				});
			}

		} catch (error) {
			console.error('Preview generation failed:', error);
			new Notice(t('messages.preview_failed', { error: error.message }), 5000);
			isBuilding = false;
			isPreviewBuilding = false;
			buildProgress = 0;
		}
	}

	async function autoPublish() {
		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		if (!plugin.currentProjectName) {
			new Notice('No project selected. Please right-click a folder first.', 3000);
			return;
		}

		if (hasPreview || serverRunning) {
			try {
				await stopPreview();
				stopAllLocalPreviewServers();
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.warn('[Site] Error stopping previous preview:', error);
			}
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			const kind = selectionKindFromContents(currentContents);
			const mode = coercePublishMode(kind, publishMode);

			if (mode === 'faithful' && currentContents[0]?.file) {
				// Faithful has no watch/auto-rebuild — run one-shot publish
				await runPublish();
				isBuilding = false;
				return;
			}

			const publishConfig = { method: 'cloudflare' as const, config: undefined };
			resetPublishState();

			await saveFoundryConfig('params.password', sitePassword.trim() || '');

			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('previewRequested', {
					projectName: plugin.currentProjectName,
					port: serverPort,
					publishConfig,
				});
			}

			if (plugin.hugoverse) {
				plugin.hugoverse.sendCounter('preview').catch(error => {
					console.warn('Counter request failed (non-critical):', error);
				});
			}
		} catch (error) {
			console.error('Auto-publish failed:', error);
			new Notice(t('messages.preview_failed', { error: error.message }), 5000);
			isBuilding = false;
			buildProgress = 0;
		}
	}
	
	/**
	 * Save publish configuration to Foundry project config using event system
	 */
	async function savePublishConfig() {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			return;
		}
		
		try {
			const publishConfig = { method: 'cloudflare' as const };
			
			// Use event system to save configuration
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('configChanged', {
					key: 'publish',
					value: publishConfig
				});
			}
			
		} catch (error) {
			console.error('[Site] Error saving publish config:', error);
		}
	}
	
	/**
	 * Stop preview server
	 */
	async function stopPreview() {
		// Independent Obsidian local preview is not managed via Foundry stop
		if (!plugin.currentProjectName) {
			stopAllLocalPreviewServers();
			hasPreview = false;
			serverRunning = false;
			previewWasStopped = true;
			return;
		}
		
		try {
			// Use event system to request stop preview
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('stopPreview', {
					projectName: plugin.currentProjectName
				});
			}
			stopAllLocalPreviewServers();
			hasPreview = false;
			serverRunning = false;
			previewWasStopped = true;
			
			new Notice('Preview server stopped', 2000);
		} catch (error) {
			console.error('Error stopping preview:', error);
			new Notice(`Error stopping preview: ${error.message}`, 3000);
		}
	}

	function dismissPanelResult() {
		lastCompletedAction = null;
	}

	function dismissAuthTip() {
		showAuthTip = false;
		authPrepareStep = 'idle';
	}

	$: pathRemembered = !!(activeVaultPath && plugin.settings.pathConfigs?.[activeVaultPath]);

	async function stopPublish() {
		// Reset publishing state
		isBuilding = false;
		isPublishing = false;
		buildProgress = 0;
		publishProgress = 0;
		
		// Also stop preview if it's running
		await stopPreview();
		
		new Notice(t('messages.publish_stopped') || 'Publishing stopped', 2000);
	}

	async function runPublish() {
		resetPublishState();

		try {
			const kind = selectionKindFromContents(currentContents);
			const mode = coercePublishMode(kind, publishMode);
			const skipBuild = mode === 'faithful';

			if (skipBuild) {
				const file = currentContents[0]?.file;
				if (!file) {
					throw new Error('Faithful publish requires a single markdown note');
				}
				const publicDir = await resolveProjectPublicDir();
				if (!publicDir) {
					throw new Error('Project path unavailable');
				}
				publishProgress = 15;
				await buildFaithfulToProject(plugin, {
					file,
					publicDir,
					password: sitePassword.trim() || undefined,
				});
				publishProgress = 40;
			}

			if (sitePassword) {
				await saveFoundryConfig('params.password', sitePassword);
			} else {
				await saveFoundryConfig('params.password', '');
			}

			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('buildAndPublishRequested', {
					projectName: plugin.currentProjectName,
					skipBuild,
				});
			}
		} catch (error) {
			console.error('Publish failed:', error);
			new Notice(t('messages.publish_failed', { error: error.message }), 5000);
			isPublishing = false;
			publishProgress = 0;
			publishSuccess = false;
		}
	}

	/**
	 * Right-click defaults → publish immediately (ignores saved path config).
	 * Note → faithful; folder → themed + first catalog theme.
	 */
	async function applyDefaultsAndPublish() {
		skipPathHydrate = true;
		await tick();
		const kind = selectionKindFromContents(currentContents);
		const defaults = getDefaultPublishConfig(kind);
		userChoseMode = false;
		userHasSelectedTheme = false;
		publishMode = defaults.mode;
		sitePassword = '';
		showAuthTip = false;
		lastHydratedPath = activeVaultPath;

		if (kind === 'folder') {
			publishMode = 'themed';
			if (themeList.length === 0) {
				await loadThemeList();
			}
			const filtered = filterThemesForSelection(themeList, 'folder');
			const firstTheme = filtered[0];
			if (firstTheme?.packUrl) {
				await applyThemeBySlug(firstTheme.slug);
			} else {
				const slug = defaults.themeSlug || DEFAULT_THEME_SLUGS.QUARTZ;
				selectedThemeSlug = slug;
				selectedThemeName = slug;
				userHasSelectedTheme = true;
				userChoseMode = true;
			}
		} else {
			selectedThemeSlug = '';
			selectedThemeName = 'Obsidian (faithful)';
			publishMode = 'faithful';
		}

		try {
			await startPublish({ allowGuestBootstrap: true });
		} finally {
			skipPathHydrate = false;
			await persistPathConfigNow();
		}
	}

	async function startPublish(opts?: { allowGuestBootstrap?: boolean }) {
		if (autoPublishEnabled) {
			await autoPublish();
			return;
		}

		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		if (!plugin.currentProjectName) {
			const ok = await plugin.ensureProjectForSelection();
			if (!ok) {
				new Notice(t('messages.no_folder_or_file_selected'), 3000);
				return;
			}
		}

		if (!plugin.settings.mdfKey) {
			if (!opts?.allowGuestBootstrap) {
				showAuthTip = true;
				return;
			}
			const mgr = plugin.projectServiceManager;
			if (mgr) {
				if (mgr.needsTurnstileForGuest()) {
					authPrepareStep = 'prepare';
					return;
				}
				authPrepareStep = 'waiting';
				const key = await mgr.requestGuestKey();
				authPrepareStep = 'idle';
				if (!key) return;
			}
		}

		showAuthTip = false;
		await runPublish();
	}

	// Handle auto-publish toggle change (only save when user manually toggles)
	function handleAutoPublishToggle(enabled?: boolean) {
		if (typeof enabled === 'boolean') {
			autoPublishEnabled = enabled;
		}
		if (plugin.currentProjectName && !plugin.isProjectInitializing) {
			saveFoundryConfig('params.autoPublish', autoPublishEnabled);
		}
	}

	async function createThemesDirectory() {
		if (!await app.vault.adapter.exists(themesDir)) {
			await app.vault.adapter.mkdir(themesDir);
		}
	}

	// Open publish URL in browser
	function openPublishUrl() {
		if (publishUrl) {
			window.open(publishUrl, '_blank');
		}
	}

	// Copy publish URL to clipboard
	async function copyPublishUrl() {
		if (publishUrl) {
			try {
				await navigator.clipboard.writeText(publishUrl);
				new Notice(t('messages.url_copied_to_clipboard') || 'URL copied to clipboard!');
			} catch (error) {
				console.error('Failed to copy URL:', error);
				new Notice('Failed to copy URL');
			}
		}
	}

	/** Take down live site via Control Plane unpublish (share → R2 delete → 404). */
	async function revokeShare() {
		const ok = confirm(t('ui.revoke_share_confirm'));
		if (!ok) return;

		const foundry = plugin.foundryPublishService;
		const name = plugin.currentProjectName || projectName;
		if (!foundry || !name) {
			new Notice(t('ui.revoke_share_done'), 4000);
			return;
		}

		try {
			const bind = await foundry.getCloudflareBinding({
				workspacePath: plugin.absWorkspacePath,
				projectName: name,
			});
			if (!bind.success || !bind.cloudflareProjectId) {
				new Notice(
					plugin.i18n?.t?.('ui.history_no_url') || 'No published project to unpublish.',
					4000,
				);
				return;
			}

			const mgr = plugin.projectServiceManager;
			const auth = mgr ? await mgr.resolveAuthToken() : null;
			const token = auth?.token;
			if (!token) {
				new Notice('No MDF Key', 3000);
				return;
			}

			const res = await foundry.unpublishProject(token, bind.cloudflareProjectId);
			if (!res.success) {
				new Notice(res.error || 'Unpublish failed', 5000);
				return;
			}

			// Best-effort: drop custom domain binding so local project returns to share mode.
			try {
				const domains = await foundry.listDomains(token, bind.cloudflareProjectId);
				const list = domains.domains || [];
				const active = list.find((d) => d.status === 'active' || d.status === 'pending');
				if (active?.id) {
					await foundry.removeDomain(token, active.id);
					await foundry.markBindingShare({
						workspacePath: plugin.absWorkspacePath,
						projectName: name,
						publicBaseUrl: plugin.settings.cloudflarePublicBaseUrl,
					});
				}
			} catch (error) {
				console.warn('[Site] revokeShare domain cleanup failed:', error);
			}

			publishSuccess = false;
			publishUrl = '';
			publishRevoked = true;
			lastCompletedAction = null;
			await saveFoundryConfig('params.lastPublishUrl', '');
			new Notice(t('ui.revoke_share_done'), 4000);
		} catch (error) {
			console.error('[Site] revokeShare failed:', error);
			new Notice((error as Error)?.message || 'Unpublish failed', 5000);
		}
	}

	/** After History rollback: clear revoked UI and restore public URL. */
	async function onHistoryRolledBack() {
		publishRevoked = false;
		publishSuccess = true;
		lastCompletedAction = 'publish';
		historyRefreshKey += 1;

		const foundry = plugin.foundryPublishService;
		const name = plugin.currentProjectName || projectName;
		if (!foundry || !name) return;

		try {
			const bind = await foundry.getCloudflareBinding({
				workspacePath: plugin.absWorkspacePath,
				projectName: name,
			});
			if (!bind.success || !bind.cloudflareProjectId) return;
			const mgr = plugin.projectServiceManager;
			const auth = mgr ? await mgr.resolveAuthToken() : null;
			const token = auth?.token;
			if (!token) return;
			const listed = await foundry.listReleases(token, bind.cloudflareProjectId);
			const url = listed.success ? listed.publicUrl : '';
			if (url) {
				publishUrl = buildPublishUrl(url);
				await persistLastPublishUrl(publishUrl);
			}
		} catch (error) {
			console.warn('[Site] onHistoryRolledBack URL refresh failed:', error);
		}
	}

	function openPreviewUrl() {
		if (previewUrl) {
			window.open(previewUrl, '_blank');
		}
	}

	async function copyPreviewUrl() {
		if (!previewUrl) return;
		try {
			await navigator.clipboard.writeText(previewUrl);
			new Notice(t('messages.url_copied_to_clipboard') || 'URL copied to clipboard!');
		} catch (error) {
			console.error('Failed to copy preview URL:', error);
			new Notice('Failed to copy URL');
		}
	}
</script>

<PublishPanel
	{plugin}
	{t}
	{selectionKind}
	fileName={selectionFileName}
	pathLabel={selectionPathLabel}
	{publishMode}
	{showModeSwitch}
	{showFolderModeFixed}
	{showThemePicker}
	{themeList}
	{selectedThemeSlug}
	{themesLoading}
	{sitePassword}
	{showAuthTip}
	{authPrepareStep}
	{isPublishing}
	{publishProgress}
	{publishUrl}
	{publishError}
	publishErrorAction={publishErrorAction}
	hasContent={currentContents.length > 0}
	{publishRevoked}
	{pathRemembered}
	{previewUrl}
	{isPreviewBuilding}
	{buildProgress}
	{hasPreview}
	{previewWasStopped}
	{lastCompletedAction}
	{historyRefreshKey}
	quotaRevision={quotaRevision}
	accountEpoch={accountEpoch}
	targetListRevision={targetListRevision}
	activeVaultPath={activeVaultPath}
	projectName={plugin.currentProjectName || projectName}
	onSetMode={setPublishMode}
	onSelectTheme={applyThemeBySlug}
	onOpenThemesCatalog={openThemesCatalog}
	onPasswordChange={handlePasswordChange}
	onPublish={startPublish}
	onPreview={startPreview}
	onStopPreview={stopPreview}
	onOpenUrl={openPublishUrl}
	onCopyUrl={copyPublishUrl}
	onRevokeShare={revokeShare}
	onRolledBack={onHistoryRolledBack}
	onClaimStarted={startClaimPoll}
	onOpenPreview={openPreviewUrl}
	onCopyPreview={copyPreviewUrl}
	onContinueAuth={continueGuestKeySetup}
	onOpenAccount={openAccountFromGrowth}
	onDomainActive={onDomainActive}
	onDomainCleared={onDomainCleared}
	onDismissResult={dismissPanelResult}
	onDismissAuthTip={dismissAuthTip}
	onSelectTarget={selectPublishedTarget}
/>


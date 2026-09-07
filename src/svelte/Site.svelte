<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter, requestUrl} from "obsidian";
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
	import * as fs from "fs";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";
	import {themeApiService} from "../theme/themeApiService";
	import type { CatalogEntry } from "../theme/types";
	import type { ProjectState, ProgressUpdate, PublishProgressUpdate } from "../types/events";
	import { buildThemeConfigPatch } from "../theme/theme-config";
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

	// Receive props
	export let app: App;
	export let plugin: FridayPlugin;
	
	// 获取 site 实例
	$: site = plugin.site;
	$: languageContents = site ? site.languageContents : null;
	$: siteAssets = site ? site.siteAssets : null;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	const isWindows = process.platform === 'win32';
	const FRIDAY_ROOT_FOLDER = 'MDFriday';

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
	let hasPreview = false;
	let absPreviewDir = '';

	// Publish related state
	let isPublishing = false;
	let publishProgress = 0;
	let publishSuccess = false;
	let publishUrl = '';
	let publishError = '';
	let selectedPublishOption: PublishMethod = normalizePublishMethod();

	/** Pre-auth: show inline before opening Turnstile browser */
	let authPrepareStep: 'idle' | 'prepare' | 'waiting' = 'idle';

	/** Collapsible project capability sections */
	let themeList: CatalogEntry[] = [];
	let themesLoading = false;

	// Export related state
	let isExporting = false;
	
	// Sample download related state
	let isDownloadingSample = false;
	let sampleDownloadProgress = 0;
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
					const existingConfig = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
					const params = { ...(existingConfig['params'] || {}), ...patch.params };
					await plugin.handleSiteEvent('configChanged', { key: 'params', value: params });
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
		await saveFoundryConfig('theme.catalog', buildThemeConfigPatch(entry));
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
	 * Called by Main.ts after project creation or when loading existing project
	 */
	export async function initialize(state: ProjectState) {
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
			if (matchedTheme) {
				selectedThemeSlug = matchedTheme.slug;
				selectedThemeName = matchedTheme.name;
				selectedThemeDownloadUrl = matchedTheme.packUrl || state.config.module?.imports?.[0]?.path || '';
				userHasSelectedTheme = true;
				currentThemeWithSample = matchedTheme;
				if (state.config.markdown?.useInternalRenderer === undefined) {
					await saveFoundryConfig('markdown.useInternalRenderer', true);
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
		if (state.config.params?.lastPublishUrl) {
			publishUrl = state.config.params.lastPublishUrl;
			publishSuccess = true;
			outputTab = 'online';
		}

			// 5. Load language configuration
			if (state.config.languages && state.config.defaultContentLanguage) {
				// Apply language configuration (with initializing flag to prevent saves)
				await applyLanguageConfiguration(
					state.config.languages,
					state.config.defaultContentLanguage,
					true // isInitializing = true
				);
			}
		}

		// Path-scoped mode wins over Foundry theme leftovers (note → faithful by default).
		if (activeVaultPath) {
			lastHydratedPath = null;
			await hydrateFromPathConfig(activeVaultPath);
		}

		// Notify Main.ts that initialization is complete
		if (plugin.handleSiteEvent) {
			await plugin.handleSiteEvent('initialized', {
				projectName: state.name
			});
		}
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
				outputTab = 'online';
				historyRefreshKey += 1;
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
		previewUrl = normalizeLocalPreviewUrl(result.url || '', result.port || serverPort);
		outputTab = 'preview';
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
		absPreviewDir = ''; // Clear preview directory path when stopped
	}

	function buildPublishUrl(resultUrl: string): string {
		if (!resultUrl) return '';
		if (/^https?:\/\//i.test(resultUrl)) return resultUrl;
		const publicBase =
			plugin.settings.cloudflarePublicBaseUrl || 'https://share.fsky.top';
		const base = publicBase.replace(/\/$/, '');
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
		authPrepareStep = 'idle';

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
		if (!skipPathHydrate) {
			schedulePersistPathConfig();
		}
	}

	/**
	 * Publish error callback
	 */
	export function onPublishError(error: string) {
		publishProgress = 0;
		isPublishing = false;
		isBuilding = false;
		isPreviewBuilding = false;
		publishSuccess = false;
		publishError = error || t('ui.publish_failed');
		console.error('[Site] Publish error:', error);
		new Notice(publishError, 5000);
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
	let serverPort = 8090;

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
			onConnectionTestSuccess,
			onConnectionTestError,
			
			// Quick share and utility methods (migrated from old architecture)
			setSitePath: setSitePathExternal,
			startPreviewAndWait,
			startPublish,
			applyDefaultsAndPublish,
			clearAllContent,
			openAccountFromGrowth,
			enableAutoPublish
		});
		}

		await loadThemeList();

		// Keep sidebar selection in sync with the active markdown note.
		const syncActiveNote = (file: TFile | null) => {
			if (!file || file.extension !== 'md') return;
			if (skipPathHydrate || isPublishing || isPreviewBuilding || plugin.isProjectInitializing) {
				return;
			}
			if (!plugin.isViewOpen?.()) return;
			const currentPath = selectionVaultPath(currentContents);
			if (currentPath === file.path) return;
			void plugin.openPublishPanel(null, file);
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

	async function openAccountFromGrowth() {
		await plugin.openAccountInBrowser();
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
		window.open('https://mdfriday.com/themes', '_blank');
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
	
	function clearAllContent() {
		site.clearAllContent();
	}
	
	function clearSiteAssets() {
		site.clearSiteAssets();
	}

	function openThemeModal() {
		plugin.showThemeSelectionModal(selectedThemeSlug, async (entry) => {
			selectedThemeSlug = entry.slug;
			selectedThemeName = entry.name;
			selectedThemeDownloadUrl = entry.packUrl || '';
			userHasSelectedTheme = true;
			userChoseMode = true;
			publishMode = 'themed';
			currentThemeWithSample = entry;
			await applyThemeFromCatalog(entry);
		}, isForSingleFile);
	}

	async function downloadThemeSample() {
		if (!currentThemeWithSample || !('demo_notes_url' in currentThemeWithSample) || !currentThemeWithSample.demo_notes_url) {
			return;
		}

		isDownloadingSample = true;
		sampleDownloadProgress = 0;

		try {
			// Ensure MDFriday root folder exists
			await ensureRootFolderExists();

			// Generate unique folder name
			const baseName = currentThemeWithSample.name.toLowerCase().replace(/\s+/g, '-');
			const targetFolderName = await generateUniqueFolderName(baseName);
			
			// Construct absolute path using plugin.vaultBasePath
			let targetFolderPath: string;
			
			if (plugin.vaultBasePath) {
				// Use absolute path to avoid vault root interpretation issues
				targetFolderPath = path.join(plugin.vaultBasePath, FRIDAY_ROOT_FOLDER, targetFolderName);
			} else {
				// Fallback for non-FileSystemAdapter
				targetFolderPath = path.join(FRIDAY_ROOT_FOLDER, targetFolderName);
			}
			
			// Normalize path for Windows
			if (isWindows) {
				targetFolderPath = path.normalize(targetFolderPath);
			}

			// Download and unzip sample
			await downloadAndUnzipSample(
				currentThemeWithSample.demo_notes_url,
				targetFolderPath,
				(progress) => {
					sampleDownloadProgress = progress;
				}
			);

			new Notice(t('messages.sample_downloaded_successfully', {
				themeName: currentThemeWithSample.name, 
				folderName: targetFolderName 
			}), 5000);

		} catch (error) {
			console.error('Sample download failed:', error);
			console.error('Error details:', {
				themeName: currentThemeWithSample?.name,
				downloadUrl: currentThemeWithSample?.demo_notes_url,
				platform: process.platform,
				error: error.message
			});
			new Notice(t('messages.sample_download_failed', { error: error.message }), 5000);
		} finally {
			isDownloadingSample = false;
			sampleDownloadProgress = 0;
		}
	}

	// Reactive statement to ensure theme name updates
	$: displayThemeName = selectedThemeName || 'Quartz';

	function toggleAdvancedSettings() {
		showAdvancedSettings = !showAdvancedSettings;
	}

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
		publishUrl = '';
		publishError = '';
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
			return;
		}
		
		try {
			// Use event system to request stop preview
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('stopPreview', {
					projectName: plugin.currentProjectName
				});
			}
			
			new Notice('Preview server stopped', 2000);
		} catch (error) {
			console.error('Error stopping preview:', error);
			new Notice(`Error stopping preview: ${error.message}`, 3000);
		}
	}

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
			new Notice('No project selected. Please right-click a folder first.', 3000);
			return;
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

	async function exportSite() {
		if (!hasPreview || !absPreviewDir) {
			new Notice(t('messages.please_generate_preview_first'), 3000);
			return;
		}

		isExporting = true;

		try {
			// Create ZIP from public directory
			const publicDir = path.join(absPreviewDir, 'public');
			const zipContent = await createZipFromDirectory(publicDir);

			// Use Electron's dialog API to show save dialog
			const { dialog } = require('@electron/remote') || require('electron').remote;
			const { canceled, filePath } = await dialog.showSaveDialog({
				title: t('ui.export_site_dialog_title'),
				defaultPath: 'mdfriday-site.zip',
				filters: [
					{ name: 'ZIP Files', extensions: ['zip'] },
					{ name: 'All Files', extensions: ['*'] }
				]
			});

			if (!canceled && filePath) {
				// Save the ZIP file to the selected path
				await fs.promises.writeFile(filePath, zipContent);
				new Notice(t('messages.site_exported_successfully', { path: filePath }), 3000);
			}

		} catch (error) {
			console.error('Export failed:', error);
			new Notice(t('messages.export_failed', { error: error.message }), 5000);
		} finally {
			isExporting = false;
		}
	}

	async function ensureRootFolderExists() {
		// Ensure we're working with the vault root for the MDFriday folder
		let rootFolderPath: string;
		
		if (plugin.vaultBasePath) {
			// Use absolute path
			rootFolderPath = path.join(plugin.vaultBasePath, FRIDAY_ROOT_FOLDER);
		} else {
			// Fallback for non-FileSystemAdapter
			rootFolderPath = FRIDAY_ROOT_FOLDER;
		}
		
		// For additional safety on Windows, ensure the path is properly normalized
		if (isWindows) {
			rootFolderPath = path.normalize(rootFolderPath);
		}

		const adapter = app.vault.adapter;
		if (!(await adapter.exists(rootFolderPath))) {
			// Use Node.js fs for absolute paths, adapter for relative paths
			if (adapter instanceof FileSystemAdapter && path.isAbsolute(rootFolderPath)) {
				await fs.promises.mkdir(rootFolderPath, { recursive: true });
			} else {
				await adapter.mkdir(rootFolderPath);
			}
		}
	}

	async function generateUniqueFolderName(baseName: string): Promise<string> {
		let folderName = baseName;
		let counter = 0;
		
		// Get the correct root folder path
		let rootFolderPath: string;
		
		if (plugin.vaultBasePath) {
			// Use absolute path
			rootFolderPath = path.join(plugin.vaultBasePath, FRIDAY_ROOT_FOLDER);
		} else {
			// Fallback for non-FileSystemAdapter
			rootFolderPath = FRIDAY_ROOT_FOLDER;
		}
		
		// Normalize the base folder path for consistency
		if (isWindows) {
			rootFolderPath = path.normalize(rootFolderPath);
		}

		while (await checkFolderExists(path.join(rootFolderPath, folderName))) {
			counter++;
			folderName = `${baseName} ${counter}`;
		}

		return folderName;
	}
	
	async function checkFolderExists(folderPath: string): Promise<boolean> {
		const adapter = app.vault.adapter;
		
		if (adapter instanceof FileSystemAdapter && path.isAbsolute(folderPath)) {
			// Use Node.js fs for absolute paths
			try {
				await fs.promises.access(folderPath);
				return true;
			} catch {
				return false;
			}
		} else {
			// Use adapter for relative paths
			return await adapter.exists(folderPath);
		}
	}

	async function downloadAndUnzipSample(
		downloadUrl: string,
		targetFolderPath: string,
		progressCallback: (progress: number) => void
	) {
		try {
			// Download the zip file
			progressCallback(10);
			const response = await requestUrl({
				url: downloadUrl,
				method: 'GET'
			});

			if (response.status !== 200) {
				throw new Error(`Download failed with status: ${response.status}`);
			}

			progressCallback(50);

			// Parse the zip file
			const zip = new JSZip();
			const zipData = await zip.loadAsync(response.arrayBuffer);

			progressCallback(70);

			// Create target folder using appropriate method based on path type
			if (!(await checkFolderExists(targetFolderPath))) {
				if (path.isAbsolute(targetFolderPath)) {
					await fs.promises.mkdir(targetFolderPath, { recursive: true });
				} else {
					await app.vault.adapter.mkdir(targetFolderPath);
				}
			}

			// Extract files
			const files = Object.keys(zipData.files);
			let processedFiles = 0;

			for (const fileName of files) {
				const file = zipData.files[fileName];
				
				// Normalize the file path for cross-platform compatibility
				let normalizedFileName = fileName;
				if (isWindows) {
					// Replace forward slashes with backslashes for Windows
					normalizedFileName = fileName.replace(/\//g, path.sep);
				}
				// Always normalize the path to handle any remaining issues
				normalizedFileName = path.normalize(normalizedFileName);
				
				if (file.dir) {
					// Create directory
					const dirPath = path.join(targetFolderPath, normalizedFileName);
					if (!(await checkFolderExists(dirPath))) {
						if (path.isAbsolute(dirPath)) {
							await fs.promises.mkdir(dirPath, { recursive: true });
						} else {
							await app.vault.adapter.mkdir(dirPath);
						}
					}
				} else {
					// Extract file
					const filePath = path.join(targetFolderPath, normalizedFileName);
					
					// Ensure the parent directory exists before creating the file
					const parentDir = path.dirname(filePath);
					if (parentDir !== targetFolderPath && !(await checkFolderExists(parentDir))) {
						if (path.isAbsolute(parentDir)) {
							await fs.promises.mkdir(parentDir, { recursive: true });
						} else {
							await app.vault.adapter.mkdir(parentDir);
						}
					}
					
					const fileContent = await file.async('uint8array');
					
					// Write file using appropriate method
					if (path.isAbsolute(filePath)) {
						await fs.promises.writeFile(filePath, fileContent);
					} else {
						await app.vault.adapter.writeBinary(filePath, fileContent.buffer as ArrayBuffer);
					}
				}

				processedFiles++;
				const extractProgress = 70 + (processedFiles / files.length) * 30;
				progressCallback(Math.round(extractProgress));
			}

			progressCallback(100);

		} catch (error) {
			console.error('Download and unzip failed:', error);
			throw error;
		}
	}

	async function createZipFromDirectory(sourceDir: string): Promise<Uint8Array> {
		const zip = new JSZip();
		
		// Recursively add files to ZIP
		const addDirectoryToZip = async (dirPath: string, zipFolder: JSZip) => {
			const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
			
			for (const item of items) {
				const itemPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					const subFolder = zipFolder.folder(item.name);
					if (subFolder) {
						await addDirectoryToZip(itemPath, subFolder);
					}
				} else if (item.isFile()) {
					const fileContent = await fs.promises.readFile(itemPath);
					zipFolder.file(item.name, new Uint8Array(fileContent));
				}
			}
		};

		await addDirectoryToZip(sourceDir, zip);
		
		// Generate ZIP file
		return await zip.generateAsync({ type: 'uint8array' });
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

	/** Take down current share link in UI (≠ History rollback). */
	async function revokeShare() {
		const ok = confirm(t('ui.revoke_share_confirm'));
		if (!ok) return;

		const foundry = plugin.foundryPublishService;
		const name = plugin.currentProjectName || projectName;
		if (foundry && name) {
			try {
				const bind = await foundry.getCloudflareBinding({
					workspacePath: plugin.absWorkspacePath,
					projectName: name,
				});
				if (bind.success && bind.cloudflareProjectId) {
					const mgr = plugin.projectServiceManager;
					const auth = mgr ? await mgr.resolveAuthToken() : null;
					const token = auth?.token;
					if (token) {
						const domains = await foundry.listDomains(token, bind.cloudflareProjectId);
						const list = domains.domains || [];
						const active = list.find(
							(d) => d.status === 'active' || d.status === 'pending',
						);
						if (active?.id) {
							await foundry.removeDomain(token, active.id);
							await foundry.markBindingShare({
								workspacePath: plugin.absWorkspacePath,
								projectName: name,
								publicBaseUrl: plugin.settings.cloudflarePublicBaseUrl,
							});
						}
					}
				}
			} catch (error) {
				console.warn('[Site] revokeShare domain cleanup failed:', error);
			}
		}

		publishSuccess = false;
		publishUrl = '';
		await saveFoundryConfig('params.lastPublishUrl', '');
		new Notice(t('ui.revoke_share_done'), 4000);
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
	{modeHint}
	{themeList}
	{selectedThemeSlug}
	{themesLoading}
	{sitePassword}
	{showAuthTip}
	{isPublishing}
	{publishProgress}
	{autoPublishEnabled}
	{publishUrl}
	{publishError}
	hasContent={currentContents.length > 0}
	{previewUrl}
	{isPreviewBuilding}
	{buildProgress}
	{outputTab}
	{historyRefreshKey}
	projectName={plugin.currentProjectName || projectName}
	onSetMode={setPublishMode}
	onSelectTheme={applyThemeBySlug}
	onOpenThemesCatalog={openThemesCatalog}
	onPasswordChange={handlePasswordChange}
	onPublish={startPublish}
	onPreview={startPreview}
	onStopPublish={stopPublish}
	onOpenUrl={openPublishUrl}
	onCopyUrl={copyPublishUrl}
	onRevokeShare={revokeShare}
	onOpenPreview={openPreviewUrl}
	onCopyPreview={copyPreviewUrl}
	onOutputTabChange={(tab) => (outputTab = tab)}
	onContinueAuth={continueGuestKeySetup}
	onOpenAccount={openAccountFromGrowth}
	onDomainActive={onDomainActive}
/>


<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter, requestUrl} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import DomainSection from "./DomainSection.svelte";
	import HistorySection from "./HistorySection.svelte";
	import {onMount, onDestroy, tick} from "svelte";
	import type { PublishMethod } from "../types/publish";
	import { normalizePublishMethod } from "../types/publish";
	import * as path from "path";
	import * as fs from "fs";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";
	import {createStyleRenderer, OBStyleRenderer} from "../markdown";
	import {themeApiService} from "../theme/themeApiService";
	import type { CatalogEntry } from "../theme/types";
	import type { ProjectState, ProgressUpdate, PublishProgressUpdate } from "../types/events";
	import { buildThemeConfigPatch } from "../theme/theme-config";
	import { DEFAULT_THEME_SLUGS, shouldUseInternalRenderer } from "../utils/theme";

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
	
	// 响应式主题设置 - 只在用户未手动选择主题时根据内容类型自动设置
	$: {
		if (currentContents.length > 0 && !userHasSelectedTheme) {
			const firstContent = currentContents[0];
			if (firstContent.file) {
				selectedThemeSlug = DEFAULT_THEME_SLUGS.NOTE;
				selectedThemeName = 'Paper';
			} else if (firstContent.folder) {
				selectedThemeSlug = DEFAULT_THEME_SLUGS.QUARTZ;
				selectedThemeName = 'Quartz';
			}
		}
	}

	// Advanced settings state
	let showAdvancedSettings = false;
	let googleAnalyticsId = '';
	let disqusShortname = '';
	let sitePassword = '';
	
	// UI state for new layout
	let autoPublishEnabled = false;
	let showSettingsPanel = false; // Settings panel collapsed by default
	let showAdvancedInSettings = false; // Advanced settings in settings panel collapsed

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
	let selectedPublishOption: PublishMethod = normalizePublishMethod();

	/** Pre-auth: show inline before opening Turnstile browser */
	let authPrepareStep: 'idle' | 'prepare' | 'waiting' = 'idle';

	/** Collapsible project capability sections */
	let showThemeSection = false;
	let showPreviewSection = false;
	let themeList: CatalogEntry[] = [];
	let themesLoading = false;

	// Export related state
	let isExporting = false;
	
	// Sample download related state
	let isDownloadingSample = false;
	let sampleDownloadProgress = 0;
	let currentThemeWithSample: any = null;

	let hasOBTag = false;
	
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
		if (entry.tags?.length) {
			const useInternalRenderer = shouldUseInternalRenderer(entry.tags);
			await saveFoundryConfig('markdown.useInternalRenderer', useInternalRenderer);
		}
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
				if (matchedTheme.tags && state.config.markdown?.useInternalRenderer === undefined) {
					const useInternalRenderer = shouldUseInternalRenderer(matchedTheme.tags);
					await saveFoundryConfig('markdown.useInternalRenderer', useInternalRenderer);
				}
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
				// 0-20%: Scanning files to upload
				publishProgress = Math.min(20, progress.percentage * 0.2);
				break;
			case 'uploading':
				// 20-80%: Uploading files
				publishProgress = 20 + Math.min(60, progress.percentage * 0.6);
				break;
			case 'deploying':
				// 80-95%: Deploying on server
				publishProgress = 80 + Math.min(15, progress.percentage * 0.15);
				break;
			case 'complete':
				// 100%: Publish complete
				publishProgress = 100;
				break;
			default:
				publishProgress = progress.percentage;
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
		if (result.baseURL) {
			sitePath = result.baseURL;
		}
		if (publishUrl) {
			persistLastPublishUrl(publishUrl);
			plugin.settings.hasPublishedOnce = true;
			void plugin.saveSettings();
			new Notice(t('messages.site_published_successfully'), 5000);
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
		console.error('[Site] Publish error:', error);
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
			clearAllContent,
			openAccountFromGrowth,
			enableAutoPublish
		});
		}

		await loadThemeList();

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
		currentThemeWithSample = theme;

		await applyThemeFromCatalog(theme);
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
	 * Create renderer based on theme tags
	 * If theme has "Book" tag, use OBStyleRenderer (full-featured with plugin rendering)
	 * Otherwise, use lightweight StyleRenderer
	 */
	/**
	 * Reset publish UI state
	 */
	function resetPublishState() {
		isPublishing = true;
		publishProgress = 0;
		publishSuccess = false;
		publishUrl = '';
	}

	async function createRendererBasedOnTheme() {
		try {
			// Get theme information by ID
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			// Ensure ob-images directory exists
			// Convert absolute path to vault-relative path
			if (plugin.vaultBasePath) {
				const relativeObImagesDir = path.relative(plugin.vaultBasePath, obImagesDir);
				
				if (!await app.vault.adapter.exists(relativeObImagesDir)) {
					await app.vault.adapter.mkdir(relativeObImagesDir);
				}
			}
			
			if (hasOBTag) {
				// Use OBStyleRenderer for themes with "Book" tag
				// This includes full CSS collection, plugin rendering, and theme styles
				const renderer = new OBStyleRenderer(plugin, {
					includeCSS: true, // Include CSS in HTML for complete styling
					waitForPlugins: true, // Wait for plugin rendering callbacks
					timeout: 200, // Shorter timeout with smart detection
					containerWidth: "1000px",
					includeTheme: true // Include theme styles
				});
				
				// Configure resource processor for app:// URLs
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
				return renderer;
			} else {
				// Use lightweight StyleRenderer for other themes
				const renderer = createStyleRenderer(plugin, {
					autoHeadingID: true,
					waitForStable: false, // Don't wait for DOM stable for better performance
				});
				
				// Configure resource processor for internal links
				if (renderer.getResourceProcessor) {
					renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
				}
				
				return renderer;
			}
		} catch (error) {
			console.warn('Failed to get theme info, falling back to lightweight renderer:', error);
			// Fallback to lightweight renderer
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			const renderer = createStyleRenderer(plugin, {
				autoHeadingID: true,
				waitForStable: false,
			});
			
			// Configure resource processor for internal links
			if (renderer.getResourceProcessor) {
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
			}
			
			return renderer;
		}
	}

	async function startPreview() {
		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		if (!plugin.currentProjectName) {
			new Notice('No project selected. Please right-click a folder first.', 3000);
			return;
		}

		// Stop previous preview if running to avoid port conflicts
		if (hasPreview || serverRunning) {
			try {
				await stopPreview();
				// Wait a moment for the server to fully stop
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.warn('[Site] Error stopping previous preview:', error);
				// Continue anyway, the new server start might handle the conflict
			}
		}

		isBuilding = true;
		isPreviewBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			// Note: Configuration is auto-saved through reactive statements
			// No need for explicit saveCurrentConfiguration() call
			
			// Get theme info to check if we need custom renderer
			const themeInfo = await themeApiService.getThemeBySlug(selectedThemeSlug, plugin);
			hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			
			// Create custom Markdown renderer based on theme
			const customRenderer = await createRendererBasedOnTheme();
			
			// Use event system to request preview from Main.ts
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('previewRequested', {
					projectName: plugin.currentProjectName,
					port: serverPort,
					renderer: hasOBTag ? customRenderer : undefined,
					publishConfig: undefined
				});
				
				// Note: Progress updates and completion will be handled by callbacks
				// (updateBuildProgress, onPreviewStarted, onPreviewError)
			}

			// Send counter for preview (don't wait for result)
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
		// Note: isBuilding will be set to false by onPreviewStarted/onPreviewError callbacks
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

		// Stop previous preview if running to avoid port conflicts
		if (hasPreview || serverRunning) {
			try {
				await stopPreview();
				// Wait a moment for the server to fully stop
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.warn('[Site] Error stopping previous preview:', error);
				// Continue anyway, the new server start might handle the conflict
			}
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			// Note: Configuration is auto-saved through reactive statements
			// No need for explicit saveCurrentConfiguration() call
			
			// Get theme info to check if we need custom renderer
			const themeInfo = await themeApiService.getThemeBySlug(selectedThemeSlug, plugin);
			hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			
			// Create custom Markdown renderer based on theme
			const customRenderer = await createRendererBasedOnTheme();
			
			// Prepare Cloudflare publish config for auto-publish
			const publishConfig = { method: 'cloudflare' as const, config: undefined };

			resetPublishState();
			
			// Use event system to request preview with publish config from Main.ts
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('previewRequested', {
					projectName: plugin.currentProjectName,
					port: serverPort,
					renderer: hasOBTag ? customRenderer : undefined,
					publishConfig
				});
				
				// Note: Progress updates and completion will be handled by callbacks
				// (updateBuildProgress, onPreviewStarted, onPreviewError)
			}

			// Send counter for preview (don't wait for result)
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
		// Note: isBuilding will be set to false by onPreviewStarted/onPreviewError callbacks
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
			const themeInfo = await themeApiService.getThemeBySlug(selectedThemeSlug, plugin);
			hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			const customRenderer = await createRendererBasedOnTheme();

			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('buildAndPublishRequested', {
					projectName: plugin.currentProjectName,
					renderer: hasOBTag ? customRenderer : undefined,
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

	async function startPublish() {
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

		const mgr = plugin.projectServiceManager;
		if (!plugin.settings.mdfKey && mgr) {
			if (mgr.needsTurnstileForGuest()) {
				authPrepareStep = 'prepare';
				return;
			}
			authPrepareStep = 'waiting';
			const key = await mgr.requestGuestKey();
			authPrepareStep = 'idle';
			if (!key) return;
		}

		await runPublish();
	}

	// Handle auto-publish toggle change (only save when user manually toggles)
	function handleAutoPublishToggle() {
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
</script>

<div class="site-builder">
	<!-- Quick Publish Panel -->
	<div class="quick-publish-panel">
		<!-- Header with Logo and AI Switch Button -->
		<div class="panel-header">
			<div class="panel-header-left">
				<img src="https://gohugo.net/mdfriday.svg" alt="MDFriday" class="mdfriday-logo" width="20" height="20" />
				<span class="panel-title">{displaySiteTitle}</span>
			</div>
		</div>

		{#if authPrepareStep === 'prepare'}
			<div class="auth-prepare-card">
				<div class="auth-prepare-title">{t('ui.publish_prepare_title')}</div>
				<p class="auth-prepare-body">{t('ui.publish_prepare_body')}</p>
				<div class="auth-prepare-actions">
					<button class="mod-cta auth-prepare-continue" on:click={continueGuestKeySetup}>
						{t('ui.publish_prepare_continue')}
					</button>
					<button class="auth-prepare-cancel" on:click={cancelGuestKeySetup}>
						{t('common.cancel')}
					</button>
				</div>
			</div>
		{:else if authPrepareStep === 'waiting'}
			<div class="auth-prepare-card auth-prepare-waiting">
				<div class="auth-prepare-title">{t('ui.publish_prepare_waiting')}</div>
			</div>
		{/if}

		<!-- Current Content Display -->
		<div class="current-content">
			<div class="content-label">{t('ui.current_content') || 'Current Content'}</div>
			<div class="content-display">
				{#if currentContents.length > 0}
					{#each currentContents as content (content.id)}
						<div class="content-item">
							{#if content.folder}
								<svg class="content-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
								</svg>
								<span class="content-path">{content.folder.path}</span>
							{:else if content.file}
								<svg class="content-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
									<polyline points="14 2 14 8 20 8"></polyline>
								</svg>
								<span class="content-path">{content.file.path}</span>
							{/if}
						</div>
					{/each}
				{:else}
					<span class="content-empty">{t('ui.no_content_selected_hint')}</span>
				{/if}
			</div>
		</div>

		<!-- Publish Status Area -->
		<div class="publish-status-area">
			{#if isPublishing && !publishSuccess}
				<!-- Publishing in progress -->
				<div class="status-publishing">
					<div class="status-text">{t('ui.publish_building')}</div>
					<ProgressBar progress={publishProgress} />
				</div>
			{:else if publishSuccess && publishUrl}
				<!-- Published successfully with URL -->
				<div class="status-success">
					<div class="status-text success">✓ {t('ui.growth_title_success')}</div>
					<a href={publishUrl} target="_blank" class="publish-url-display">{publishUrl}</a>
					<div class="url-actions">
						<button class="url-action-btn" on:click={openPublishUrl} title={t('ui.open_in_browser') || 'Open in browser'}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
								<polyline points="15 3 21 3 21 9"></polyline>
								<line x1="10" y1="14" x2="21" y2="3"></line>
							</svg>
							<span>{t('ui.open') || 'Open'}</span>
						</button>
						<button class="url-action-btn" on:click={copyPublishUrl} title={t('ui.copy_url') || 'Copy URL'}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
							</svg>
							<span>{t('ui.copy') || 'Copy'}</span>
						</button>
					</div>
				</div>

				{#if showUpgradeCard}
					<div class="growth-card">
						{#if isGuestAccount}
							<div class="growth-card-title">{t('ui.growth_guest_keep')}</div>
							<p class="growth-card-hint">{t('ui.growth_guest_lead')}</p>
							<ul class="growth-benefits">
								<li>{t('ui.growth_guest_benefit_keep')}</li>
								<li>{t('ui.growth_guest_benefit_same_url')}</li>
								<li>{t('ui.growth_guest_benefit_projects')}</li>
							</ul>
							<button class="mod-cta growth-sign-in-btn" on:click={openAccountFromGrowth}>
								{t('settings.login')}
							</button>
						{:else}
							<div class="growth-card-title">{t('ui.growth_upgrade_title')}</div>
							<p class="growth-card-hint">{t('ui.growth_upgrade_lead')}</p>
							<ul class="growth-benefits">
								<li>{t('ui.growth_upgrade_benefit_domain')}</li>
								<li>{t('ui.growth_upgrade_benefit_history')}</li>
								<li>{t('ui.growth_upgrade_benefit_storage')}</li>
							</ul>
							<button class="mod-cta growth-sign-in-btn" on:click={openAccountFromGrowth}>
								{t('ui.growth_upgrade_cta')}
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Publish Actions -->
		<!-- Publish Actions: primary CTA + auto-publish -->
		<div class="publish-actions-row">
			{#if autoPublishEnabled && isPublishing}
				<div class="publishing-status">
					<span class="publishing-text">{t('ui.realtime_publishing')}</span>
					<button
						class="stop-publish-btn"
						on:click={stopPublish}
						title={t('ui.stop_publish')}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="6" y="6" width="12" height="12"></rect>
						</svg>
						{t('ui.stop')}
					</button>
				</div>
			{:else}
				<button
					class="quick-publish-btn"
					on:click={startPublish}
					disabled={currentContents.length === 0 || isPublishing || authPrepareStep === 'waiting'}
				>
					{publishUrl ? t('ui.publish_again') : t('ui.publish')}
				</button>
			{/if}
			<div class="publish-auto-block">
				<label
					class="auto-publish-toggle publish-auto-toggle"
					title={t('ui.realtime_publish_hint')}
				>
					<input
						type="checkbox"
						class="toggle-checkbox"
						bind:checked={autoPublishEnabled}
						on:change={handleAutoPublishToggle}
						disabled={isPublishing}
					/>
					<span class="toggle-label">{t('ui.realtime_publish')}</span>
				</label>
				<p class="publish-auto-hint">{t('ui.realtime_publish_hint')}</p>
			</div>
		</div>
	</div>

	<!-- Project capabilities -->
	<div class="project-capabilities">
		<div class="capability-section">
			<button
				type="button"
				class="subsection-toggle"
				on:click={() => showThemeSection = !showThemeSection}
				aria-expanded={showThemeSection}
			>
				<svg class="collapse-icon" class:is-collapsed={!showThemeSection} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9"></polyline>
				</svg>
				<span class="setting-item-name">{t('ui.theme')}</span>
				<span class="capability-summary">{displayThemeName}</span>
			</button>
			{#if showThemeSection}
				<div class="capability-body-inline">
					<select
						class="form-select theme-select"
						value={selectedThemeSlug}
						disabled={themesLoading}
						on:change={(e) => applyThemeBySlug(e.currentTarget.value)}
					>
						{#if themesLoading && themeList.length === 0}
							<option value={selectedThemeSlug}>{displayThemeName}</option>
						{:else}
							{#each themeList.filter((t) => t.packUrl) as theme (theme.slug)}
								<option value={theme.slug}>{theme.name}</option>
							{/each}
						{/if}
					</select>
					<p class="field-hint">
						{t('ui.theme_catalog_hint')}
						<button type="button" class="link-button" on:click={openThemesCatalog}>
							mdfriday.com/themes
						</button>
					</p>
					{#if currentThemeWithSample && 'demo_notes_url' in currentThemeWithSample && currentThemeWithSample.demo_notes_url}
						{#if isDownloadingSample}
							<div class="sample-download-progress">
								<span class="progress-text">{t('ui.downloading_sample')}</span>
								<ProgressBar progress={sampleDownloadProgress} />
							</div>
						{:else}
							<button class="action-button" on:click={downloadThemeSample}>
								{t('ui.download_sample')}
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<DomainSection
			{plugin}
			projectName={plugin.currentProjectName || projectName}
			onDomainActive={onDomainActive}
		/>

		<HistorySection
			{plugin}
			projectName={plugin.currentProjectName || projectName}
		/>

		<div class="capability-section">
			<button
				type="button"
				class="subsection-toggle"
				on:click={() => showPreviewSection = !showPreviewSection}
				aria-expanded={showPreviewSection}
			>
				<svg class="collapse-icon" class:is-collapsed={!showPreviewSection} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9"></polyline>
				</svg>
				<span class="setting-item-name">{t('ui.preview')}</span>
				<span class="capability-summary">
					{isPreviewBuilding
						? t('ui.preview_preparing')
						: hasPreview
							? t('ui.preview_ready')
							: t('ui.preview_off')}
				</span>
			</button>
			{#if showPreviewSection}
				<div class="capability-body-inline">
					{#if isPreviewBuilding}
						<div class="progress-container">
							<p>{t('ui.preview_building')}</p>
							<ProgressBar progress={buildProgress} />
						</div>
					{:else if hasPreview && previewUrl}
						<div class="preview-link">
							<p class="section-label">{t('ui.preview_link')}</p>
							<a href={previewUrl} target="_blank" class="preview-url">{previewUrl}</a>
							<div class="preview-actions">
								<button
									class="action-button preview-button"
									on:click={startPreview}
									disabled={currentContents.length === 0}
								>
									{t('ui.regenerate_preview')}
								</button>
								<button
									class="action-button export-button"
									on:click={exportSite}
									disabled={isExporting}
								>
									{isExporting ? t('ui.exporting') : t('ui.export_site')}
								</button>
							</div>
						</div>
					{:else}
						<p class="field-hint">{t('ui.preview_hint')}</p>
						<button
							class="action-button preview-button"
							on:click={startPreview}
							disabled={currentContents.length === 0}
						>
							{t('ui.generate_preview')}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- More settings (Collapsible) -->
	<div class="settings-panel">
		<button 
			class="panel-toggle setting-item-control" 
			on:click={() => showSettingsPanel = !showSettingsPanel}
			aria-expanded={showSettingsPanel}
		>
			<svg class="collapse-icon" class:is-collapsed={!showSettingsPanel} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
			<span class="setting-item-name">{t('ui.more_settings') || 'More settings'}</span>
		</button>
		
		{#if showSettingsPanel}
			<div class="panel-content">
				<!-- Multi-language Content -->
				<div class="settings-section">
					<div class="section-label">{t('ui.multilingual_content')}</div>
					<div class="multilang-table">
						<div class="multilang-header">
							<div class="multilang-header-cell">{t('ui.content_path')}</div>
							<div class="multilang-header-cell">
								<span>{t('ui.language')}</span>
								{#if currentContents.length > 0}
									<button 
										class="add-language-btn"
										on:click={clearAllContent}
										title={t('ui.clear_all_content')}
									>
										{t('ui.clear')}
									</button>
								{/if}
							</div>
						</div>
						{#each currentContents as content (content.id)}
							<div class="multilang-row" class:removable={currentContents.length > 1}>
								<div class="multilang-cell content-path-cell">
									<span class="content-path">
										{content.folder ? content.folder.name : content.file ? content.file.name : t('ui.no_content_selected')}
									</span>
									{#if content.weight === 1}
										<span class="default-badge">{t('ui.default')}</span>
									{/if}
								</div>
								<div class="multilang-cell language-cell">
									<select 
										class="language-select"
										value={content.languageCode}
										on:change={(e) => updateLanguageCode(content.id, e.currentTarget.value)}
									>
										{#each SUPPORTED_LANGUAGES as lang}
											<option value={lang.code}>{lang.name} ({lang.englishName})</option>
										{/each}
									</select>
									{#if currentContents.length > 1}
										<button 
											class="remove-btn"
											on:click={() => removeLanguageContent(content.id)}
											title={t('ui.remove_language')}
										>
											<span class="remove-icon">×</span>
										</button>
									{/if}
								</div>
							</div>
						{/each}
						{#if currentContents.length === 0}
							<div class="multilang-empty">
								<span class="empty-message">{t('ui.no_content_selected_hint')}</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Site Name -->
				<div class="settings-section">
					<label class="section-label" for="site-name">{t('ui.site_name')}</label>
					<input
						type="text"
						class="form-input"
						bind:value={siteName}
						on:blur={() => saveFoundryConfig('title', siteName)}
						placeholder={t('ui.site_name_placeholder')}
					/>
				</div>

				<!-- Publish Configuration -->
				<div class="settings-section">
					<h3 class="section-title">{t('ui.publish_config') || 'Publish Configuration'}</h3>
					<div class="publish-section">
						<div class="field-hint">
							Publishes to Cloudflare automatically. No account required.
						</div>
					</div>
				</div>

				<!-- Advanced Settings (Collapsible with Obsidian style) -->
				<div class="settings-section">
					<div class="collapsible-section">
						<button 
							class="subsection-toggle setting-item-control" 
							on:click={() => showAdvancedInSettings = !showAdvancedInSettings}
							aria-expanded={showAdvancedInSettings}
						>
							<svg class="collapse-icon" class:is-collapsed={!showAdvancedInSettings} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="6 9 12 15 18 9"></polyline>
							</svg>
							<span class="setting-item-name">{t('ui.advanced_settings')}</span>
						</button>
						
						{#if showAdvancedInSettings}
							<div class="subsection-content">
								<!-- Site Assets -->
								<div class="advanced-field">
									<div class="section-label">{t('ui.site_assets')}</div>
									<div class="site-assets-container">
										<div class="assets-display">
											{#if currentAssets}
												<span class="assets-path">{currentAssets.folder?.name || currentAssets.path}</span>
												<button 
													class="clear-assets-btn"
													on:click={clearSiteAssets}
													title={t('ui.clear_assets')}
												>
													{t('ui.clear_assets')}
												</button>
											{:else}
												<span class="assets-placeholder">{t('ui.site_assets_placeholder')}</span>
											{/if}
										</div>
										<div class="assets-hint">
											{t('ui.site_assets_hint')}
										</div>
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="site-path">{t('ui.site_path')}</label>
									<input
										type="text"
										id="site-path"
										class="form-input form-input-readonly"
										value={sitePath}
										readonly
										placeholder={t('ui.site_path_share_placeholder')}
										title={t('ui.site_path_share_hint')}
									/>
									<div class="field-hint">
										{t('ui.site_path_share_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="site-password">{t('ui.site_password')}</label>
									<input
										type="password"
										class="form-input"
										bind:value={sitePassword}
										on:blur={() => saveFoundryConfig('params.password', sitePassword)}
										placeholder={t('ui.site_password_placeholder')}
										title={t('ui.site_password_hint')}
									/>
									<div class="field-hint">
										{t('ui.site_password_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="google-analytics">{t('ui.google_analytics_id')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={googleAnalyticsId}
										on:blur={() => saveFoundryConfig('services.googleAnalytics.id', googleAnalyticsId)}
										placeholder={t('ui.google_analytics_placeholder')}
										title={t('ui.google_analytics_hint')}
									/>
									<div class="field-hint">
										{t('ui.google_analytics_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="disqus-shortname">{t('ui.disqus_shortname')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={disqusShortname}
										on:blur={() => saveFoundryConfig('params.disqusShortname', disqusShortname)}
										placeholder={t('ui.disqus_placeholder')}
										title={t('ui.disqus_hint')}
									/>
									<div class="field-hint">
										{t('ui.disqus_hint')}
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* ========== Main Container ========== */
	.site-builder {
		padding: 16px;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* ========== Quick Publish Panel ========== */
	.quick-publish-panel {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.mdfriday-logo {
		flex-shrink: 0;
		display: block;
	}

	.panel-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.auth-prepare-card {
		margin-bottom: 16px;
		padding: 12px 14px;
		background: var(--mdf-primary-soft, var(--background-secondary));
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: var(--mdf-radius-sm, 6px);
	}

	.auth-prepare-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-normal);
		margin-bottom: 6px;
	}

	.auth-prepare-body {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0 0 12px;
		line-height: 1.45;
	}

	.auth-prepare-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.auth-prepare-continue {
		border-color: var(--mdf-primary, var(--interactive-accent)) !important;
	}

	.auth-prepare-cancel {
		padding: 6px 12px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-size: 13px;
		cursor: pointer;
	}

	.auth-prepare-cancel:hover {
		color: var(--text-normal);
	}

	.auth-prepare-waiting .auth-prepare-title {
		margin-bottom: 0;
	}

	.growth-card {
		margin-top: 12px;
		padding: 12px 14px;
		background: var(--mdf-primary-soft, var(--background-secondary));
		border: 1px solid var(--mdf-border, var(--background-modifier-border));
		border-radius: var(--mdf-radius-sm, 6px);
	}

	.growth-card-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-normal);
		margin-bottom: 4px;
	}

	.growth-card-hint {
		font-size: 12px;
		color: var(--text-muted);
		margin: 0 0 8px;
		line-height: 1.45;
	}

	.growth-benefits {
		margin: 0 0 12px;
		padding-left: 1.1rem;
		font-size: 12px;
		color: var(--text-normal);
		line-height: 1.55;
	}

	.growth-benefits li {
		margin-bottom: 2px;
	}

	.growth-sign-in-btn {
		width: 100%;
		margin-bottom: 10px;
		border-color: var(--mdf-primary, var(--interactive-accent)) !important;
	}


	.preview-realtime-toggle {
		margin-top: 14px;
	}

	.preview-realtime-hint {
		margin-top: 6px;
		margin-bottom: 0;
	}
	.theme-select {
		width: 100%;
	}

	.link-button {
		border: none;
		background: transparent;
		color: var(--mdf-primary, var(--interactive-accent));
		padding: 0;
		font-size: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.growth-sign-in-btn {
		margin-bottom: 0;
	}


	/* Current Content Display */
	.current-content {
		margin-bottom: 16px;
	}

	.content-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 6px;
	}

	.content-display {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		min-height: 36px;
	}

	.content-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.content-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.content-display .content-path {
		color: var(--text-normal);
		font-size: 13px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.content-empty {
		color: var(--text-muted);
		font-size: 13px;
		font-style: italic;
	}

	/* Publish Status Area */
	.publish-status-area {
		margin-bottom: 16px;
		min-height: 60px;
	}

	.status-publishing,
	.status-success {
		padding: 12px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
	}

	.status-text {
		font-size: 13px;
		color: var(--text-muted);
		margin-bottom: 8px;
	}

	.status-text.success {
		color: var(--text-success);
		font-weight: 500;
	}

	.publish-url-display {
		display: block;
		color: var(--interactive-accent);
		text-decoration: none;
		font-size: 12px;
		word-break: break-all;
		margin-bottom: 12px;
		padding: 6px 8px;
		background: var(--background-primary);
		border-radius: 3px;
	}

	.publish-url-display:hover {
		text-decoration: underline;
	}

	.url-actions {
		display: flex;
		justify-content: center;
		gap: 8px;
	}

	.url-action-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.url-action-btn:hover {
		background: var(--interactive-hover);
		border-color: var(--interactive-accent);
	}

	.url-action-btn svg {
		color: var(--text-muted);
	}

	/* Publish Actions Row */
	.publish-actions-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.publish-auto-toggle {
		margin-left: 0;
		flex-shrink: 0;
	}

	.publish-auto-block {
		margin-left: auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		max-width: 52%;
	}

	.publish-auto-hint {
		margin: 0;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-muted);
		text-align: right;
	}

	.quick-publish-btn {
		flex: 0 1 auto;
		min-width: 120px;
		padding: 10px 16px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 36px;
	}

	.quick-publish-btn:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.quick-publish-btn:disabled {
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.publishing-status {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 0 0 auto;
	}

	.publishing-text {
		font-size: 14px;
		font-weight: 500;
		color: var(--interactive-accent);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}

	.stop-publish-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.stop-publish-btn:hover {
		background: var(--background-modifier-error);
		color: var(--text-error);
		border-color: var(--text-error);
	}

	.stop-publish-btn svg {
		fill: currentColor;
	}

	.auto-publish-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		user-select: none;
	}

	.toggle-checkbox {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.toggle-label {
		font-size: 13px;
		color: var(--text-normal);
	}

	/* ========== Settings Panel ========== */
	.settings-panel {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.panel-toggle {
		width: 100%;
		padding: 12px 16px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		transition: background-color 0.2s;
		text-align: left;
	}

	.panel-toggle:hover {
		background: var(--background-modifier-hover);
	}

	/* Obsidian-style collapse icon */
	.collapse-icon {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.collapse-icon.is-collapsed {
		transform: rotate(-90deg);
	}

	.setting-item-name {
		flex: 1;
	}

	.setting-item-control {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		text-align: left;
	}

	.setting-item-control:hover {
		background: var(--background-modifier-hover);
	}

	.panel-content {
		background: var(--background-secondary);
		padding: 16px;
		border-top: 1px solid var(--background-modifier-border);
	}

	/* Settings Sections */
	.settings-section {
		margin-bottom: 20px;
	}

	.settings-section:last-child {
		margin-bottom: 0;
	}

	.section-label {
		display: block;
		margin-bottom: 8px;
		font-weight: 500;
		color: var(--text-normal);
		font-size: 13px;
	}

	.section-title {
		margin: 0 0 10px 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-normal);
	}

	/* Collapsible Subsections */
	.collapsible-section {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--background-primary);
	}

	.subsection-toggle {
		width: 100%;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		transition: background-color 0.2s;
		text-align: left;
	}

	.subsection-toggle:hover {
		background: var(--background-modifier-hover);
	}

	.subsection-content {
		padding: 12px;
		background: var(--background-secondary);
		border-top: 1px solid var(--background-modifier-border);
	}

	/* Preview and Publish Sections */
	.preview-section,
	.publish-section {
		padding: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-secondary);
		margin-top: 8px;
	}

	/* Form Inputs */
	.form-input {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 34px;
	}

	.form-input:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	.form-input-readonly {
		opacity: 0.85;
		cursor: default;
		background: var(--background-secondary);
	}

	.form-select {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 34px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 10px center;
		background-size: 14px;
		padding-right: 36px;
		cursor: pointer;
	}

	.form-select:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	/* Theme Selector */
	.theme-selector {
		width: 100%;
	}

	.current-theme {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		min-height: 34px;
		box-sizing: border-box;
	}

	.theme-name {
		color: var(--text-normal);
		font-size: 13px;
		flex: 1;
	}

	.theme-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.change-theme-btn,
	.download-sample-btn {
		padding: 4px 10px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.change-theme-btn:hover,
	.download-sample-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.sample-download-progress {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 100px;
	}

	.progress-text {
		font-size: 10px;
		color: var(--text-muted);
		text-align: center;
	}

	/* Publish Configuration */
	.publish-select-wrapper {
		margin-bottom: 12px;
	}

	.publish-config {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 12px;
		margin-top: 12px;
	}

	.config-field {
		margin-bottom: 12px;
	}

	.config-field:last-child {
		margin-bottom: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 13px;
		color: var(--text-normal);
	}

	.checkbox-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.field-hint {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 4px;
		line-height: 1.4;
	}

	.license-warning {
		font-size: 11px;
		color: var(--text-accent);
		border: 1px solid var(--background-modifier-error);
		padding: 6px 10px;
		border-radius: 3px;
		margin-top: 8px;
		line-height: 1.4;
	}

	/* Preview Section */
	.action-button {
		width: 100%;
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 34px;
	}

	.action-button:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.action-button:disabled {
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.preview-button {
		margin-bottom: 12px;
	}

	.preview-link {
		margin-top: 12px;
		padding: 10px;
		background: var(--background-primary);
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}

	.preview-link p {
		margin: 0 0 6px 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.preview-url {
		display: block;
		color: var(--interactive-accent);
		text-decoration: none;
		font-size: 12px;
		word-break: break-all;
		margin-bottom: 8px;
	}

	.preview-url:hover {
		text-decoration: underline;
	}

	.preview-actions {
		margin-top: 8px;
		display: flex;
		gap: 8px;
	}

	.export-button {
		background: var(--interactive-normal);
		color: var(--text-normal);
		border: 1px solid var(--background-modifier-border);
	}

	.export-button:hover:not(:disabled) {
		background: var(--interactive-hover);
	}

	.progress-container {
		margin: 8px 0;
	}

	.progress-container p {
		margin: 0 0 8px 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	/* Advanced Settings */
	.advanced-field {
		margin-bottom: 16px;
	}

	.advanced-field:last-child {
		margin-bottom: 0;
	}

	/* Multi-language Table */
	.multilang-table {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--background-primary);
	}

	.multilang-header {
		display: grid;
		grid-template-columns: 1fr 2fr;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.multilang-header-cell {
		padding: 8px 10px;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-normal);
		border-right: 1px solid var(--background-modifier-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		overflow: hidden;
		min-width: 0;
	}

	.multilang-header-cell:last-child {
		border-right: none;
	}

	.add-language-btn {
		padding: 3px 6px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 6px;
	}

	.add-language-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.multilang-row {
		display: grid;
		grid-template-columns: 1fr 2fr;
		border-bottom: 1px solid var(--background-modifier-border);
		transition: background-color 0.2s;
	}

	.multilang-row:last-child {
		border-bottom: none;
	}

	.multilang-row:hover {
		background: var(--background-modifier-hover);
	}

	.multilang-cell {
		padding: 8px 10px;
		display: flex;
		align-items: center;
		border-right: 1px solid var(--background-modifier-border);
		min-height: 34px;
		box-sizing: border-box;
		overflow: hidden;
		min-width: 0;
	}

	.multilang-cell:last-child {
		border-right: none;
	}

	.content-path-cell {
		gap: 6px;
	}

	.multilang-cell .content-path {
		color: var(--text-normal);
		font-size: 12px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.default-badge {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		padding: 2px 5px;
		border-radius: 3px;
		font-size: 10px;
		font-weight: 500;
		white-space: nowrap;
	}

	.language-cell {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.language-select {
		flex: 1;
		max-width: 160px;
		padding: 4px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 3px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 5px center;
		background-size: 10px;
		padding-right: 20px;
		cursor: pointer;
	}

	.remove-btn {
		width: 18px;
		height: 18px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		opacity: 0;
		margin-left: 4px;
	}

	.multilang-row:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		background: var(--background-modifier-error);
		color: var(--text-on-accent);
		transform: scale(1.1);
	}

	.remove-icon {
		line-height: 1;
		font-weight: bold;
	}

	.multilang-empty {
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
		font-style: italic;
	}

	.empty-message {
		font-size: 12px;
	}

	/* Site Assets */
	.site-assets-container {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
	}

	.assets-display {
		padding: 8px 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 34px;
		box-sizing: border-box;
	}

	.assets-path {
		color: var(--text-normal);
		font-size: 12px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.assets-placeholder {
		color: var(--text-muted);
		font-size: 12px;
		font-style: italic;
		flex: 1;
	}

	.clear-assets-btn {
		padding: 3px 6px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 6px;
	}

	.clear-assets-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.assets-hint {
		padding: 6px 10px;
		background: var(--background-secondary);
		border-top: 1px solid var(--background-modifier-border);
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	/* Panel header layout */
	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.panel-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}
</style> 

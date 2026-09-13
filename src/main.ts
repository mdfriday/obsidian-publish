import {FileSystemAdapter, MarkdownView, Menu, Notice, Platform, Plugin, setIcon, TAbstractFile, TFile, TFolder} from 'obsidian';
import * as path from 'path';
import {I18nService} from "./i18n";
import {FridaySettingTab} from "./setting";
// Foundry PC 专用服务类型
import type {
	ObsidianAuthService,
	ObsidianBuildService,
	ObsidianDomainService,
	ObsidianFolderStructureInfo,
	ObsidianGlobalConfigService,
	ObsidianLicenseService,
	ObsidianProjectInfo,
	ObsidianProjectService,
	ObsidianPublishService,
	ObsidianServeService,
} from '@mdfriday/foundry';
// Mobile 专用配置类型
import type {ObsidianEnvironmentConfig as ObsidianMobileEnvironmentConfig,} from '@mdfriday/foundry/obsidian/mobile';
import {createObsidianHttpClient, createObsidianIdentityHttpClient} from './http';
import {LicenseStateManager} from './services/licenseState';
import {ProjectServiceManager} from './services/project';
import {
	deletePathConfigKey,
	migratePathConfigsOnRename,
	normalizeVaultPath,
	pathsEqual,
	projectPrimaryVaultPath,
	remapPathAfterRename,
} from './services/project-path';
import type {ProgressUpdate, ProjectState, PublishProgressUpdate, SiteEventData, SiteEventType} from './types/events';
import {normalizePublishMethod} from './types/publish';
import {resolveDefaultTheme, shouldUseInternalRenderer} from './utils/theme';
import {buildThemeConfigPatch} from './theme/theme-config';
import {joinPath, joinVaultPath} from './utils/common';
import {
	DEFAULT_CLOUDFLARE_ENV,
	type CloudflareEnvResolved,
	endpointsForEnv,
	resolveAccountBaseUrl,
} from './cloudflare-env';

// PC-only module types (dynamically imported)
import type {Hugoverse} from "./hugoverse";
import type {Site} from "./site";

/** Factories not exported as classes — infer service instance types. */
type FoundryModule = typeof import('@mdfriday/foundry');
type ObsidianWorkspaceService = ReturnType<FoundryModule['createObsidianWorkspaceService']>;
type ObsidianProjectConfigService = ReturnType<FoundryModule['createObsidianProjectConfigService']>;

/** Site.svelte handle registered via registerSiteComponent. */
export interface SiteComponentHandle {
	initialize?: (projectState: ProjectState, epoch?: number) => void | Promise<void>;
	updateBuildProgress?: (progress: ProgressUpdate) => void;
	updatePublishProgress?: (progress: PublishProgressUpdate | Record<string, unknown>) => void;
	onBuildComplete?: (result: unknown) => void;
	onBuildError?: (error: unknown) => void;
	onPreviewStarted?: (result: unknown) => void;
	onPreviewError?: (error: unknown) => void;
	onPreviewStopped?: () => void;
	onPublishComplete?: (result: { url?: string; baseURL?: string; [key: string]: unknown }) => void;
	onPublishError?: (error: unknown, code?: unknown) => void;
	onAccountUpdated?: (info?: {
		success?: boolean;
		plan?: string;
		kind?: string;
		source?: string;
	}) => void;
	onConnectionTestSuccess?: (message: unknown) => void;
	onConnectionTestError?: (error: unknown) => void;
	setSitePath?: (path: string) => void;
	startPreviewAndWait?: () => Promise<boolean>;
	startPublish?: () => Promise<void>;
	applyDefaultsAndPublish?: () => Promise<void>;
	clearAllContent?: () => void;
	followSelection?: (folder: TFolder | null, file: TFile | null) => void;
	notifyTargetsChanged?: () => void;
	openAccountFromGrowth?: () => void | Promise<void>;
	enableAutoPublish?: () => void;
}

// Export view type for dynamic import
export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';

interface FridaySettings {
	/** Theme pack download region (fixed default; no Settings UI). */
	downloadServer: 'global' | 'east';
	/** Unified MDF_… Key (guest or user). Kind is not encoded in the string. */
	mdfKey: string | null;
	/** Cached kind from GET /v1/account — display only */
	mdfKeyKind: 'guest' | 'user' | null;
	/** Cached plan from GET /v1/account */
	mdfKeyPlan: string | null;
	/** Cached usage / quota snapshot from GET /v1/account */
	mdfStorageBytes: number | null;
	mdfQuotaStorageBytes: number | null;
	mdfContentExpiresAt: number | null;
	mdfProjectCount: number | null;
	mdfQuotaMaxProjects: number | null;
	mdfQuotaRetentionDays: number | null;
	mdfQuotaMaxCustomDomains: number | null;
	mdfQuotaFeatures: string[] | null;
	/** Cached email from GET /v1/account (Google / Personal), display only */
	mdfAccountEmail: string | null;
	/** Set after first successful Cloudflare publish (Growth Card) */
	hasPublishedOnce: boolean;
	/**
	 * Per vault-path publish UI config (mode / theme / hasPasswordFlag).
	 * Never stores password plaintext — submitted only at publish time.
	 */
	pathConfigs: Record<string, import('./types/publish-config').PathPublishConfig>;
	/** Migrated to mdfKey — still read for one-shot data.json migration */
	cloudflareGuestToken?: string | null;
	/** Migrated away — JWT not stored in plugin */
	cloudflareUserToken?: string | null;
	/**
	 * Compile-time DEFAULT_CLOUDFLARE_ENV always wins; kept for data.json compat.
	 */
	cloudflareEnv?: string;
	/** Last applied compile-time env */
	cloudflareResolvedEnv: CloudflareEnvResolved | null;
	/** Derived — refreshed by applyCloudflareEnv() */
	cloudflareApiBaseUrl: string;
	cloudflarePublicBaseUrl: string;
	/** Account site for OAuth / claim (?key=) */
	cloudflareAccountBaseUrl: string;
}

const DEFAULT_SETTINGS: FridaySettings = {
	downloadServer: 'global',
	mdfKey: null,
	mdfKeyKind: null,
	mdfKeyPlan: null,
	mdfStorageBytes: null,
	mdfQuotaStorageBytes: null,
	mdfContentExpiresAt: null,
	mdfProjectCount: null,
	mdfQuotaMaxProjects: null,
	mdfQuotaRetentionDays: null,
	mdfQuotaMaxCustomDomains: null,
	mdfQuotaFeatures: null,
	mdfAccountEmail: null,
	hasPublishedOnce: false,
	pathConfigs: {},
	cloudflareEnv: DEFAULT_CLOUDFLARE_ENV,
	cloudflareResolvedEnv: null,
	cloudflareApiBaseUrl: '',
	cloudflarePublicBaseUrl: '',
	cloudflareAccountBaseUrl: '',
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://app.mdfriday.com';

/** Get base URL for legacy MDFriday API requests (Cloudflare publish uses cloudflareApiBaseUrl). */
export function GetBaseUrl(_settings?: FridaySettings): string {
	if (process.env.NODE_ENV === 'development') {
		return API_URL_DEV;
	}
	return API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	absWorkspacePath: string
	vaultBasePath: string
	apiUrl: string
	
	// Core services (always available)
	i18n: I18nService
	
	// PC-only services (optional, only loaded on desktop)
	hugoverse?: Hugoverse
	site?: Site
	workspaceService?: ObsidianWorkspaceService
	// Foundry services
	foundryProjectService?: ObsidianProjectService | null
	foundryBuildService?: ObsidianBuildService | null
	foundryGlobalConfigService?: ObsidianGlobalConfigService | null
	foundryProjectConfigService?: ObsidianProjectConfigService | null
	foundryServeService?: ObsidianServeService | null
	foundryPublishService?: ObsidianPublishService | null
	foundryAuthService?: ObsidianAuthService | null
	foundryLicenseService?: ObsidianLicenseService | null
	foundryDomainService?: ObsidianDomainService | null
	projectServiceManager?: ProjectServiceManager | null
	// License state manager (unified license state from Foundry)
	licenseState?: LicenseStateManager | null
	// Current project name for tracking
	currentProjectName?: string | null
	/**
	 * Bumped on every openOrFollowSelection so stale async applies
	 * (previous file) cannot overwrite the newer target's UI state.
	 */
	selectionEpoch: number = 0
	/**
	 * Bumped in applyCloudflareEnv so Svelte UIs re-read Account/API URLs
	 * (settings field mutation alone does not trigger `$:`).
	 */
	cloudflareEnvEpoch: number = 0
	
	// Site.svelte component reference (for new event-driven architecture)
	siteComponent?: SiteComponentHandle
	
	// Project initialization flag (prevents auto-save during new project creation)
	isProjectInitializing: boolean = false

	/** Pending Turnstile deep-link waiter (staging/prod guest challenge). */
	private turnstileWaiter: {
		resolve: (token: string) => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	
	// View management state
	private viewInitialized: boolean = false
	
	// Dynamic module references for PC-only features
	private themeApiService?: typeof import("./theme/themeApiService").themeApiService

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();

		// Obsidian official deep link:
		//   obsidian://mdfriday-publish?event=auth&ok=1
		//   obsidian://mdfriday-publish?event=claim&status=ok
		//   obsidian://mdfriday-publish?event=upgrade&status=ok&plan=personal
		//   obsidian://mdfriday-publish?event=turnstile&token=…
		this.registerObsidianProtocolHandler('mdfriday-publish', async (params) => {
			const event = params.event || params.action;
			if (event === 'turnstile' && params.token) {
				this.resolveTurnstileToken(params.token);
				return;
			}
			const statusOk =
				params.status === 'ok' || params.ok === '1' || params.ok === 'true';
			const accountRefreshOk =
				(event === 'auth' && statusOk) ||
				(event === 'claim' && statusOk) ||
				(event === 'upgrade' && statusOk);
			if (accountRefreshOk) {
				const mgr = this.projectServiceManager;
				if (mgr) {
					const r = await mgr.refreshCloudflareAccount();
					const planLabel = r.plan || this.settings.mdfKeyPlan || '—';
					new Notice(
						r.success
							? this.i18n?.t?.('ui.claim_refresh_ok')?.replace('{{plan}}', planLabel) ||
									`Signed in — plan: ${planLabel}`
							: this.i18n?.t?.('ui.claim_refresh_fail')?.replace('{{error}}', r.error || '') ||
									`Account refresh failed: ${r.error}`,
						5000,
					);
					this.siteComponent?.onAccountUpdated?.({
						success: r.success,
						plan: r.plan,
						kind: r.kind,
						source: event === 'upgrade' ? 'upgrade' : 'claim',
					});
				}
			}
		});
		
		// Initialize core services (always needed)
		await this.initCore();
		
		// Platform-specific initialization
		if (Platform.isDesktop) {
			// Initialize absolute workspace path (PC-only)
			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				const basePath = adapter.getBasePath();
				this.vaultBasePath = basePath;
				this.absWorkspacePath = joinPath(basePath, this.pluginDir, 'workspace');
			}

			await this.initDesktopFeatures();
		} else {
			// Initialize workspace path for Mobile (relative path for vault.adapter)
			this.absWorkspacePath = joinVaultPath(this.pluginDir, 'workspace');

			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				this.vaultBasePath = adapter.getBasePath();
			}

			await this.initMobileFeatures();
		}

		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new FridaySettingTab(this.app, this));
	}

	/**
	 * Initialize core services (common for all platforms)
	 */
	private async initCore(): Promise<void> {
		this.apiUrl = GetBaseUrl(this.settings);
		
		// Initialize i18n service first
		this.i18n = new I18nService(this);
		await this.i18n.init();

		const { Hugoverse } = await import('./hugoverse');
		this.hugoverse = new Hugoverse(this);
		
		// Note: License usage is fetched when user opens Settings page (not on startup)
		// This improves plugin startup performance
	}

	/**
	 * Initialize desktop-only features
	 */
	private async initDesktopFeatures(): Promise<void> {
		const [
			{ default: ServerView },
			{ Site },
			{ themeApiService },
		] = await Promise.all([
			import('./server'),
			import('./site'),
			import('./theme/themeApiService'),
		]);
		
		await Promise.all([
			import('./styles/mdf-tokens.css'),
			import('./styles/apple-panel.css'),
			import('./styles/capability-sections.css'),
		]);
		
		this.themeApiService = themeApiService;
		this.site = new Site(this);

		await this.initializeWorkspace();
		
		try {
			this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this));
		} catch (_e) {
			console.error('[Friday] View already registered, skipping');
		}
		
		this.app.workspace.onLayoutReady(() => this.initLeaf());
		
		// Add internet icon to markdown view header
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.addInternetIconToView(leaf.view);
				}
			})
		);
		
		this.app.workspace.onLayoutReady(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				this.addInternetIconToView(activeView);
			}
		});
		
		// Register context menu for files and folders (PC-only):
		// Open in MDFriday (config) + Publish to MDFriday (auto publish).
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					this.addPublishMenuItems(menu, file);
				} else if (file instanceof TFile && file.extension === 'md') {
					this.addPublishMenuItems(menu, file);
				}
			})
		);

		// Keep pathConfigs / remote source_path in sync when vault paths change.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				void this.onVaultPathRenamed(file, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				void this.onVaultPathDeleted(file.path);
			}),
		);

		this.addCommand({
			id: 'quick-share',
			name: this.i18n.t('menu.quick_share'),
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					void this.quickShareCurrentFile(view);
				}
			},
		});

		this.addCommand({
			id: 'quick-publish',
			name: this.i18n.t('menu.publish_to_web'),
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file) {
					void this.publishToWeb(view.file);
				}
			},
		});
	}

	/**
	 * Open sidebar for file/folder without publishing (config + load existing project).
	 */
	private addOpenInMdfridayMenuItem(menu: Menu, fileOrFolder: TFile | TFolder) {
		menu.addItem(item => {
			item
				.setTitle(this.i18n.t('menu.open_in_mdfriday'))
				.setIcon(FRIDAY_ICON)
				.onClick(async () => {
					if (fileOrFolder instanceof TFile) {
						await this.openOrFollowSelection(null, fileOrFolder, { createIfMissing: true });
					} else {
						await this.openOrFollowSelection(fileOrFolder, null, { createIfMissing: true });
					}
				});
		});
	}

	/**
	 * File/folder menus: Open in MDFriday + Publish to MDFriday.
	 */
	private addPublishMenuItems(menu: Menu, fileOrFolder: TFile | TFolder) {
		this.addOpenInMdfridayMenuItem(menu, fileOrFolder);
		menu.addItem(item => {
			item
				.setTitle(this.i18n.t('menu.publish_to_web'))
				.setIcon(FRIDAY_ICON)
				.onClick(async () => {
					await this.publishToWeb(fileOrFolder);
				});
		});
	}

	/**
	 * Initialize workspace and Foundry services (PC-only)
	 */
	private async initializeWorkspace(): Promise<void> {
		try {
			// 动态导入 PC 专用的 Foundry 服务（从根目录）
			const {
				createObsidianWorkspaceService,
				createObsidianProjectService,
				createObsidianBuildService,
				createObsidianGlobalConfigService,
				createObsidianProjectConfigService,
				createObsidianServeService,
				createObsidianPublishService,
				createObsidianAuthService,
				createObsidianLicenseService,
				createObsidianDomainService,
			} = await import('@mdfriday/foundry');
			
		// Create workspace service（无需参数，使用 Node.js 默认实现）
		this.workspaceService = createObsidianWorkspaceService();
		
		// Get relative workspace path for Obsidian adapter
		const relativeWorkspacePath = joinVaultPath(this.pluginDir, 'workspace');
		
		// Ensure workspace directory exists using Obsidian's adapter
		if (!await this.app.vault.adapter.exists(relativeWorkspacePath)) {
			await this.app.vault.adapter.mkdir(relativeWorkspacePath);
		}
			
			// Check if workspace is already initialized (using absolute path)
			const existsResult = await this.workspaceService.workspaceExists(this.absWorkspacePath);
			
			if (existsResult.success && !existsResult.data) {
				// Workspace doesn't exist, initialize it
				const initResult = await this.workspaceService.initWorkspace(this.absWorkspacePath);
				
				if (!initResult.success) {
					console.error('[Friday] Failed to initialize workspace:', initResult.error);
				}
			} else if (!existsResult.success) {
				console.error('[Friday] Failed to check workspace existence:', existsResult.error);
			}
			
		// Initialize PC-only Foundry services（无参数，使用默认实现）
		this.foundryProjectService = createObsidianProjectService();
		this.foundryBuildService = createObsidianBuildService();
		this.foundryGlobalConfigService = createObsidianGlobalConfigService();
		this.foundryProjectConfigService = createObsidianProjectConfigService();
		
		// Create HTTP client for Serve service (with publish support)
		const httpClient = createObsidianHttpClient();
		this.foundryServeService = createObsidianServeService(httpClient, {
			apiBaseUrl: this.settings.cloudflareApiBaseUrl,
		});
		this.foundryPublishService = createObsidianPublishService(httpClient, {
			apiBaseUrl: this.settings.cloudflareApiBaseUrl,
			publicBaseUrl: this.settings.cloudflarePublicBaseUrl,
		});

		// Resolve env (auto → local|staging) and wire live ControlPlane URL
		await this.applyCloudflareEnv({ persist: true });
		
		// Create Identity HTTP client for Auth, License, and Domain services
		const identityHttpClient = createObsidianIdentityHttpClient();
		this.foundryAuthService = createObsidianAuthService(identityHttpClient);
		this.foundryLicenseService = createObsidianLicenseService(identityHttpClient);
		this.foundryDomainService = createObsidianDomainService(identityHttpClient);

	// Create Project Service Manager
	if (this.foundryProjectService && this.foundryProjectConfigService) {
		this.projectServiceManager = new ProjectServiceManager(this);
	}

	// Create License State Manager (optional — Cloudflare guest publish does not require license)
	if (this.foundryLicenseService && this.foundryAuthService && this.foundryDomainService) {
		this.licenseState = new LicenseStateManager(
			this.foundryLicenseService,
			this.foundryAuthService,
			this.foundryDomainService,
			this.absWorkspacePath
		);

		try {
			await this.licenseState.initialize();
		} catch (error) {
			console.debug('[Friday] License init skipped (Cloudflare guest mode):', error);
		}
	}

		// Load settings from Foundry Global Config (merge with local settings)
		await this.loadSettingsFromFoundryGlobalConfig();
		} catch (error) {
			console.error('[Friday] Error initializing workspace:', error);
		}
	}

	/**
	 * Initialize mobile-only features
	 */
	private async initMobileFeatures(): Promise<void> {
		try {
			await this.initializeWorkspaceMobile();
		} catch (error) {
			console.error('[Friday Mobile] Error initializing mobile features:', error);
		}
	}

	/**
	 * Initialize workspace and Foundry services for Mobile
	 */
	private async initializeWorkspaceMobile(): Promise<void> {
		try {
			// 动态导入 Mobile repositories
			const { ObsidianMobileWorkspaceRepository, ObsidianMobileFileSystemRepository } =
				await import('./services/obsidian-mobile-repositories');
			
			// 动态导入 Mobile 专用的 Foundry 服务
			const {
				createObsidianWorkspaceService,
				createObsidianAuthService,
				createObsidianLicenseService,
				createObsidianGlobalConfigService,
			} = await import('@mdfriday/foundry/obsidian/mobile');
			
			// 1. 创建 Mobile repositories
			const workspaceRepo = new ObsidianMobileWorkspaceRepository(
				this.app.vault,
				this.pluginDir
			);
			const fileSystemRepo = new ObsidianMobileFileSystemRepository(
				this.app.vault,
				this.pluginDir
			);
			const httpClient = createObsidianIdentityHttpClient();

			// 2. 创建配置（使用实际的 API，而非文档中描述的简化版本）
			const config: ObsidianMobileEnvironmentConfig = {
				platform: 'mobile',
				persistence: {
					workspace: workspaceRepo,
					fileSystem: fileSystemRepo,
				},
				identityHttpClient: httpClient,
			};

			// 3. 创建服务（必须传入 config）
			this.workspaceService = createObsidianWorkspaceService(config);
			this.foundryAuthService = createObsidianAuthService(httpClient, config);
			this.foundryLicenseService = createObsidianLicenseService(httpClient, config);
			this.foundryGlobalConfigService = createObsidianGlobalConfigService(config);
			// 注意：Mobile 不创建 DomainService（发布功能专用）
		
		// 4. 确保 workspace 目录存在
		// Mobile 使用相对路径（相对于 vault 根目录）
		if (!await this.app.vault.adapter.exists(this.absWorkspacePath)) {
			await this.app.vault.adapter.mkdir(this.absWorkspacePath);
		}
		
		// 5. 检查并初始化 workspace
		const existsResult = await this.workspaceService.workspaceExists(this.absWorkspacePath);
		
		if (existsResult.success && !existsResult.data) {
			const initResult = await this.workspaceService.initWorkspace(this.absWorkspacePath);
			
			if (!initResult.success) {
				console.error('[Friday Mobile] Failed to initialize workspace:', initResult.error);
			}
		} else if (!existsResult.success) {
			console.error('[Friday Mobile] Failed to check workspace existence:', existsResult.error);
		}
		
		// 创建服务管理器（只创建 Mobile 需要的）
		// 注意：不创建 DomainServiceManager / ProjectServiceManager（Mobile 不需要）
		
		// Create License State Manager (optional on mobile)
		if (this.foundryLicenseService && this.foundryAuthService) {
			this.licenseState = new LicenseStateManager(
				this.foundryLicenseService,
				this.foundryAuthService,
				null, // domainService = null (Mobile)
				this.absWorkspacePath
			);

			try {
				await this.licenseState.initialize();
			} catch (error) {
				console.debug('[Friday Mobile] License init skipped (Cloudflare guest mode):', error);
			}
		}

		// 加载设置（与 PC 端一致）
		await this.loadSettingsFromFoundryGlobalConfig();

	} catch (error) {
		console.error('[Friday Mobile] Error initializing workspace:', error);
	}
}

	async openPublishPanel(folder: TFolder | null, file: TFile | null) {
		await this.openOrFollowSelection(folder, file, { createIfMissing: true });
	}

	/**
	 * Open or soft-follow a vault selection in the publish sidebar.
	 * createIfMissing=false (file-open): update UI only; load existing project if path matches.
	 * createIfMissing=true (menu / publish): create local Foundry project when needed.
	 */
	async openOrFollowSelection(
		folder: TFolder | null,
		file: TFile | null,
		opts: { createIfMissing: boolean },
	) {
		const epoch = ++this.selectionEpoch;
		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit) {
			return;
		}
		if (rightSplit.collapsed) {
			rightSplit.expand();
		}

		const vaultPath = normalizeVaultPath(folder?.path ?? file?.path ?? null);
		if (!vaultPath) {
			console.warn('Unable to determine vault path');
			return;
		}

		const existingByPath = await this.findLocalProjectByVaultPath(vaultPath);
		if (epoch !== this.selectionEpoch) return;

		if (existingByPath) {
			this.site.clearAllContent(true);
			await this.applyFoundryProjectToPanel(existingByPath, folder, file, epoch);
			if (epoch !== this.selectionEpoch) return;
			await this.activateView();
			this.siteComponent?.notifyTargetsChanged?.();
			return;
		}

		if (!opts.createIfMissing) {
			this.currentProjectName = null;
			if (this.siteComponent?.followSelection) {
				this.siteComponent.followSelection(folder, file);
			} else {
				this.site.clearAllContent(true);
				this.site.replaceSelection(folder, file);
			}
			await this.activateView();
			this.siteComponent?.notifyTargetsChanged?.();
			return;
		}

		const projectName = this.getProjectNameFromSelection(folder, file);
		if (!projectName) {
			console.warn('Unable to determine project name');
			return;
		}

		// Fallback: same basename project (legacy) when path not indexed yet
		const existingProject = await this.getFoundryProject(projectName);
		if (epoch !== this.selectionEpoch) return;

		if (existingProject) {
			const primary = projectPrimaryVaultPath(this, existingProject);
			if (primary && !pathsEqual(primary, vaultPath)) {
				// Basename collision with a different path — create a distinct project name
				const uniqueName = this.uniqueProjectNameForPath(vaultPath, projectName);
				const created = await this.createFoundryProject(uniqueName, folder, file);
				if (epoch !== this.selectionEpoch) return;
				if (created) {
					const newProject = await this.getFoundryProject(uniqueName);
					if (epoch !== this.selectionEpoch) return;
					if (newProject) {
						this.isProjectInitializing = true;
						this.site.clearAllContent(true);
						await this.applyFoundryProjectToPanel(newProject, folder, file, epoch);
						this.isProjectInitializing = false;
					}
				}
			} else {
				this.site.clearAllContent(true);
				await this.applyFoundryProjectToPanel(existingProject, folder, file, epoch);
			}
		} else {
			const created = await this.createFoundryProject(projectName, folder, file);
			if (epoch !== this.selectionEpoch) return;
			if (created) {
				const newProject = await this.getFoundryProject(projectName);
				if (epoch !== this.selectionEpoch) return;
				if (newProject) {
					this.isProjectInitializing = true;
					this.site.clearAllContent(true);
					await this.applyFoundryProjectToPanel(newProject, folder, file, epoch);
					this.isProjectInitializing = false;
				} else {
					console.error('[Friday] Failed to retrieve newly created project');
				}
			}
		}

		if (epoch !== this.selectionEpoch) return;
		await this.activateView();
		this.siteComponent?.notifyTargetsChanged?.();
	}

	/**
	 * Ensure a local Foundry project exists for the current sidebar selection (preview/publish).
	 */
	async ensureProjectForSelection(): Promise<boolean> {
		if (this.currentProjectName) return true;
		const contents = this.site.getCurrentContents();
		const first = contents[0];
		if (!first) return false;
		await this.openOrFollowSelection(first.folder, first.file, { createIfMissing: true });
		return !!this.currentProjectName;
	}

	private uniqueProjectNameForPath(vaultPath: string, baseName: string): string {
		const safe = vaultPath.replace(/[\\/]/g, '__').replace(/\.md$/i, '');
		return safe.length > 0 ? safe : baseName;
	}

	private async findLocalProjectByVaultPath(vaultPath: string): Promise<ObsidianProjectInfo | null> {
		if (!this.foundryProjectService || !this.absWorkspacePath) return null;
		try {
			const result = await this.foundryProjectService.listProjects(this.absWorkspacePath);
			if (!result.success || !result.data) return null;
			for (const project of result.data) {
				const primary = projectPrimaryVaultPath(this, project);
				if (pathsEqual(primary, vaultPath)) {
					return project;
				}
			}
		} catch (error) {
			console.error('[Friday] Error listing projects for path match:', error);
		}
		return null;
	}

	/**
	 * Get project name from folder or file selection
	 */
	private getProjectNameFromSelection(folder: TFolder | null, file: TFile | null): string | null {
		if (folder) {
			return folder.name;
		} else if (file) {
			return file.basename;
		}
		return null;
	}

	/**
	 * Get Foundry project by name
	 */
	private async getFoundryProject(projectName: string): Promise<ObsidianProjectInfo | null> {
		if (!this.foundryProjectService) {
			return null;
		}

		try {
			const result = await this.foundryProjectService.getProjectInfo(this.absWorkspacePath, projectName);
			if (result.success && result.data) {
				return result.data;
			}
		} catch (error) {
			console.error('[Friday] Error getting project:', error);
		}
		return null;
	}

	/**
	 * Register Site component
	 */
	/**
	 * Register Site.svelte component for direct method calls
	 * Part of new event-driven architecture
	 */
	registerSiteComponent(component: SiteComponentHandle) {
		this.siteComponent = component;
	}

	/**
	 * Handle Site component events
	 */
	async handleSiteEvent<T extends SiteEventType>(
		type: T,
		data: SiteEventData[T]
	): Promise<void> {
		switch (type) {
			case 'initialized':
				await this.onSiteInitialized(data as SiteEventData['initialized']);
				break;

			case 'configChanged':
				await this.onConfigChanged(data as SiteEventData['configChanged']);
				break;

			case 'buildRequested':
				await this.onBuildRequested(data as SiteEventData['buildRequested']);
				break;

			case 'previewRequested':
				await this.onPreviewRequested(data as SiteEventData['previewRequested']);
				break;

			case 'publishRequested':
				await this.onPublishRequested(data as SiteEventData['publishRequested']);
				break;

			case 'buildAndPublishRequested':
				await this.onBuildAndPublishRequested(
					data as SiteEventData['buildAndPublishRequested'],
				);
				break;

			case 'testConnection':
				await this.onTestConnection(data as SiteEventData['testConnection']);
				break;

			case 'stopPreview':
				await this.onStopPreview(data as SiteEventData['stopPreview']);
				break;
		}
	}

	// ==================== Event Handlers ====================

	private async onSiteInitialized(data: SiteEventData['initialized']) {}

	private async onConfigChanged(data: SiteEventData['configChanged']) {
		if (!this.currentProjectName || !this.projectServiceManager) {
			return;
		}

		// Save configuration to Foundry
		const success = await this.projectServiceManager.saveConfig(
			this.currentProjectName,
			data.key,
			data.value
		);

		if (!success) {
			console.error(`Failed to save configuration: ${data.key}`);
		}
	}

	private async onBuildRequested(data: SiteEventData['buildRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		// Create progress callback
		const onProgress = (progress: ProgressUpdate) => {
			// Send progress updates to Site component
			this.siteComponent?.updateBuildProgress?.(progress);
		};

		// Execute build
		const result = await this.projectServiceManager.build(
			data.projectName,
			onProgress
		);

		if (result.success) {
			this.siteComponent?.onBuildComplete?.(result);
		} else {
			this.siteComponent?.onBuildError?.(result.error);
		}
	}

	private async onPreviewRequested(data: SiteEventData['previewRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		const { projectName, port, renderer, publishConfig } = data;

		const onProgress = (progress: ProgressUpdate) => {
			if (
				publishConfig &&
				(progress.phase === 'publishing' || progress.phase === 'publish-success')
			) {
				if (progress.phase === 'publish-success') {
					this.siteComponent?.onPublishComplete?.({
						url: progress.data?.publishUrl,
					});
					return;
				}
				this.siteComponent?.updatePublishProgress?.({
					phase: progress.phase === 'publishing' ? 'uploading' : 'complete',
					percentage: progress.percentage ?? 0,
					message: progress.message,
				});
				return;
			}
			this.siteComponent?.updateBuildProgress?.(progress);
		};

		const result = await this.projectServiceManager.startPreview(
			projectName,
			{ port, renderer, onProgress, publishConfig }
		);

		if (result.success) {
			if (result.publishUrl) {
				this.siteComponent?.onPublishComplete?.({ url: result.publishUrl });
			} else {
				this.siteComponent?.onPreviewStarted?.(result);
			}
		} else {
			if (publishConfig) {
				this.siteComponent?.onPublishError?.(
					result.error || 'Publish failed',
					(result as { code?: string }).code,
				);
			} else {
				this.siteComponent?.onPreviewError?.(result.error);
			}
		}
	}

	private async onBuildAndPublishRequested(
		data: SiteEventData['buildAndPublishRequested'],
	) {
		if (!this.projectServiceManager) {
			return;
		}

		const onProgress = (progress: ProgressUpdate | PublishProgressUpdate) => {
			// Single progress bar under Publish button owns the whole pipeline
			if (
				'phase' in progress &&
				(progress.phase === 'building' || progress.phase === 'build-success')
			) {
				this.siteComponent?.updateBuildProgress?.(progress);
				if (this.siteComponent?.updatePublishProgress) {
					const pct =
						progress.phase === 'build-success'
							? 40
							: Math.min(40, (progress.percentage ?? 0) * 0.4);
					this.siteComponent.updatePublishProgress({
						phase: 'scanning',
						percentage: pct,
						message: progress.message,
					});
				}
			} else {
				this.siteComponent?.updatePublishProgress?.(progress);
			}
		};

		const result = await this.projectServiceManager.buildAndPublishCloudflare(
			data.projectName,
			{ onProgress, skipBuild: !!data.skipBuild },
		);

		if (result.success) {
			this.siteComponent?.onPublishComplete?.(result);
			if (result.baseURL && this.siteComponent?.setSitePath) {
				this.siteComponent.setSitePath(result.baseURL);
			}
		} else {
			this.siteComponent?.onPublishError?.(result.error || 'Publish failed', result.code);
		}
	}

	private async onPublishRequested(data: SiteEventData['publishRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		const { projectName, method, config } = data;

		// Create progress callback
		const onProgress = (progress: PublishProgressUpdate) => {
			// Send progress updates to Site component
			this.siteComponent?.updatePublishProgress?.(progress);
		};

		// Execute publish
		const result = await this.projectServiceManager.publish(
			projectName,
			{ method, config, onProgress }
		);

		if (result.success) {
			this.siteComponent?.onPublishComplete?.(result);
		} else {
			this.siteComponent?.onPublishError?.(result.error, result.code);
		}
	}

	private async onTestConnection(data: SiteEventData['testConnection']) {
		if (!this.projectServiceManager) {
			return;
		}

		const result = await this.projectServiceManager.testConnection(
			data.projectName,
			data.config
		);

		if (result.success) {
			this.siteComponent?.onConnectionTestSuccess?.(result.message);
		} else {
			this.siteComponent?.onConnectionTestError?.(result.error);
		}
	}

	private async onStopPreview(data: SiteEventData['stopPreview']) {
		if (!this.projectServiceManager) {
			return;
		}

		const success = await this.projectServiceManager.stopPreview(data.projectName);

		if (success) {
			this.siteComponent?.onPreviewStopped?.();
		}
	}

	// ==================== Project Management ====================

	/**
	 * Create new Foundry project (simplified - only creates project)
	 */
	private async createFoundryProject(projectName: string, folder: TFolder | null, file: TFile | null): Promise<boolean> {
		try {
			// Collect initial configuration with project context (now async)
			const initialConfig = await this.collectInitialConfig(projectName, folder, file);

			// Create project through ProjectServiceManager
			const result = await this.projectServiceManager.createProject({
				name: projectName,
				folder,
				file,
				initialConfig
			});

			if (!result.success) {
				throw new Error(result.error);
			}

			return true;

		} catch (error) {
			console.error('[Friday] Error creating project:', error);
			return false;
		}
	}

	/**
	 * Collect initial configuration for new project
	 * Prepares complete configuration including baseURL, title, theme, etc.
	 * 
	 * @param projectName - Project name
	 * @param folder - Selected folder (if folder project)
	 * @param file - Selected file (if file project)
	 * @returns Complete initial configuration
	 */
	private async collectInitialConfig(projectName: string, folder: TFolder | null, file: TFile | null): Promise<Record<string, unknown>> {
		const publishMethod = normalizePublishMethod();
		
		// Determine if this is a folder project
		const isFolder = folder !== null;
		
		// Default theme from catalog (Foundry downloads pack from module.imports.path)
		const defaultEntry = await resolveDefaultTheme(this, isFolder);
		
		// Cloudflare V2 guest sites use root baseURL; public URL comes from control plane
		const baseURL = '/';
		
		// Build complete configuration
		const config: Record<string, unknown> = {
			// Basic settings
			baseURL,
			title: projectName,
			contentDir: 'content',
			publishDir: 'public',
			defaultContentLanguage: 'en',
			
			// Taxonomies (default Hugo taxonomies)
			taxonomies: {
				tag: 'tags',
				category: 'categories'
			},
			
			// Theme — Foundry downloads pack.zip from module.imports[0].path at build time
			...(defaultEntry?.packUrl
				? { module: buildThemeConfigPatch(defaultEntry).module }
				: {}),

			// Markdown renderer settings
			markdown: {
				useInternalRenderer: defaultEntry?.tags
					? shouldUseInternalRenderer(defaultEntry.tags)
					: true,
			},
			
			// Site parameters
			params: {
				branding: true,
				...(defaultEntry?.packUrl ? buildThemeConfigPatch(defaultEntry).params : {}),
			},
			
			// Publish configuration
			publish: {
				method: publishMethod
			}
		};

		// Scan folder structure if this is a folder project
		if (folder && this.projectServiceManager && this.vaultBasePath) {
			try {
				const absoluteFolderPath = path.join(this.vaultBasePath, folder.path);
				
				const scanResult = await this.projectServiceManager.scanFolderStructure(absoluteFolderPath);
				
				if (scanResult && scanResult.success && scanResult.data) {
					// Generate languages configuration from scan result
					config.languages = this.generateLanguagesConfig(scanResult.data);
				} else {
					console.warn('[Friday] Folder scan failed, using default language config');
					// Fallback: default single language
					config.languages = {
						en: {
							contentDir: 'content',
							weight: 1
						}
					};
				}
			} catch (error) {
				console.error('[Friday] Error scanning folder structure:', error);
				// Fallback: default single language
				config.languages = {
					en: {
						contentDir: 'content',
						weight: 1
					}
				};
			}
		}

		return config;
	}

	/**
	 * 从文件夹路径获取 vault-relative 路径
	 */
	getVaultRelativePath(absolutePath: string): string {
		if (this.vaultBasePath) {
			// Use path.relative to get the relative path
			const relativePath = path.relative(this.vaultBasePath, absolutePath);
			
			// Convert Windows backslashes to forward slashes (Obsidian convention)
			// This ensures cross-platform compatibility
			return relativePath.replace(/\\/g, '/');
		}
		// Fallback: return the path as-is if we can't determine the base path
		return absolutePath;
	}

	/**
	 * 从路径字符串获取 TFolder 对象
	 */
	private getFolderFromPath(absolutePath: string): TFolder | null {
		const relativePath = this.getVaultRelativePath(absolutePath);
		const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
		
		if (abstractFile instanceof TFolder) {
			return abstractFile;
		}
		
		return null;
	}

	/**
	 * 从扫描结果生成 languages 配置
	 */
	private generateLanguagesConfig(scanResult: ObsidianFolderStructureInfo): Record<string, unknown> {
		const languages: Record<string, unknown> = {};

		if (scanResult.isStructured && scanResult.contentFolders.length > 0) {
			// 多语言结构：根据扫描结果生成配置
			for (const contentFolder of scanResult.contentFolders) {
				languages[contentFolder.languageCode] = {
					contentDir: this.extractContentDirName(contentFolder.path),
					weight: contentFolder.weight
				};
			}
		} else {
			// 非结构化或空文件夹：生成默认单语言配置
			languages['en'] = {
				contentDir: 'content',
				weight: 1
			};
		}

		return languages;
	}

	/**
	 * 从完整路径中提取 content 目录名
	 * 例如: /path/to/vault/myfolder/content.zh -> content.zh
	 */
	private extractContentDirName(absolutePath: string): string {
		return path.basename(absolutePath);
	}

	/**
	 * Apply existing Foundry project configuration to panel
	 * Uses new architecture: Main.ts as Controller, Site.svelte as View
	 */
	private async applyFoundryProjectToPanel(
		project: ObsidianProjectInfo,
		folder: TFolder | null,
		file: TFile | null,
		epoch?: number,
	) {
		if (!this.foundryProjectConfigService) {
			return;
		}
		const stillCurrent = () => epoch === undefined || epoch === this.selectionEpoch;

		try {
			if (!stillCurrent()) return;

			// Step 1: Set current project name FIRST before any operations
			this.currentProjectName = project.name;

			// Step 2: Load content based on project type (clear first so links can re-init)
			this.site.clearAllContent(true);
			await this.loadExistingProjectContent(project);
			if (!stillCurrent()) return;

			// First open (no publish yet): still seed content from the selection so
			// local preview works without requiring a prior publish.
			if (!this.site.hasContent() && (folder || file)) {
				this.site.replaceSelection(folder, file);
			}

			// Step 3: Get complete project configuration from Foundry
			if (!this.projectServiceManager) {
				console.error('[Friday] ProjectServiceManager not available');
				return;
			}

			const config = await this.projectServiceManager.getConfig(project.name);
			if (!stillCurrent()) return;

			// Step 4: Prepare complete ProjectState
			const projectState: ProjectState = {
				name: project.name,
				path: project.path,
				folder,
				file,
				config,
				status: 'active',
			};

			// Step 5: Call Site.svelte's initialize method (NEW ARCHITECTURE)
			if (this.siteComponent?.initialize) {
				await this.siteComponent.initialize(projectState, epoch);
			} else {
				console.error('[Friday] Site component not registered - cannot apply configuration');
			}
		} catch (error) {
			if (!stillCurrent()) return;
			console.error('[Friday] Error applying project to panel:', error);
			// Fallback: at least initialize content
			this.site.initializeContent(folder, file);
		}
	}

	/**
	 * Resolve a Foundry source path against the vault.
	 * Foundry stores absolute paths; fall back to the path as-is when needed.
	 */
	private resolveVaultAbstractFile(sourcePath: string | undefined | null): TAbstractFile | null {
		if (!sourcePath) {
			return null;
		}
		const candidates = [
			this.getVaultRelativePath(sourcePath),
			sourcePath,
		];
		for (const candidate of candidates) {
			const abstractFile = this.app.vault.getAbstractFileByPath(candidate);
			if (abstractFile) {
				return abstractFile;
			}
		}
		return null;
	}

	/**
	 * Load content from existing project's contentLinks, fileLink and staticLink
	 */
	private async loadExistingProjectContent(project: ObsidianProjectInfo) {
		let contentLoaded = false;
		
		// Load content links (for folder-based projects)
		if (project.contentLinks && project.contentLinks.length > 0) {
			for (let i = 0; i < project.contentLinks.length; i++) {
				const contentLink = project.contentLinks[i];
				const abstractFile = this.resolveVaultAbstractFile(contentLink.sourcePath);

				if (!abstractFile) {
					console.warn(`[Friday] Content path not found: ${contentLink.sourcePath}`);
					continue;
				}

				let contentFolder: TFolder | null = null;
				let contentFile: TFile | null = null;

				if (abstractFile instanceof TFolder) {
					contentFolder = abstractFile;
				} else if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
					contentFile = abstractFile;
				}

				if (i === 0) {
					// First content: initialize with language
					this.site.initializeContentWithLanguage(
						contentFolder,
						contentFile,
						contentLink.languageCode
					);
				} else {
					// Additional contents: add with language
					this.site.addLanguageContentWithCode(
						contentFolder,
						contentFile,
						contentLink.languageCode
					);
				}
			}
			contentLoaded = true;
		}
		
		// Load single file (for file-based projects)
		if (project.fileLink) {
			const abstractFile = this.resolveVaultAbstractFile(project.fileLink.sourcePath);
			
			if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				// Use project's language configuration, default to 'en' if not set
				const language = project.language || 'en';
				this.site.initializeContentWithLanguage(
					null,
					abstractFile,
					language
				);
				contentLoaded = true;
			} else if (!abstractFile) {
				console.warn(`[Friday] File path not found: ${project.fileLink.sourcePath}`);
			} else {
				console.warn(`[Friday] Invalid file type for fileLink: ${project.fileLink.sourcePath}`, abstractFile);
			}
		}
		
		// If no content was loaded, log a warning
		if (!contentLoaded) {
			console.warn('[Friday] No content links or file link found in project');
		}

		// Load static link
		if (project.staticLink) {
			const abstractFile = this.resolveVaultAbstractFile(project.staticLink.sourcePath);
			
			if (abstractFile instanceof TFolder) {
				this.site.setSiteAssets(abstractFile);
			} else {
				console.warn(`[Friday] Static assets path not found or not a folder: ${project.staticLink.sourcePath}`);
			}
		}
	}

	/**
	 * Get Foundry project config as a map
	 */
	async getFoundryProjectConfigMap(projectName: string): Promise<Record<string, unknown>> {
		if (!this.foundryProjectConfigService) {
			return {};
		}

		try {
			const result = await this.foundryProjectConfigService.list(
				this.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data.config || {};
			}
		} catch (error) {
			console.error('[Friday] Error getting project config:', error);
		}
		return {};
	}


	async setSiteAssets(folder: TFolder) {
		// Set the site assets folder
		const success = this.site.setSiteAssets(folder);
		
		if (success) {
			// Open the publish panel to show the updated assets
			const rightSplit = this.app.workspace.rightSplit;
			if (!rightSplit) {
				return;
			}
			if (rightSplit.collapsed) {
				rightSplit.expand();
			}

			// Use unified method to activate view
			await this.activateView();
		}
	}

	/**
	 * Add internet icon to markdown view header.
	 * Opens a menu with publish-to-web and add-to-list options.
	 */
	private addInternetIconToView(view: MarkdownView) {
		const viewActionsEl = view.containerEl.querySelector('.view-actions');
		if (!viewActionsEl) return;

		// Remove existing icon if present (ensures click handler is updated)
		const existingIcon = viewActionsEl.querySelector('.friday-internet-icon');
		if (existingIcon) {
			existingIcon.remove();
		}

		// Create the internet icon button
		const iconEl = createEl('a');
		iconEl.className = 'clickable-icon view-action friday-internet-icon';
		iconEl.setAttribute('aria-label', this.i18n.t('menu.publish_options'));
		setIcon(iconEl, 'globe');

		// Add click handler to show publish menu
		iconEl.addEventListener('click', (e) => {
			e.preventDefault();

			const file = view.file;
			if (!file) {
				console.warn("[Friday] No file found in view");
				return;
			}

			// Create a menu — single Publish to MDFriday entry
			const menu = new Menu();
			this.addPublishMenuItems(menu, file);
			menu.showAtMouseEvent(e);
		});

		// Insert at the beginning of view-actions (left side)
		viewActionsEl.insertBefore(iconEl, viewActionsEl.firstChild);
	}

	/**
	 * Cloudflare-only publish: open panel and trigger auto-publish.
	 */
	/**
	 * Right-click "Publish to MDFriday": open panel, apply defaults, publish immediately.
	 * Note → faithful; folder → themed + default theme. Ignores saved path config.
	 */
	private async publishToWeb(fileOrFolder: TFile | TFolder) {
		if (fileOrFolder instanceof TFile && fileOrFolder.extension !== 'md') {
			new Notice(this.i18n.t('messages.no_markdown_file'), 3000);
			return;
		}

		try {
			new Notice(this.i18n.t('messages.quick_share_starting'), 2000);

			if (this.siteComponent?.clearAllContent) {
				this.siteComponent.clearAllContent();
			}

			if (fileOrFolder instanceof TFile) {
				await this.openPublishPanel(null, fileOrFolder);
			} else {
				await this.openPublishPanel(fileOrFolder, null);
			}

			await new Promise(resolve => window.setTimeout(resolve, 500));
			await new Promise(resolve => window.setTimeout(resolve, 100));

			if (this.siteComponent?.applyDefaultsAndPublish) {
				await this.siteComponent.applyDefaultsAndPublish();
			} else if (this.siteComponent?.startPublish) {
				await this.siteComponent.startPublish();
			}
		} catch (error) {
			console.error('Publish to web failed:', error);
			new Notice(this.i18n.t('messages.quick_share_failed', { error: (error as Error).message }), 5000);
		}
	}

	/**
	 * Quick share current file — open panel and generate preview (Cloudflare path).
	 */
	private async quickShareCurrentFile(view: MarkdownView) {
		if (!Platform.isDesktop) {
			new Notice(this.i18n.t('messages.quick_share_desktop_only'));
			return;
		}

		const file = view.file;
		if (!file || file.extension !== 'md') {
			new Notice(this.i18n.t('messages.no_markdown_file'), 3000);
			return;
		}

		try {
			new Notice(this.i18n.t('messages.quick_share_starting'), 2000);

			if (this.siteComponent?.clearAllContent) {
				this.siteComponent.clearAllContent();
			}

			await this.openPublishPanel(null, file);
			await new Promise(resolve => window.setTimeout(resolve, 500));

			if (this.siteComponent?.setSitePath) {
				this.siteComponent.setSitePath('/');
			}

			await new Promise(resolve => window.setTimeout(resolve, 100));

			if (this.siteComponent?.startPreviewAndWait) {
				const previewSuccess = await this.siteComponent.startPreviewAndWait();
				if (!previewSuccess) {
					new Notice(this.i18n.t('messages.preview_failed_generic'), 5000);
					return;
				}
			}

			new Notice(this.i18n.t('messages.quick_share_ready'), 3000);
		} catch (error) {
			console.error('Quick share failed:', error);
			new Notice(this.i18n.t('messages.quick_share_failed', { error: (error as Error).message }), 5000);
		}
	}

	/**
	 * Quick publish current file — one-click Cloudflare publish.
	 */
	private async quickPublishToFree(view: MarkdownView) {
		if (!Platform.isDesktop) {
			new Notice(this.i18n.t('messages.quick_share_desktop_only'));
			return;
		}

		const file = view.file;
		if (!file || file.extension !== 'md') {
			new Notice(this.i18n.t('messages.no_markdown_file'), 3000);
			return;
		}

		await this.publishToWeb(file);
	}

	private async onVaultPathRenamed(file: TAbstractFile, oldPath: string) {
		const newPath = file.path;
		const configsChanged = migratePathConfigsOnRename(this, oldPath, newPath);
		if (configsChanged) {
			await this.saveSettings();
		}

		// Soft-update sidebar selection if it was pointing at the renamed path
		const contents = this.site?.getCurrentContents?.() ?? [];
		const current = contents[0];
		const currentPath = current?.folder?.path ?? current?.file?.path;
		if (currentPath && (pathsEqual(currentPath, oldPath) || normalizeVaultPath(currentPath)?.startsWith(normalizeVaultPath(oldPath) + '/'))) {
			if (file instanceof TFile && file.extension === 'md') {
				this.site.replaceSelection(null, file);
			} else if (file instanceof TFolder) {
				this.site.replaceSelection(file, null);
			}
		}

		const matched = await this.findLocalProjectByVaultPath(oldPath);
		// Also match projects whose path is under a renamed folder
		let projectsToRemap: ObsidianProjectInfo[] = matched ? [matched] : [];
		if (!matched && this.foundryProjectService && this.absWorkspacePath) {
			try {
				const listed = await this.foundryProjectService.listProjects(this.absWorkspacePath);
				const oldN = normalizeVaultPath(oldPath);
				projectsToRemap = (listed.data || []).filter((p) => {
					const primary = projectPrimaryVaultPath(this, p);
					return primary === oldN || (primary?.startsWith(oldN + '/') ?? false);
				});
			} catch {
				/* ignore */
			}
		}

		for (const project of projectsToRemap) {
			if (!this.foundryProjectService || !this.absWorkspacePath) break;
			const beforePrimary = projectPrimaryVaultPath(this, project);
			const remapped = await this.foundryProjectService.remapProjectSourcePaths(
				this.absWorkspacePath,
				project.name,
				(stored) => remapPathAfterRename(stored, oldPath, newPath, this),
			);
			const cfId = remapped.data?.cloudflareProjectId;
			if (cfId && this.settings.mdfKey && this.foundryPublishService) {
				const nextPrimary = beforePrimary
					? normalizeVaultPath(
							remapPathAfterRename(beforePrimary, oldPath, newPath, this),
						)
					: normalizeVaultPath(newPath);
				if (nextPrimary) {
					await this.foundryPublishService.updateRemoteProject(
						this.settings.mdfKey,
						cfId,
						{ sourcePath: nextPrimary },
					);
				}
			}
		}

		this.siteComponent?.notifyTargetsChanged?.();
	}

	private async onVaultPathDeleted(vaultPath: string) {
		if (deletePathConfigKey(this, vaultPath)) {
			await this.saveSettings();
		}
		this.siteComponent?.notifyTargetsChanged?.();
	}


	// ==================== View Management Methods ====================
	// These methods manage the Friday Service view lifecycle and ensure only one instance exists
	
	/**
	 * Initialize the Friday Service view on plugin load
	 * Called automatically during desktop features initialization
	 * Only creates the view once per plugin load session
	 */
	initLeaf(): void {
		// Only initialize once per plugin load
		if (this.viewInitialized) {
			return;
		}
		
		void this.activateView();
		this.viewInitialized = true;
	}

	/**
	 * Unified method to activate/reveal Friday Service view
	 * This should be used by all features that need to show the panel
	 * 
	 * Behavior:
	 * - If view exists: reveals the first instance
	 * - If no view exists: creates a new one in the right sidebar
	 * 
	 * @returns Promise that resolves when view is activated
	 */
	async activateView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		
		// If view exists, reveal the first one
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		
		// Create new view if none exists
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: FRIDAY_SERVER_VIEW_TYPE,
				active: true,
			});
		}
	}

	/**
	 * Check if Friday Service view is currently open
	 * @returns true if at least one view instance exists
	 */
	isViewOpen(): boolean {
		return this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length > 0;
	}

	/**
	 * Get all Friday Service view leaves
	 * Useful for advanced view management
	 * @returns Array of WorkspaceLeaf instances
	 */
	getViewLeaves() {
		return this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
	}

	onunload() {
		// Do not detach leaves — Obsidian restores leaf location; detaching resets it.
		this.viewInitialized = false;
	}

	/**
	 * Open Account in the system browser for plugin claim / upgrade.
	 * Always ensures an MDF Key first (Turnstile + guest if needed) so Free/Personal
	 * CTAs do not depend on a prior Verify & publish.
	 */
	async openAccountInBrowser(opts?: {
		intent?: 'claim' | 'upgrade';
		/** @deprecated use intent: 'upgrade' */
		upgrade?: 'personal';
	}): Promise<void> {
		const mgr = this.projectServiceManager;
		if (!mgr) return;
		const intent: 'claim' | 'upgrade' =
			opts?.intent === 'upgrade' || opts?.upgrade === 'personal' ? 'upgrade' : 'claim';
		const key =
			this.settings.mdfKey || (await mgr.ensureMdfKey({ interactive: true }));
		if (!key) return;
		const base = resolveAccountBaseUrl(this.settings);
		const q = new URLSearchParams({
			intent,
			key,
			source: 'obsidian',
		});
		if (intent === 'upgrade') {
			q.set('plan', 'personal');
			q.set('upgrade', 'personal'); // compat with older Account pages
		}
		window.open(`${base}/?${q.toString()}`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as FridaySettings;
		// Compile-time env always wins — ignore persisted cloudflareEnv / auto.
		this.settings.cloudflareEnv = DEFAULT_CLOUDFLARE_ENV;
		if (!this.settings.downloadServer) {
			this.settings.downloadServer = 'global';
		}
		if (!this.settings.pathConfigs) {
			this.settings.pathConfigs = {};
		}
		// Migrate legacy guest token → mdfKey (one-shot)
		if (!this.settings.mdfKey && this.settings.cloudflareGuestToken) {
			this.settings.mdfKey = this.settings.cloudflareGuestToken;
			this.settings.mdfKeyKind = 'guest';
			this.settings.cloudflareGuestToken = null;
			await this.saveData(this.settings);
		}
	}

	/**
	 * Apply compile-time Cloudflare env → endpoints + live Foundry client.
	 * No runtime switch; Key is never cleared by env changes.
	 */
	async applyCloudflareEnv(opts: { persist?: boolean; noticeOnSwitch?: boolean } = {}): Promise<CloudflareEnvResolved> {
		const resolved = DEFAULT_CLOUDFLARE_ENV;
		const endpoints = endpointsForEnv(resolved);

		this.settings.cloudflareEnv = resolved;
		this.settings.cloudflareResolvedEnv = resolved;
		this.settings.cloudflareApiBaseUrl = endpoints.apiBaseUrl;
		this.settings.cloudflarePublicBaseUrl = endpoints.publicBaseUrl;
		this.settings.cloudflareAccountBaseUrl = endpoints.accountBaseUrl;
		this.cloudflareEnvEpoch += 1;

		if (Platform.isDesktop && this.themeApiService) {
			this.themeApiService.clearCache();
		}

		this.foundryPublishService?.applyCloudflareEndpoints({
			apiBaseUrl: endpoints.apiBaseUrl,
			publicBaseUrl: endpoints.publicBaseUrl,
		});

		if (opts.persist !== false) {
			await this.saveData(this.settings);
		}
		return resolved;
	}

	/**
	 * Open hosted Turnstile challenge and wait for deep link token.
	 * Local env returns null (API skips Turnstile).
	 */
	async requestTurnstileToken(timeoutMs = 120_000): Promise<string | null> {
		const resolved = this.settings.cloudflareResolvedEnv || 'staging';
		const challengeUrl = endpointsForEnv(resolved).guestChallengeUrl;
		if (!challengeUrl) return null;

		if (this.turnstileWaiter) {
			this.turnstileWaiter.reject(new Error('Turnstile challenge superseded'));
			window.clearTimeout(this.turnstileWaiter.timer);
			this.turnstileWaiter = null;
		}

		new Notice('Complete the security check in your browser…', 6000);
		window.open(challengeUrl, '_blank');

		return new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.turnstileWaiter = null;
				reject(new Error('Turnstile challenge timed out — open Account / try again'));
			}, timeoutMs);
			this.turnstileWaiter = { resolve, reject, timer };
		});
	}

	resolveTurnstileToken(token: string): void {
		if (!this.turnstileWaiter) {
			new Notice('Received turnstile token (no pending challenge). Try publish again.', 4000);
			return;
		}
		window.clearTimeout(this.turnstileWaiter.timer);
		const { resolve } = this.turnstileWaiter;
		this.turnstileWaiter = null;
		resolve(token);
		new Notice('Security check OK — continuing…', 3000);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		if (Platform.isDesktop && this.foundryGlobalConfigService && this.absWorkspacePath) {
			await this.saveSettingsToFoundryGlobalConfig();
		}
	}
	
	private async saveSettingsToFoundryGlobalConfig() {
		if (!this.foundryGlobalConfigService || !this.absWorkspacePath) {
			return;
		}
		
		try {
			const config = this.foundryGlobalConfigService;
			const workspace = this.absWorkspacePath;

			await config.set(workspace, 'site.downloadServer', this.settings.downloadServer);
			await config.set(workspace, 'publish.method', 'cloudflare');
		} catch (error) {
			console.error('[Friday] Error saving settings to Global Config:', error);
		}
	}

	private async loadSettingsFromFoundryGlobalConfig() {
		if (!this.foundryGlobalConfigService || !this.absWorkspacePath) {
			return;
		}
		
		try {
			const config = this.foundryGlobalConfigService;
			const workspace = this.absWorkspacePath;
			const listResult = await config.list(workspace);
			
			if (!listResult.success || !listResult.data?.config) {
				return;
			}
			
			const foundryConfig = listResult.data.config as Record<string, unknown>;
			const siteConfig = foundryConfig['site'];
			const downloadServer =
				siteConfig &&
				typeof siteConfig === 'object' &&
				'downloadServer' in siteConfig
					? (siteConfig as { downloadServer?: unknown }).downloadServer
					: undefined;
			if (downloadServer === 'global' || downloadServer === 'east') {
				this.settings.downloadServer = downloadServer;
			}
		} catch (error) {
			console.error('[Friday] Error loading settings from Global Config:', error);
		}
	}

	async status(text: string) {
		this.statusBar.setText(text)
	}
	
}

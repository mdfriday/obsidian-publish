import {FileSystemAdapter, MarkdownView, Menu, Notice, Platform, Plugin, setIcon, TFile, TFolder} from 'obsidian';
import {I18nService} from "./i18n";
import {FridaySettingTab} from "./setting";
// Foundry PC 专用服务类型
import type {
	ObsidianBuildService,
	ObsidianDomainService,
	ObsidianProjectInfo,
	ObsidianProjectService,
	ObsidianPublishService,
	ObsidianServeService,
} from '@mdfriday/foundry';
// Mobile 专用配置类型
import type {ObsidianEnvironmentConfig as ObsidianMobileEnvironmentConfig,} from '@mdfriday/foundry/obsidian/mobile';
import {createObsidianHttpClient, createObsidianIdentityHttpClient} from './http';
import {LicenseServiceManager} from './services/license';
import {DomainServiceManager} from './services/domain';
import {LicenseStateManager} from './services/licenseState';
import {ProjectServiceManager} from './services/project';
import type {ProjectState, SiteEventData, SiteEventType} from './types/events';
import {normalizePublishMethod} from './types/publish';
import {getDefaultTheme, shouldUseInternalRenderer} from './utils/theme';
import {joinPath, joinVaultPath} from './utils/common';

// PC-only module types (dynamically imported)
import type {Hugoverse} from "./hugoverse";
import type {Site} from "./site";
import type {ThemeSelectionModal} from "./theme/modal";
import type {FoundryProjectManagementModal} from "./projects/foundryModal";

// Export view type for dynamic import
export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';

interface FridaySettings {
	downloadServer: 'global' | 'east';
	cloudflareGuestToken: string | null;
	/** User JWT from mdfriday.com Google OAuth (Free+) */
	cloudflareUserToken: string | null;
	cloudflareApiBaseUrl: string;
	cloudflarePublicBaseUrl: string;
	/** Account site for OAuth / paste-token bridge (default mdfriday.com Studio callback host) */
	cloudflareAccountBaseUrl: string;
}

const DEFAULT_SETTINGS: FridaySettings = {
	downloadServer: 'global',
	cloudflareGuestToken: null,
	cloudflareUserToken: null,
	cloudflareApiBaseUrl: 'https://api.fsky.top',
	cloudflarePublicBaseUrl: 'https://share.fsky.top',
	cloudflareAccountBaseUrl: 'https://mdfriday.com/account',
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
	workspaceService?: any // Foundry service, type inferred at runtime
	// Foundry services
	foundryProjectService?: ObsidianProjectService | null
	foundryBuildService?: ObsidianBuildService | null
	foundryGlobalConfigService?: any // Type inferred at runtime
	foundryProjectConfigService?: any // Type inferred at runtime
	foundryServeService?: ObsidianServeService | null
	foundryPublishService?: ObsidianPublishService | null
	foundryAuthService?: any // Type inferred at runtime
	foundryLicenseService?: any // Type inferred at runtime
	foundryDomainService?: ObsidianDomainService | null
	licenseServiceManager?: LicenseServiceManager | null
	domainServiceManager?: DomainServiceManager | null
	projectServiceManager?: ProjectServiceManager | null
	// License state manager (unified license state from Foundry)
	licenseState?: LicenseStateManager | null
	// Current project name for tracking
	currentProjectName?: string | null
	
	// Site.svelte component reference (for new event-driven architecture)
	siteComponent?: any | null
	
	// Project initialization flag (prevents auto-save during new project creation)
	isProjectInitializing: boolean = false
	
	// PC-only state
	private previousDownloadServer: 'global' | 'east' = 'global'
	
	// View management state
	private viewInitialized: boolean = false
	
	// Dynamic module references for PC-only features
	private ThemeSelectionModalClass?: typeof ThemeSelectionModal
	private FoundryProjectManagementModalClass?: typeof FoundryProjectManagementModal
	private themeApiService?: typeof import("./theme/themeApiService").themeApiService

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		
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
		// Dynamically import PC-only modules
		// Note: Hugoverse is already initialized in initCore for license operations
		const [
			{ default: ServerView },
			{ ThemeSelectionModal },
			{ FoundryProjectManagementModal },
			{ Site },
			{ themeApiService },
		] = await Promise.all([
			import('./server'),
			import('./theme/modal'),
			import('./projects/foundryModal'),
			import('./site'),
			import('./theme/themeApiService'),
		]);
		
		// Import PC-only styles
		await Promise.all([
			import('./styles/theme-modal.css'),
			import('./styles/publish-settings.css'),
			import('./styles/project-modal.css'),
		]);
		
		// Store dynamic module references
		this.ThemeSelectionModalClass = ThemeSelectionModal;
		this.FoundryProjectManagementModalClass = FoundryProjectManagementModal;
		this.themeApiService = themeApiService;
		
		// Initialize PC-only services (hugoverse already initialized in initCore)
		this.site = new Site(this);

		// Initialize workspace service (PC-only)
		await this.initializeWorkspace();
		
		// Register view with protection against duplicate registration
		try {
			this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this));
		} catch (e) {
			console.error('[Friday] View already registered, skipping');
		}
		
		this.app.workspace.onLayoutReady(() => this.initLeaf());
		
		// Add ribbon icon for project management
		this.addRibbonIcon(FRIDAY_ICON, this.i18n.t('projects.manage_projects'), async () => {
			// Use new Foundry-based project management modal
			if (this.FoundryProjectManagementModalClass) {
				const modal = new this.FoundryProjectManagementModalClass(this.app, this);
				modal.open();
			}
		});
		
		// Add internet icon to markdown view header
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.addInternetIconToView(leaf.view);
				}
			})
		);
		
		// Also add to currently active view on load
		this.app.workspace.onLayoutReady(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				this.addInternetIconToView(activeView);
			}
		});
		
		// Register open project management command (PC-only)
		this.addCommand({
			id: "open-project-management",
			name: this.i18n.t('projects.manage_projects'),
			callback: () => {
				if (this.FoundryProjectManagementModalClass) {
					const modal = new this.FoundryProjectManagementModalClass(this.app, this);
					modal.open();
				}
			}
		});
		
		// Register context menu for files and folders (PC-only)
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					this.addToPublishListMenuItem(menu, file);
					// Add site assets menu item
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.set_as_site_assets'))
							.setIcon('folder-plus')
							.onClick(async () => {
								await this.setSiteAssets(file);
							});
					});
					
					menu.addSeparator();
					this.addPublishMenuItems(menu, file);

				} else if (file instanceof TFile && file.extension === 'md') {
					this.addToPublishListMenuItem(menu, file);
					menu.addSeparator();
					this.addPublishMenuItems(menu, file);
				}
			})
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
	 * Helper method to add "Add to Publish List" menu item for file or folder
	 */
	private addToPublishListMenuItem(menu: Menu, fileOrFolder: TFile | TFolder) {
		menu.addItem(item => {
			item
				.setTitle(this.i18n.t('menu.add_to_publish_list'))
				.setIcon(FRIDAY_ICON)
				.onClick(async () => {
					if (this.siteComponent?.clearAllContent) {
						this.siteComponent.clearAllContent();
					}

					if (fileOrFolder instanceof TFile) {
						await this.openPublishPanel(null, fileOrFolder);
					} else {
						await this.openPublishPanel(fileOrFolder, null);
					}
				});
		});
	}

	/**
	 * Single Cloudflare publish entry in file/folder menus.
	 */
	private addPublishMenuItems(menu: Menu, fileOrFolder: TFile | TFolder) {
		menu.addItem(item => {
			item
				.setTitle(this.i18n.t('menu.publish_to_web'))
				.setIcon('globe')
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
		
		// Create Identity HTTP client for Auth, License, and Domain services
		const identityHttpClient = createObsidianIdentityHttpClient();
		this.foundryAuthService = createObsidianAuthService(identityHttpClient);
		this.foundryLicenseService = createObsidianLicenseService(identityHttpClient);
		this.foundryDomainService = createObsidianDomainService(identityHttpClient);
		
		// Create License Service Manager
		if (this.foundryLicenseService && this.foundryAuthService && this.foundryGlobalConfigService) {
			this.licenseServiceManager = new LicenseServiceManager(
				this.foundryLicenseService,
				this.foundryAuthService,
				this.foundryGlobalConfigService,
				this.absWorkspacePath
			);
		}
		
	// Create Domain Service Manager
	if (this.foundryDomainService) {
		this.domainServiceManager = new DomainServiceManager(
			this.foundryDomainService,
			this.absWorkspacePath
		);
	}

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
		if (this.foundryLicenseService && this.foundryAuthService && this.foundryGlobalConfigService) {
			this.licenseServiceManager = new LicenseServiceManager(
				this.foundryLicenseService,
				this.foundryAuthService,
				this.foundryGlobalConfigService,
				this.absWorkspacePath
			);
		}
		
		// 注意：不创建 DomainServiceManager（Mobile 不需要）
		// 注意：不创建 ProjectServiceManager（Mobile 不需要）
		
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
		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit) {
			return;
		}
		if (rightSplit.collapsed) {
			rightSplit.expand();
		}

		// Get project name from folder/file
		const projectName = this.getProjectNameFromSelection(folder, file);
		if (!projectName) {
			console.warn('Unable to determine project name');
			return;
		}

		// Check if project already exists
		const existingProject = await this.getFoundryProject(projectName);
		
		if (existingProject) {
			// Project exists, load its configuration and apply to panel
			await this.applyFoundryProjectToPanel(existingProject, folder, file);
		} else {
			// Project doesn't exist, create it first
			const created = await this.createFoundryProject(projectName, folder, file);
			
			if (created) {
				// After creation, get the project and apply to panel (same flow as existing project)
				const newProject = await this.getFoundryProject(projectName);
				if (newProject) {
					this.isProjectInitializing = true; // Set flag to prevent auto-saving during initialization
					await this.applyFoundryProjectToPanel(newProject, folder, file);
					this.isProjectInitializing = false; // Reset flag after initialization
				} else {
					console.error('[Friday] Failed to retrieve newly created project');
				}
			}
		}

		// Open or reveal the publish panel using unified method
		await this.activateView();
	}

	/**
	 * Get project name from folder or file selection
	 */
	private getProjectNameFromSelection(folder: TFolder | null, file: TFile | null): string | null {
		if (folder) {
			// Use folder name as project name
			return folder.name;
		} else if (file) {
			// Use file name (without extension) as project name
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
	registerSiteComponent(component: any) {
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
		const onProgress = (progress: any) => {
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

		const onProgress = (progress: any) => {
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
				this.siteComponent?.onPublishError?.(result.error || 'Publish failed');
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

		const onProgress = (progress: any) => {
			if (progress.phase === 'building' || progress.phase === 'build-success') {
				this.siteComponent?.updateBuildProgress?.(progress);
			} else {
				this.siteComponent?.updatePublishProgress?.(progress);
			}
		};

		const result = await this.projectServiceManager.buildAndPublishCloudflare(
			data.projectName,
			{ onProgress },
		);

		if (result.success) {
			this.siteComponent?.onPublishComplete?.(result);
			if (result.baseURL && this.siteComponent?.setSitePath) {
				this.siteComponent.setSitePath(result.baseURL);
			}
		} else {
			this.siteComponent?.onPublishError?.(result.error || 'Publish failed');
		}
	}

	private async onPublishRequested(data: SiteEventData['publishRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		const { projectName, method, config } = data;

		// Create progress callback
		const onProgress = (progress: any) => {
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
			this.siteComponent?.onPublishError?.(result.error);
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
	private async collectInitialConfig(projectName: string, folder: TFolder | null, file: TFile | null): Promise<Record<string, any>> {
		const publishMethod = normalizePublishMethod();
		
		// Determine if this is a folder project
		const isFolder = folder !== null;
		
		// Get default theme based on project type
		const defaultTheme = getDefaultTheme(isFolder);
		
		// Cloudflare V2 guest sites use root baseURL; public URL comes from control plane
		const baseURL = '/';
		
		// Build complete configuration
		const config: Record<string, any> = {
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
			
			// Theme configuration
			module: {
				imports: [
					{
						path: defaultTheme.downloadUrl
					}
				]
			},
			
			// Markdown renderer settings
			markdown: {
				useInternalRenderer: shouldUseInternalRenderer(defaultTheme.tags)
			},
			
			// Site parameters
			params: {
				branding: true
			},
			
			// Publish configuration
			publish: {
				method: publishMethod
			}
		};

		// Scan folder structure if this is a folder project
		if (folder && this.projectServiceManager && this.vaultBasePath) {
			try {
				const path = require('path');
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
	 * 从文件夹路径获取 TFolder 对象
	 */
	private getVaultRelativePath(absolutePath: string): string {
		if (this.vaultBasePath) {
			// Use path.relative to get the relative path
			const path = require('path');
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
	private generateLanguagesConfig(scanResult: any): Record<string, any> {
		const languages: Record<string, any> = {};

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
		const path = require('path');
		return path.basename(absolutePath);
	}

	/**
	 * Apply existing Foundry project configuration to panel
	 * Uses new architecture: Main.ts as Controller, Site.svelte as View
	 */
	private async applyFoundryProjectToPanel(project: ObsidianProjectInfo, folder: TFolder | null, file: TFile | null) {
		if (!this.foundryProjectConfigService) {
			return;
		}

		try {
			// Step 1: Set current project name FIRST before any operations
			this.currentProjectName = project.name;
			
			// Step 2: Load content based on project type
			await this.loadExistingProjectContent(project);
			
			// Step 3: Get complete project configuration from Foundry
			if (!this.projectServiceManager) {
				console.error('[Friday] ProjectServiceManager not available');
				return;
			}
			
			const config = await this.projectServiceManager.getConfig(project.name);
			
			// Step 4: Prepare complete ProjectState
			const projectState: ProjectState = {
				name: project.name,
				path: project.path,
				folder,
				file,
				config,
				status: 'active'
			};
			
			// Step 5: Call Site.svelte's initialize method (NEW ARCHITECTURE)
			if (this.siteComponent?.initialize) {
				await this.siteComponent.initialize(projectState);
			} else {
				console.error('[Friday] Site component not registered - cannot apply configuration');
			}
		} catch (error) {
			console.error('[Friday] Error applying project to panel:', error);
			// Fallback: at least initialize content
			this.site.initializeContent(folder, file);
		}
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
				const relativePath = this.getVaultRelativePath(contentLink.sourcePath);
				
				const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);

				if (!abstractFile) {
					console.warn(`[Friday] Content path not found: ${contentLink.sourcePath} (relative: ${relativePath})`);
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
			const relativePath = this.getVaultRelativePath(project.fileLink.sourcePath);
			
			const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
			
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
				console.warn(`[Friday] File path not found: ${project.fileLink.sourcePath} (relative: ${relativePath})`);
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
			const relativePath = this.getVaultRelativePath(project.staticLink.sourcePath);
			const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
			
			if (abstractFile instanceof TFolder) {
				this.site.setSiteAssets(abstractFile);
			} else {
				console.warn(`[Friday] Static assets path not found or not a folder: ${project.staticLink.sourcePath} (relative: ${relativePath})`);
			}
		}
	}

	/**
	 * Get Foundry project config as a map
	 */
	async getFoundryProjectConfigMap(projectName: string): Promise<Record<string, any>> {
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

	showThemeSelectionModal(selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void, isForSingleFile: boolean = false) {
		const modal = new this.ThemeSelectionModalClass(this.app, selectedTheme, onSelect, this, isForSingleFile);
		modal.open();
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
		const iconEl = document.createElement('a');
		iconEl.className = 'clickable-icon view-action friday-internet-icon';
		iconEl.setAttribute('aria-label', this.i18n.t('menu.publish_options'));
		setIcon(iconEl, 'globe');

		// Add click handler to show publish menu
		iconEl.addEventListener('click', async (e) => {
			e.preventDefault();
			
			const file = view.file;
			if (!file) {
				console.warn("[Friday] No file found in view");
				return;
			}
			
			// Create a menu
			const menu = new Menu();
			
			this.addToPublishListMenuItem(menu, file);
			
			menu.addSeparator();
			
			// Add all publish options using helper method
			this.addPublishMenuItems(menu, file);
			
			// Show the menu at the cursor position
			menu.showAtMouseEvent(e as MouseEvent);
		});

		// Insert at the beginning of view-actions (left side)
		viewActionsEl.insertBefore(iconEl, viewActionsEl.firstChild);
	}

	/**
	 * Cloudflare-only publish: open panel and trigger auto-publish.
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

			await new Promise(resolve => setTimeout(resolve, 500));

			await new Promise(resolve => setTimeout(resolve, 100));

			if (this.siteComponent?.startPublish) {
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
			await new Promise(resolve => setTimeout(resolve, 500));

			if (this.siteComponent?.setSitePath) {
				this.siteComponent.setSitePath('/');
			}

			await new Promise(resolve => setTimeout(resolve, 100));

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
		
		this.activateView();
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

	async onunload() {
		// Clean up Friday Service views
		this.app.workspace.detachLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		
		// Reset view initialization state
		this.viewInitialized = false;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.previousDownloadServer = this.settings.downloadServer;
	}

	async saveSettings() {
		const downloadServerChanged = this.previousDownloadServer !== this.settings.downloadServer;

		await this.saveData(this.settings);
		
		if (Platform.isDesktop && this.foundryGlobalConfigService && this.absWorkspacePath) {
			await this.saveSettingsToFoundryGlobalConfig();
		}
		
		if (downloadServerChanged && Platform.isDesktop && this.themeApiService) {
			this.themeApiService.clearCache();
			this.previousDownloadServer = this.settings.downloadServer;
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
			
			const foundryConfig = listResult.data.config;
			const downloadServer = foundryConfig['site']?.downloadServer;
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

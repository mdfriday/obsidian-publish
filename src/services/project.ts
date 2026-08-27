import type FridayPlugin from '../main';
import {Notice, requestUrl} from 'obsidian';
import type {TFile, TFolder} from 'obsidian';
import type {ProgressUpdate, PublishProgressUpdate} from '../types/events';
import {joinPath} from '../utils/common';

/** Share mode baseURL per arch/03-build-contract.md */
export function computeShareBaseUrl(publicBaseUrl: string, siteId: string): string {
	const base = (publicBaseUrl || 'https://share.fsky.top').replace(/\/$/, '');
	return `${base}/s/${siteId}/`;
}

/**
 * Project Service Manager
 * 
 * 统一管理项目相关的所有 Foundry 服务
 * 提供高层次的业务接口，隐藏 Foundry 服务细节
 */
export class ProjectServiceManager {
	private plugin: FridayPlugin;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
	}

	// ==================== 项目管理 ====================

	/**
	 * 创建新项目
	 */
	async createProject(options: {
		name: string;
		folder: TFolder | null;
		file: TFile | null;
		initialConfig?: Record<string, any>;
	}): Promise<ProjectResult> {
		const { name, folder, file, initialConfig } = options;

		try {
			// 准备创建选项
			const basePath = this.plugin.vaultBasePath;
			if (!basePath) {
				return { success: false, error: 'Vault base path not available' };
			}

			const createOptions: any = {
				name,
				workspacePath: this.plugin.absWorkspacePath,
			};

		if (folder && !file) {
			// Create from folder
			createOptions.sourceFolder = joinPath(basePath, folder.path);
		} else if (file) {
			// Create from single file
			createOptions.sourceFile = joinPath(basePath, file.path);
		}

			// 调用 Foundry 创建项目
			const result = await this.plugin.foundryProjectService.createProject(createOptions);

			if (!result.success) {
				return { success: false, error: result.error };
			}

			// 应用初始配置（如果有）
			if (initialConfig) {
				const configResult = await this.plugin.foundryProjectConfigService.setAll(
					this.plugin.absWorkspacePath,
					name,
					initialConfig
				);

				if (!configResult.success) {
					console.warn('[ProjectServiceManager] Failed to apply initial config:', configResult.error);
				}
			}

			return {
				success: true,
				data: {
					name,
					folder,
					file
				}
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error creating project:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 获取所有项目
	 */
	async listProjects(): Promise<ProjectInfo[]> {
		try {
			const result = await this.plugin.foundryProjectService.listProjects(
				this.plugin.absWorkspacePath
			);

			if (result.success && result.data) {
				return result.data;
			}

			return [];
		} catch (error) {
			console.error('[ProjectServiceManager] Error listing projects:', error);
			return [];
		}
	}

	/**
	 * 获取项目信息
	 */
	async getProjectInfo(projectName: string): Promise<ProjectInfo | null> {
		try {
			const result = await this.plugin.foundryProjectService.getProjectInfo(
				this.plugin.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data;
			}

			return null;
		} catch (error) {
			console.error('[ProjectServiceManager] Error getting project info:', error);
			return null;
		}
	}

	/**
	 * 扫描文件夹结构
	 */
	async scanFolderStructure(folderPath: string): Promise<FolderStructureResult | null> {
		try {
			const result = await this.plugin.foundryProjectService.scanFolderStructure(folderPath);

			if (result.success && result.data) {
				return {
					success: true,
					data: result.data
				};
			}

			return {
				success: false,
				error: result.error
			};
		} catch (error) {
			console.error('[ProjectServiceManager] Error scanning folder structure:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	// ==================== 配置管理 ====================

	/**
	 * 获取项目配置
	 */
	async getConfig(projectName: string): Promise<Record<string, any>> {
		try {
			const result = await this.plugin.foundryProjectConfigService.list(
				this.plugin.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data.config;
			}

			return {};
		} catch (error) {
			console.error('[ProjectServiceManager] Error getting config:', error);
			return {};
		}
	}

	/**
	 * 保存单个配置项
	 */
	async saveConfig(
		projectName: string,
		key: string,
		value: any
	): Promise<boolean> {
		try {
			const result = await this.plugin.foundryProjectConfigService.set(
				this.plugin.absWorkspacePath,
				projectName,
				key,
				value
			);

			if (!result.success) {
				console.error(`[ProjectServiceManager] Failed to save config ${key}:`, result.error);
			}

			return result.success;
		} catch (error) {
			console.error('[ProjectServiceManager] Error saving config:', error);
			return false;
		}
	}

	/**
	 * 保存完整配置
	 */
	async saveAllConfig(
		projectName: string,
		config: Record<string, any>
	): Promise<boolean> {
		try {
			const result = await this.plugin.foundryProjectConfigService.setAll(
				this.plugin.absWorkspacePath,
				projectName,
				config
			);

			if (!result.success) {
				console.error('[ProjectServiceManager] Failed to save all config:', result.error);
			}

			return result.success;
		} catch (error) {
			console.error('[ProjectServiceManager] Error saving all config:', error);
			return false;
		}
	}

	// ==================== Cloudflare MDF Key + share baseURL ====================

	/**
	 * Ensure we have an MDF_… Key (create guest if needed).
	 * Staging/prod: open hosted Turnstile challenge → deep link token → guest.
	 */
	async ensureMdfKey(): Promise<string | null> {
		await this.plugin.applyCloudflareEnv({ persist: true });

		if (this.plugin.settings.mdfKey) {
			return this.plugin.settings.mdfKey;
		}
		const foundry = this.plugin.foundryPublishService;
		if (!foundry) return null;

		let turnstileToken: string | undefined;
		const resolved = this.plugin.settings.cloudflareResolvedEnv || 'local';
		if (resolved !== 'local') {
			try {
				const token = await this.plugin.requestTurnstileToken();
				if (!token) {
					new Notice('Turnstile required but no challenge URL configured', 5000);
					return null;
				}
				turnstileToken = token;
			} catch (e) {
				new Notice((e as Error).message || 'Turnstile failed', 5000);
				return null;
			}
		}

		const guest = await foundry.guest(
			turnstileToken ? { turnstileToken } : undefined,
		);
		const key = guest.key || guest.token;
		if (!guest.success || !key) {
			new Notice(guest.error || 'Could not create guest Key', 5000);
			return null;
		}

		this.plugin.settings.mdfKey = key;
		this.plugin.settings.mdfKeyKind = 'guest';
		this.plugin.settings.mdfKeyPlan = 'guest';
		if (typeof guest.contentExpiresAt === 'number') {
			this.plugin.settings.mdfContentExpiresAt = guest.contentExpiresAt;
		}
		await this.plugin.saveSettings();
		foundry.setKey(key, 'guest');
		return key;
	}

	/**
	 * Prefer persisted MDF Key (guest or user after claim).
	 */
	async resolveAuthToken(): Promise<{ token: string; kind: 'user' | 'guest' } | null> {
		const key = await this.ensureMdfKey();
		if (!key) return null;
		const kind = this.plugin.settings.mdfKeyKind === 'user' ? 'user' : 'guest';
		return { token: key, kind };
	}

	async refreshCloudflareAccount(): Promise<{
		success: boolean;
		kind?: string;
		plan?: string;
		error?: string;
	}> {
		const key = this.plugin.settings.mdfKey;
		if (!key) {
			return { success: false, error: 'No MDF Key' };
		}

		const apiBase = (this.plugin.settings.cloudflareApiBaseUrl || '').replace(/\/$/, '');
		if (!apiBase) {
			return { success: false, error: 'API base URL missing' };
		}

		// Prefer direct Account API (settings UI) — avoids depending on Foundry VO mapping.
		try {
			const res = await requestUrl({
				url: `${apiBase}/v1/account`,
				method: 'GET',
				headers: { Authorization: `Bearer ${key}` },
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) {
				const errBody = typeof res.json === 'object' && res.json ? res.json : null;
				const msg =
					(errBody as { error?: { message?: string } })?.error?.message ||
					`HTTP ${res.status}`;
				return { success: false, error: msg };
			}
			const account = (res.json || JSON.parse(res.text || '{}')) as {
				kind?: string;
				plan?: string;
				storageBytes?: number;
				contentExpiresAt?: number | null;
				projectCount?: number;
				quota?: {
					storageBytes?: number;
					maxProjects?: number | null;
					retentionDays?: number | null;
				};
			};
			if (!account.kind || !account.plan) {
				return { success: false, error: 'account response missing kind/plan' };
			}

			this.plugin.settings.mdfKeyKind = account.kind === 'user' ? 'user' : 'guest';
			this.plugin.settings.mdfKeyPlan = account.plan;
			this.plugin.settings.mdfStorageBytes =
				typeof account.storageBytes === 'number' ? account.storageBytes : 0;
			this.plugin.settings.mdfQuotaStorageBytes =
				typeof account.quota?.storageBytes === 'number'
					? account.quota.storageBytes
					: null;
			this.plugin.settings.mdfContentExpiresAt =
				typeof account.contentExpiresAt === 'number' ? account.contentExpiresAt : null;
			this.plugin.settings.mdfProjectCount =
				typeof account.projectCount === 'number' ? account.projectCount : 0;
			this.plugin.settings.mdfQuotaMaxProjects =
				account.quota?.maxProjects === null
					? null
					: typeof account.quota?.maxProjects === 'number'
						? account.quota.maxProjects
						: null;
			this.plugin.settings.mdfQuotaRetentionDays =
				account.quota?.retentionDays === null
					? null
					: typeof account.quota?.retentionDays === 'number'
						? account.quota.retentionDays
						: null;

			const foundry = this.plugin.foundryPublishService;
			if (foundry) {
				foundry.setKey(key, account.kind === 'user' ? 'user' : 'guest');
			}
			await this.plugin.saveSettings();
			return { success: true, kind: account.kind, plan: account.plan };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	}

	/** @deprecated JWT paste path removed — Account claim is on mdfriday.com */
	async loginWithUserToken(_userJwt: string): Promise<{ success: boolean; error?: string; plan?: string }> {
		return {
			success: false,
			error: 'Use Account login (opens mdfriday.com). Plugin only stores MDF Key.',
		};
	}

	async logoutCloudflareUser(): Promise<void> {
		this.plugin.settings.mdfKeyKind = this.plugin.settings.mdfKey ? 'guest' : null;
		this.plugin.settings.mdfKeyPlan = this.plugin.settings.mdfKey ? 'guest' : null;
		await this.plugin.saveSettings();
	}

	/**
	 * Bind remote project and persist share-mode baseURL before build.
	 * arch/03: share baseURL = https://share…/s/{siteId}/
	 */
	async ensureShareBaseUrl(
		projectName: string,
	): Promise<{ siteId: string; baseURL: string } | { error: string }> {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry) {
			return { error: 'Publish service not initialized' };
		}

		const auth = await this.resolveAuthToken();
		if (!auth) {
			return { error: 'Failed to create guest session' };
		}

		const publicBaseUrl =
			this.plugin.settings.cloudflarePublicBaseUrl || 'https://share.fsky.top';

		const binding = await foundry.ensureCloudflareBinding({
			workspacePath: this.plugin.absWorkspacePath,
			projectName,
			authToken: auth.token,
			hostingMode: 'share',
			apiBaseUrl: this.plugin.settings.cloudflareApiBaseUrl,
			publicBaseUrl,
		});

		if (!binding.success) {
			return { error: binding.error || 'Failed to bind Cloudflare project' };
		}
		if (!binding.siteId) {
			return { error: 'Cloudflare project has no siteId yet' };
		}

		const baseURL = computeShareBaseUrl(publicBaseUrl, binding.siteId);
		const saved = await this.saveConfig(projectName, 'baseURL', baseURL);
		if (!saved) {
			console.warn('[ProjectServiceManager] Failed to persist baseURL');
		}

		return { siteId: binding.siteId, baseURL };
	}

	/**
	 * One-shot Cloudflare publish: bind → set baseURL → build → upload.
	 */
	async buildAndPublishCloudflare(
		projectName: string,
		options: {
			onProgress?: (progress: ProgressUpdate | PublishProgressUpdate) => void;
		} = {},
	): Promise<PublishResult & { baseURL?: string; siteId?: string }> {
		const { onProgress } = options;

		const ensured = await this.ensureShareBaseUrl(projectName);
		if ('error' in ensured) {
			return { success: false, error: ensured.error };
		}

		onProgress?.({
			phase: 'building',
			percentage: 0,
			message: 'Building site…',
		} as ProgressUpdate);

		const buildResult = await this.build(projectName, (progress) => {
			onProgress?.(progress);
		});

		if (!buildResult.success) {
			return { success: false, error: buildResult.error || 'Build failed' };
		}

		const publishResult = await this.publish(projectName, {
			method: 'cloudflare',
			onProgress: (progress) => onProgress?.(progress),
		});

		if (!publishResult.success) {
			return publishResult;
		}

		return {
			...publishResult,
			baseURL: ensured.baseURL,
			siteId: ensured.siteId,
		};
	}

	// ==================== 构建和预览 ====================

	/**
	 * 构建项目
	 */
	async build(
		projectName: string,
		onProgress?: (progress: ProgressUpdate) => void
	): Promise<BuildResult> {
		try {
			const result = await this.plugin.foundryBuildService.buildProject({
				workspacePath: this.plugin.absWorkspacePath,
				projectNameOrPath: projectName,
				onProgress,
			});

			return {
				success: result.success,
				error: result.error,
				outputPath: result.data?.outputDir
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error building project:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 启动预览服务器
	 */
	async startPreview(
		projectName: string,
		options: {
			port: number;
			renderer?: any;
			onProgress?: (progress: ProgressUpdate) => void;
			publishConfig?: {
				method?: 'cloudflare';
				config?: unknown;
				delay?: number;
			};
		}
	): Promise<PreviewResult> {
		try {
		const { port, renderer, onProgress, publishConfig } = options;

		// Cloudflare publish runs after local preview (not via Serve autoPublish)
		const useCloudflare = !!publishConfig;
		const servePublishConfig = undefined;

		if (useCloudflare) {
			const ensured = await this.ensureShareBaseUrl(projectName);
			if ('error' in ensured) {
				return { success: false, error: ensured.error };
			}
		}

		const result = await this.plugin.foundryServeService.startServer(
			{
				workspacePath: this.plugin.absWorkspacePath,
				projectName,
				port,
				markdown: renderer,
				publishConfig: servePublishConfig
			},
			onProgress
		);

			if (result.success && result.data) {
				let cloudflarePublishUrl: string | undefined;

				if (useCloudflare) {
					const publishResult = await this.publish(projectName, {
						method: 'cloudflare',
						config: publishConfig?.config,
						onProgress: (progress) => {
							onProgress?.({
								phase: 'publishing',
								percentage: progress.percentage ?? 0,
								message: progress.message,
								...(progress.currentFile ? { currentFile: progress.currentFile } : {}),
							} as ProgressUpdate);
						},
					});

					if (!publishResult.success) {
						return {
							success: false,
							error: publishResult.error || 'Cloudflare publish failed',
						};
					}

					cloudflarePublishUrl = publishResult.url;

					onProgress?.({
						phase: 'publish-success',
						percentage: 100,
						message: 'Published to Cloudflare successfully',
						data: {
							publishUrl: publishResult.url,
							method: 'cloudflare',
						},
					} as ProgressUpdate);
				}

				// Get project info to retrieve the path
				const projectInfo = await this.getProjectInfo(projectName);
				
				return {
					success: true,
					url: result.data.url,
					port: result.data.port,
					path: projectInfo?.path,
					...(cloudflarePublishUrl ? { publishUrl: cloudflarePublishUrl } : {}),
				};
			}

			return {
				success: false,
				error: result.error
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error starting preview:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 停止预览服务器
	 */
	async stopPreview(projectName: string): Promise<boolean> {
		try {
			return await this.plugin.foundryServeService.stopServer();
		} catch (error) {
			console.error('[ProjectServiceManager] Error stopping preview:', error);
			return false;
		}
	}

	// ==================== 发布 ====================

	/**
	 * 发布项目 — 仅通过 Foundry ObsidianPublishService（auth → bind → R2）。
	 * 插件不直接请求 Cloudflare API。
	 *
	 * Interface：持久化 guest / user JWT；调用 foundry.guest / loginWithToken / publishCloudflare。
	 */
	async publish(
		projectName: string,
		options: {
			method?: string;
			config?: unknown;
			onProgress?: (progress: PublishProgressUpdate) => void;
		}
	): Promise<PublishResult> {
		try {
			const { onProgress } = options;
			const foundry = this.plugin.foundryPublishService;
			if (!foundry) {
				return { success: false, error: 'Publish service not initialized' };
			}

			const auth = await this.resolveAuthToken();
			if (!auth) {
				return {
					success: false,
					error: 'Failed to obtain auth token',
				};
			}

			const result = await foundry.publishCloudflare(
				{
					workspacePath: this.plugin.absWorkspacePath,
					projectName,
					authToken: auth.token,
					guest: auth.kind === 'guest',
					apiBaseUrl: this.plugin.settings.cloudflareApiBaseUrl,
					publicBaseUrl: this.plugin.settings.cloudflarePublicBaseUrl,
					hostingMode: 'share',
				},
				onProgress as unknown as Parameters<typeof foundry.publishCloudflare>[1],
			);

			if (result.success && result.data) {
				return { success: true, url: result.data.url };
			}

			return {
				success: false,
				error: result.error || result.message || 'Publish failed',
			};
		} catch (error) {
			console.error('[ProjectServiceManager] Error publishing project:', error);
			return {
				success: false,
				error: (error as Error).message,
			};
		}
	}

	/**
	 * 测试连接
	 */
	async testConnection(
		projectName: string,
		config: any
	): Promise<ConnectionResult> {
		try {
			const result = await this.plugin.foundryPublishService.testConnection(
				this.plugin.absWorkspacePath,
				projectName,
				config
			);

			return {
				success: result.success,
				message: result.error,
				error: result.error
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error testing connection:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}
}

// ==================== 类型定义 ====================

export interface ProjectResult {
	success: boolean;
	error?: string;
	data?: {
		name: string;
		folder: TFolder | null;
		file: TFile | null;
	};
}

export interface ProjectInfo {
	name: string;
	path: string;
	createdAt?: number | string;
	updatedAt?: number | string;
}

export interface BuildResult {
	success: boolean;
	error?: string;
	outputPath?: string;
}

export interface PreviewResult {
	success: boolean;
	error?: string;
	url?: string;
	port?: number;
	path?: string;
	publishUrl?: string;
}

export interface PublishResult {
	success: boolean;
	error?: string;
	url?: string;
}

export interface ConnectionResult {
	success: boolean;
	error?: string;
	message?: string;
}

export interface FolderStructureResult {
	success: boolean;
	error?: string;
	data?: {
		rootPath: string;
		isStructured: boolean;
		contentFolders: Array<{
			path: string;
			languageCode: string;
			weight: number;
		}>;
		staticFolder?: {
			path: string;
		};
		isValid: boolean;
		isMultilingual: boolean;
		supportedLanguages: string[];
		defaultLanguage?: string;
		summary: string;
	};
}

import type FridayPlugin from '../main';
import type {TFile, TFolder} from 'obsidian';
import type {ProgressUpdate, PublishProgressUpdate} from '../types/events';
import {joinPath} from '../utils/common';

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
					path: projectInfo?.path // Add preview directory path
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
	 * 发布项目 — 仅通过 Foundry ObsidianPublishService（guest → bind → R2）。
	 * 插件不直接请求 Cloudflare API。
	 *
	 * Interface 职责（arch/12 §6）：持久化 guest token；调用 foundry.guest / publishCloudflare。
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

			// Persist guest token at Interface layer (settings). Binding + R2 stay inside Foundry.
			let token = this.plugin.settings.cloudflareGuestToken;
			if (!token) {
				const guest = await foundry.guest();
				if (!guest.success || !guest.token) {
					return {
						success: false,
						error: guest.error || 'Failed to create guest session',
					};
				}
				token = guest.token;
				this.plugin.settings.cloudflareGuestToken = token;
				await this.plugin.saveSettings();
			}

			const result = await foundry.publishCloudflare(
				{
					workspacePath: this.plugin.absWorkspacePath,
					projectName,
					authToken: token,
					guest: false,
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
	path?: string; // Preview directory absolute path
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

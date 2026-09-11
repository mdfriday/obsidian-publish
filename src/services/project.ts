import type FridayPlugin from '../main';
import {Notice, requestUrl, TFile} from 'obsidian';
import type {TFolder} from 'obsidian';
import type {ObsidianProjectCreateOptions} from '@mdfriday/foundry';
import type {ProgressUpdate, PublishProgressUpdate} from '../types/events';
import {joinPath} from '../utils/common';
import type {CatalogEntry} from '../theme/types';
import {themeApiService} from '../theme/themeApiService';
import {
	buildUserStaticMap,
	listVaultStaticFiles,
	mergeMdfridayParams,
} from '../theme/user-static-sync';
import { CLOUDFLARE_ENV_PRESETS } from '../cloudflare-env';
import * as fs from 'fs';
import * as path from 'path';
import {
	collectNoteMediaFiles,
	markProjectFileLinkSkipSync,
	NOTE_MEDIA_STATIC_PREFIX,
	rewriteNoteSourceForStagedMedia,
	stageNoteMediaToStatic,
	writeRewrittenNoteContent,
} from '../media/note-media';

/** Share mode baseURL per arch/03-build-contract.md */
export function computeShareBaseUrl(publicBaseUrl: string, siteId: string): string {
	const base = (publicBaseUrl || CLOUDFLARE_ENV_PRESETS.staging.publicBaseUrl).replace(
		/\/$/,
		'',
	);
	return `${base}/s/${siteId}/`;
}

/**
 * Custom domain Hugo baseURL — root-relative per arch/03-build-contract.md.
 * Hostname is used only for the public access URL, not baked into asset paths.
 */
export function computeCustomBaseUrl(_hostname?: string): string {
	return '/';
}

/** Absolute site URL shown after publish (custom hosting). */
export function computeCustomPublicUrl(hostname: string): string {
	const host = hostname.replace(/^https?:\/\//, '').replace(/\/$/, '');
	return `https://${host}/`;
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
		initialConfig?: Record<string, unknown>;
	}): Promise<ProjectResult> {
		const { name, folder, file, initialConfig } = options;

		try {
			// 准备创建选项
			const basePath = this.plugin.vaultBasePath;
			if (!basePath) {
				return { success: false, error: 'Vault base path not available' };
			}

			const createOptions: ObsidianProjectCreateOptions = {
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
	async getConfig(projectName: string): Promise<Record<string, unknown>> {
		try {
			const result = await this.plugin.foundryProjectConfigService.list(
				this.plugin.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return (result.data.config ?? {}) as Record<string, unknown>;
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
		value: unknown
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
	 * Themed single-note: copy referenced vault media into project static/media/
	 * and rewrite content/index.md so Foundry SSG can resolve local images.
	 *
	 * Folder projects are skipped. When the content target was a symlink it is
	 * materialized (watch-on-vault is not preserved for this path — by design for now).
	 */
	async prepareThemedSingleNoteMedia(projectName: string): Promise<void> {
		try {
			const result = await this.plugin.foundryProjectService.getProjectInfo(
				this.plugin.absWorkspacePath,
				projectName,
			);
			if (!result.success || !result.data?.fileLink) {
				return;
			}

			const { path: projectPath, fileLink } = result.data;
			const note = this.resolveFileLinkNote(fileLink.sourcePath);
			if (!note) {
				return;
			}

			const staticDir = path.join(projectPath, 'static');
			const mediaRoot = path.join(staticDir, NOTE_MEDIA_STATIC_PREFIX);
			const files = await collectNoteMediaFiles(this.plugin, note);

			if (files.length === 0) {
				await fs.promises.rm(mediaRoot, { recursive: true, force: true });
				// Restore pristine vault text when a previous run materialized content.
				try {
					const st = await fs.promises.lstat(fileLink.targetPath);
					if (!st.isSymbolicLink()) {
						const source = await this.plugin.app.vault.read(note);
						await fs.promises.writeFile(fileLink.targetPath, source, 'utf8');
					}
				} catch {
					// ignore restore failures
				}
				return;
			}

			const staged = await stageNoteMediaToStatic(this.plugin, files, staticDir);
			const source = await this.plugin.app.vault.read(note);
			const rewritten = rewriteNoteSourceForStagedMedia(
				this.plugin,
				note,
				source,
				staged,
			);

			await writeRewrittenNoteContent(fileLink.targetPath, rewritten);
			// Prevent Foundry copyFile sync from clobbering rewritten content.
			await markProjectFileLinkSkipSync(projectPath);
		} catch (error) {
			console.warn('[ProjectServiceManager] prepareThemedSingleNoteMedia failed:', error);
		}
	}

	private resolveFileLinkNote(sourcePath: string): TFile | null {
		const candidates = [
			this.plugin.getVaultRelativePath(sourcePath),
			sourcePath,
		];
		for (const candidate of candidates) {
			const abs = this.plugin.app.vault.getAbstractFileByPath(candidate);
			if (abs instanceof TFile && abs.extension === 'md') {
				return abs;
			}
		}
		return null;
	}

	/**
	 * Scan project static/ and write params.mdfriday.userStatic before build.
	 */
	async syncUserStaticConfig(
		projectName: string,
		catalogEntry?: CatalogEntry | null,
	): Promise<void> {
		let entry = catalogEntry ?? null;
		const config = await this.getConfig(projectName);
		const paramsRaw = config.params;
		const paramsObj =
			paramsRaw && typeof paramsRaw === 'object'
				? (paramsRaw as Record<string, unknown>)
				: {};
		const mdfriday =
			paramsObj.mdfriday && typeof paramsObj.mdfriday === 'object'
				? (paramsObj.mdfriday as Record<string, unknown>)
				: undefined;

		if (!entry && mdfriday?.family && mdfriday?.variant) {
			entry = await themeApiService.findByFamilyVariant(
				String(mdfriday.family),
				String(mdfriday.variant),
				this.plugin,
			);
		}

		if (!entry?.userAssets?.length) {
			return;
		}

		const infoResult = await this.plugin.foundryProjectService.getProjectInfo(
			this.plugin.absWorkspacePath,
			projectName,
		);
		const staticLink = infoResult.success ? infoResult.data?.staticLink : undefined;

		let userStatic: Record<string, true> = {};
		if (staticLink?.sourcePath) {
			const rel = this.plugin.getVaultRelativePath(staticLink.sourcePath);
			const files = await listVaultStaticFiles(this.plugin.app, rel);
			userStatic = buildUserStaticMap(files, entry.userAssets);
		}

		const params = {
			...paramsObj,
			mdfriday: mergeMdfridayParams(mdfriday, { userStatic }),
		};
		await this.saveConfig(projectName, 'params', params);
	}

	/**
	 * 保存完整配置
	 */
	async saveAllConfig(
		projectName: string,
		config: Record<string, unknown>
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
	 * Whether a publish key already exists locally.
	 */
	hasMdfKey(): boolean {
		return !!this.plugin.settings.mdfKey;
	}

	/** Staging/prod guest flow needs Turnstile; local skips it. */
	needsTurnstileForGuest(): boolean {
		return (this.plugin.settings.cloudflareResolvedEnv || 'local') !== 'local';
	}

	/**
	 * Ensure we have an MDF_… Key.
	 * @param interactive false = do not open browser / create guest (Quick Publish pre-step)
	 */
	async ensureMdfKey(opts?: { interactive?: boolean }): Promise<string | null> {
		const foundry = this.plugin.foundryPublishService;
		if (this.plugin.settings.mdfKey) {
			foundry?.applyCloudflareEndpoints({
				apiBaseUrl: this.plugin.settings.cloudflareApiBaseUrl,
				publicBaseUrl: this.plugin.settings.cloudflarePublicBaseUrl,
			});
			return this.plugin.settings.mdfKey;
		}
		if (opts?.interactive === false) {
			return null;
		}
		return this.requestGuestKey();
	}

	/**
	 * Create guest MDF Key (Turnstile on staging/prod). Call after user confirms in-panel.
	 */
	async requestGuestKey(): Promise<string | null> {
		const foundry = this.plugin.foundryPublishService;
		await this.plugin.applyCloudflareEnv({ persist: true });

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
		const key = guest.key || (guest as { token?: string }).token;
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
		this.plugin.settings.mdfProjectCount = this.plugin.settings.mdfProjectCount ?? 0;
		this.plugin.settings.mdfQuotaMaxProjects = this.plugin.settings.mdfQuotaMaxProjects ?? 1;
		this.plugin.settings.mdfStorageBytes = this.plugin.settings.mdfStorageBytes ?? 0;
		this.plugin.settings.mdfQuotaStorageBytes =
			this.plugin.settings.mdfQuotaStorageBytes ?? 5 * 1024 * 1024;
		await this.plugin.saveSettings();
		foundry.setKey(key, 'guest');
		void this.refreshCloudflareAccount();
		return key;
	}

	/**
	 * Prefer persisted MDF Key (guest or user after claim).
	 */
	async resolveAuthToken(): Promise<{ token: string; kind: 'user' | 'guest' } | null> {
		const key = await this.ensureMdfKey({ interactive: false });
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
				const errBody: unknown = typeof res.json === 'object' && res.json ? res.json : null;
				const msg =
					(errBody as { error?: { message?: string } } | null)?.error?.message ||
					`HTTP ${res.status}`;
				return { success: false, error: msg };
			}
			const account = (
				(typeof res.json === 'object' && res.json) ||
				(JSON.parse(res.text || '{}') as unknown)
			) as {
				kind?: string;
				plan?: string;
				email?: string | null;
				storageBytes?: number;
				contentExpiresAt?: number | null;
				projectCount?: number;
				quota?: {
					storageBytes?: number;
					maxProjects?: number | null;
					retentionDays?: number | null;
					maxCustomDomains?: number;
					features?: string[];
				};
			};
			if (!account.kind || !account.plan) {
				return { success: false, error: 'account response missing kind/plan' };
			}

			this.plugin.settings.mdfKeyKind = account.kind === 'user' ? 'user' : 'guest';
			this.plugin.settings.mdfKeyPlan = account.plan;
			this.plugin.settings.mdfAccountEmail =
				typeof account.email === 'string' && account.email.trim()
					? account.email.trim()
					: null;
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
			this.plugin.settings.mdfQuotaMaxCustomDomains =
				typeof account.quota?.maxCustomDomains === 'number'
					? account.quota.maxCustomDomains
					: null;
			this.plugin.settings.mdfQuotaFeatures = Array.isArray(account.quota?.features)
				? account.quota.features
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
	 * Local quota gate before creating a new remote project.
	 * Avoids a guaranteed 402 round-trip when the plan is already at max sites.
	 */
	async assertCanCreateRemoteProject(): Promise<
		{ ok: true } | { ok: false; error: string; code: 'quota_exceeded' }
	> {
		await this.refreshCloudflareAccount();
		const used = this.plugin.settings.mdfProjectCount ?? 0;
		const max = this.plugin.settings.mdfQuotaMaxProjects;
		const plan = (this.plugin.settings.mdfKeyPlan || 'guest').toLowerCase();
		const effectiveMax =
			max === null
				? null
				: typeof max === 'number'
					? max
					: plan === 'guest'
						? 1
						: plan === 'free'
							? 3
							: null;
		if (effectiveMax != null && used >= effectiveMax) {
			return {
				ok: false,
				code: 'quota_exceeded',
				error:
					plan === 'guest'
						? 'Guest allows only 1 site — limit reached. Sign up free to unlock 3 sites.'
						: plan === 'free'
							? 'Free allows 3 sites — limit reached. Upgrade to Personal for unlimited sites.'
							: `Site limit reached (${used}/${effectiveMax}).`,
			};
		}
		return { ok: true };
	}

	/**
	 * Bind remote project and persist publish baseURL before build.
	 * share → https://share…/s/{siteId}/
	 * custom → `/` (root-relative) + publicUrl https://{hostname}/
	 */
	async ensureShareBaseUrl(
		projectName: string,
	): Promise<
		| {
				siteId: string;
				baseURL: string;
				hostingMode: 'share' | 'custom';
				publicUrl: string;
		  }
		| { error: string; code?: string }
	> {
		const foundry = this.plugin.foundryPublishService;
		if (!foundry) {
			return { error: 'Publish service not initialized' };
		}

		const auth = await this.resolveAuthToken();
		if (!auth) {
			return { error: 'Publish key required — complete verification in the panel first' };
		}

		const publicBaseUrl =
			this.plugin.settings.cloudflarePublicBaseUrl ||
				CLOUDFLARE_ENV_PRESETS.staging.publicBaseUrl;

		// New remote project only — republish of an already-bound site must not be blocked.
		const existing = await foundry.getCloudflareBinding({
			workspacePath: this.plugin.absWorkspacePath,
			projectName,
		});
		if (!existing.success || !existing.cloudflareProjectId) {
			const gate = await this.assertCanCreateRemoteProject();
			if (gate.ok === false) {
				const failure: { error: string; code: 'quota_exceeded' } = {
					error: gate.error,
					code: gate.code,
				};
				return failure;
			}
		}

		const identity = this.publishIdentityFromSelection();
		const binding = await foundry.ensureCloudflareBinding({
			workspacePath: this.plugin.absWorkspacePath,
			projectName,
			authToken: auth.token,
			hostingMode: 'share',
			apiBaseUrl: this.plugin.settings.cloudflareApiBaseUrl,
			publicBaseUrl,
			...(identity.sourcePath ? { sourcePath: identity.sourcePath } : {}),
			...(identity.kind ? { kind: identity.kind } : {}),
			...(identity.title ? { title: identity.title } : {}),
		});

		if (!binding.success) {
			return {
				error: binding.error || 'Failed to bind Cloudflare project',
				...(binding.code ? { code: binding.code } : {}),
			};
		}
		if (!binding.siteId && binding.hostingMode !== 'custom') {
			return { error: 'Cloudflare project has no siteId yet' };
		}

		let hostingMode: 'share' | 'custom' = binding.hostingMode === 'custom' ? 'custom' : 'share';
		let baseURL =
			binding.siteId != null
				? computeShareBaseUrl(publicBaseUrl, binding.siteId)
				: '';
		let publicUrl = baseURL ? `${baseURL.replace(/\/$/, '')}/index.html` : '';

		// Prefer live domain state over local binding (activation may have flipped remote only)
		if (binding.cloudflareProjectId) {
			const domains = await foundry.listDomains(auth.token, binding.cloudflareProjectId);
			const active = domains.domains?.find(
				(d) => d.status === 'active' || d.certStatus === 'active',
			);
			if (active?.hostname) {
				hostingMode = 'custom';
				baseURL = computeCustomBaseUrl(active.hostname);
				publicUrl = computeCustomPublicUrl(active.hostname);
				if (binding.hostingMode !== 'custom') {
					await foundry.markBindingCustom({
						workspacePath: this.plugin.absWorkspacePath,
						projectName,
						hostname: active.hostname,
					});
				}
			} else if (hostingMode === 'custom' && binding.siteId) {
				// Remote says custom but no active domain — fall back to share paths
				hostingMode = 'share';
				baseURL = computeShareBaseUrl(publicBaseUrl, binding.siteId);
				publicUrl = `${baseURL.replace(/\/$/, '')}/index.html`;
			}
		}

		if (!baseURL) {
			return { error: 'Could not resolve publish baseURL' };
		}

		const saved = await this.saveConfig(projectName, 'baseURL', baseURL);
		if (!saved) {
			console.warn('[ProjectServiceManager] Failed to persist baseURL');
		}

		return {
			siteId: binding.siteId || '',
			baseURL,
			hostingMode,
			publicUrl,
		};
	}

	async listRemoteCloudflareProjects(): Promise<{
		success: boolean;
		projects?: Array<{
			id: string;
			siteId?: string;
			title?: string;
			kind?: string;
			hostingMode?: string;
			status?: string;
			expiresAt?: number | null;
			domainHostname?: string;
			domainStatus?: string;
			domainCertStatus?: string;
			sourcePath?: string | null;
			publicUrl?: string;
		}>;
		error?: string;
	}> {
		const auth = await this.resolveAuthToken();
		if (!auth) return { success: false, error: 'No MDF Key' };

		const apiBase = (this.plugin.settings.cloudflareApiBaseUrl || '').replace(/\/$/, '');
		if (!apiBase) {
			return { success: false, error: 'API base URL missing — set Cloudflare environment in Settings' };
		}

		const url = `${apiBase}/v1/projects`;
		try {
			// Direct requestUrl (same as Account refresh) — clearer DNS/network errors than Foundry path
			const res = await requestUrl({
				url,
				method: 'GET',
				headers: { Authorization: `Bearer ${auth.token}` },
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) {
				const errBody: unknown = typeof res.json === 'object' && res.json ? res.json : null;
				const msg =
					(errBody as { error?: { message?: string } } | null)?.error?.message ||
					`HTTP ${res.status}`;
				return { success: false, error: `${msg} (${url})` };
			}
			const parsed: unknown =
				(typeof res.json === 'object' && res.json) ||
				JSON.parse(res.text || '{}');
			const body = parsed as {
				projects?: Array<Record<string, unknown>>;
			};
			const projects = (body.projects || []).map((p) => {
				const hostingMode = (p.hostingMode ?? p.hosting_mode) as string | undefined;
				const siteId = (p.siteId ?? p.site_id) as string | undefined;
				const expiresAt = (p.expiresAt ?? p.expires_at) as number | null | undefined;
				const domainHostname = (p.domainHostname ?? p.domain_hostname) as string | undefined;
				const domainStatus = (p.domainStatus ?? p.domain_status) as string | undefined;
				const domainCertStatus = (p.domainCertStatus ?? p.domain_cert_status) as
					| string
					| undefined;
				const sourcePath = (p.sourcePath ?? p.source_path) as string | null | undefined;
				const publicUrl = (p.publicUrl ?? p.public_url) as string | undefined;
				return {
					id: String(p.id || ''),
					...(siteId ? { siteId } : {}),
					...(typeof p.title === 'string' ? { title: p.title } : {}),
					...(typeof p.kind === 'string' ? { kind: p.kind } : {}),
					...(hostingMode === 'share' || hostingMode === 'custom'
						? { hostingMode }
						: {}),
					...(typeof p.status === 'string' ? { status: p.status } : {}),
					...(expiresAt !== undefined ? { expiresAt: expiresAt } : {}),
					...(domainHostname ? { domainHostname } : {}),
					...(domainStatus ? { domainStatus } : {}),
					...(domainCertStatus ? { domainCertStatus } : {}),
					...(sourcePath !== undefined ? { sourcePath: sourcePath } : {}),
					...(typeof publicUrl === 'string' ? { publicUrl } : {}),
				};
			});
			return { success: true, projects };
		} catch (e) {
			const raw = e instanceof Error ? e.message : String(e);
			const hint = /NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(raw)
				? ` DNS failed for ${apiBase}. Check Cloudflare environment (Staging vs Local) and that api.fsky.top resolves.`
				: '';
			return { success: false, error: `${raw} (${url})${hint}` };
		}
	}

	/**
	 * One-shot Cloudflare publish: bind → set baseURL → build → upload.
	 * Pass skipBuild=true when public/ was already filled (faithful build).
	 */
	async buildAndPublishCloudflare(
		projectName: string,
		options: {
			onProgress?: (progress: ProgressUpdate | PublishProgressUpdate) => void;
			/** Skip Foundry SSG — public/ already written (PublishMode=faithful) */
			skipBuild?: boolean;
		} = {},
	): Promise<PublishResult & { baseURL?: string; siteId?: string }> {
		const { onProgress, skipBuild = false } = options;

		const ensured = await this.ensureShareBaseUrl(projectName);
		if ('error' in ensured) {
			return {
				success: false,
				error: ensured.error,
				...(ensured.code ? { code: ensured.code } : {}),
			};
		}

		if (skipBuild) {
			onProgress?.({
				phase: 'building',
				percentage: 100,
				message: 'Faithful package ready',
			});
		} else {
			onProgress?.({
				phase: 'building',
				percentage: 0,
				message: 'Building site…',
			});

			const buildResult = await this.build(projectName, (progress) => {
				onProgress?.(progress);
			});

			if (!buildResult.success) {
				return { success: false, error: buildResult.error || 'Build failed' };
			}
		}

		const publishResult = await this.publish(projectName, {
			method: 'cloudflare',
			hostingMode: ensured.hostingMode,
			onProgress: (progress) => onProgress?.(progress),
			...this.publishIdentityFromSelection(),
		});

		if (!publishResult.success) {
			return publishResult;
		}

		const rawUrl = publishResult.url || '';
		const url =
			!rawUrl || /\(custom-domain\)/i.test(rawUrl) ? ensured.publicUrl : rawUrl;

		return {
			...publishResult,
			url,
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
			await this.prepareThemedSingleNoteMedia(projectName);
			await this.syncUserStaticConfig(projectName);
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
			renderer?: unknown;
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

		if (useCloudflare) {
			const ensured = await this.ensureShareBaseUrl(projectName);
			if ('error' in ensured) {
				return {
					success: false,
					error: ensured.error,
					...(ensured.code ? { code: ensured.code } : {}),
				};
			}
		}

		await this.prepareThemedSingleNoteMedia(projectName);

		const result = await this.plugin.foundryServeService.startServer(
			{
				workspacePath: this.plugin.absWorkspacePath,
				projectName,
				port,
				...(renderer !== undefined ? { markdown: renderer as never } : {}),
			},
			onProgress
		);

			if (result.success && result.data) {
				let cloudflarePublishUrl: string | undefined;

				if (useCloudflare) {
					const publishResult = await this.publish(projectName, {
						method: 'cloudflare',
						config: publishConfig?.config,
						...this.publishIdentityFromSelection(),
						onProgress: (progress) => {
							onProgress?.({
								phase: 'publishing',
								percentage: progress.percentage ?? 0,
								message: progress.message,
								...(progress.currentFile ? { currentFile: progress.currentFile } : {}),
							});
						},
					});

					if (!publishResult.success) {
						return {
							success: false,
							error: publishResult.error || 'Cloudflare publish failed',
							...(publishResult.code ? { code: publishResult.code } : {}),
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
					});
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
			hostingMode?: 'share' | 'custom';
			sourcePath?: string;
			kind?: 'note' | 'folder';
			title?: string;
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
					hostingMode: options.hostingMode ?? 'share',
					// Custom: empty release prefix needs full tree until server copyFrom exists
					force: options.hostingMode === 'custom',
					...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
					...(options.kind ? { kind: options.kind } : {}),
					...(options.title ? { title: options.title } : {}),
				},
				onProgress,
			);

			if (result.success && result.data) {
				return { success: true, url: result.data.url };
			}

			return {
				success: false,
				error: result.error || result.message || 'Publish failed',
				...(result.code ? { code: result.code } : {}),
			};
		} catch (error) {
			console.error('[ProjectServiceManager] Error publishing project:', error);
			return {
				success: false,
				error: (error as Error).message,
			};
		}
	}

	/** Vault path + kind for remote project identity (source_path). */
	private publishIdentityFromSelection(): {
		sourcePath?: string;
		kind?: 'note' | 'folder';
		title?: string;
	} {
		const contents = this.plugin.site?.getCurrentContents?.() ?? [];
		const first = contents[0];
		if (!first) return {};
		if (first.folder) {
			return {
				sourcePath: first.folder.path,
				kind: 'folder',
				title: first.folder.name,
			};
		}
		if (first.file) {
			return {
				sourcePath: first.file.path,
				kind: 'note',
				title: first.file.basename,
			};
		}
		return {};
	}

	/**
	 * 测试连接
	 */
	async testConnection(
		projectName: string,
		config: unknown
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
	code?: string;
	url?: string;
	port?: number;
	path?: string;
	publishUrl?: string;
}

export interface PublishResult {
	success: boolean;
	error?: string;
	url?: string;
	/** Control-plane error code (e.g. quota_exceeded) */
	code?: string;
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

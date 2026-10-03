/**
 * Subscribe capability — Obsidian side: owner API calls, publish-time sync, export to the vault.
 * Pure logic lives in ./subscribe-core (unit-tested).
 */
import { Notice, requestUrl, SuggestModal, TFile, normalizePath, type App } from 'obsidian';
import type FridayPlugin from '../main';
import { withMdfridayClientHeader } from '../mdfriday-client';
import { resolveApiBaseUrl, resolveSiteBaseUrl } from '../cloudflare-env';
import {
	applyPatchOutcome,
	buildCsv,
	buildMarkdown,
	chooseExportFolder,
	exportFilePath,
	fetchAllSubscribers,
	pickerLabel,
	planPublishSubscribe,
	siteSlugFor,
	subscribeEndpoint,
	type AudienceProject,
	type AudienceSummary,
	type MarkdownLabels,
	type PatchOutcome,
	type SubscribersPage,
	type VaultIndex,
} from './subscribe-core';

export type ExportFormat = 'csv' | 'md';

export interface AudienceStatus {
	projectId: string;
	subscribeEnabled: boolean;
	subscriberCount: number;
}

export interface AudienceListItem extends AudienceProject {
	subscriberCount?: number;
	subscribeEnabled?: boolean;
}

function tr(plugin: FridayPlugin, key: string, params?: Record<string, string | number>): string {
	return plugin.i18n?.t?.(key, params) ?? key;
}

function apiBase(plugin: FridayPlugin): string {
	return resolveApiBaseUrl(plugin.settings);
}

async function userToken(plugin: FridayPlugin): Promise<{ token: string; kind: 'user' | 'guest' } | null> {
	const mgr = plugin.projectServiceManager;
	if (!mgr) return null;
	return mgr.resolveAuthToken();
}

async function apiJson(
	plugin: FridayPlugin,
	token: string,
	method: 'GET' | 'PATCH',
	path: string,
	body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
	const url = `${apiBase(plugin)}${path}`;
	const res = await requestUrl({
		url,
		method,
		headers: withMdfridayClientHeader(url, {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
		}),
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		throw: false,
	});
	let json: Record<string, unknown> | null = null;
	try {
		json = (typeof res.json === 'object' && res.json ? res.json : JSON.parse(res.text || 'null')) as
			| Record<string, unknown>
			| null;
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

function errorCode(json: Record<string, unknown> | null): string {
	const e = json?.error as { code?: string } | string | undefined;
	return typeof e === 'string' ? e : e?.code ?? '';
}

export function dashboardAudienceUrl(plugin: FridayPlugin, projectId: string): string {
	return `${resolveSiteBaseUrl(plugin.settings).replace(/\/$/, '')}/dashboard/audience/?id=${encodeURIComponent(projectId)}`;
}

/** Remote project id bound to a local Foundry project (null before the first publish). */
export async function boundProjectId(plugin: FridayPlugin, projectName: string): Promise<string | null> {
	const foundry = plugin.foundryPublishService;
	if (!foundry || !projectName) return null;
	try {
		const bind = await foundry.getCloudflareBinding({ workspacePath: plugin.absWorkspacePath, projectName });
		return bind.success && bind.cloudflareProjectId ? bind.cloudflareProjectId : null;
	} catch {
		return null;
	}
}

/** Count + server flag for the status line. Guests / unbound → null. */
export async function getAudienceStatus(plugin: FridayPlugin, projectName: string): Promise<AudienceStatus | null> {
	const projectId = await boundProjectId(plugin, projectName);
	if (!projectId) return null;
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') return null;
	try {
		const r = await apiJson(plugin, auth.token, 'GET', `/v1/projects/${encodeURIComponent(projectId)}`);
		if (r.status !== 200 || !r.json) return null;
		const p = (r.json.project ?? r.json) as Record<string, unknown>;
		return {
			projectId,
			subscribeEnabled: p.subscribeEnabled === true,
			subscriberCount: Number(p.subscriberCount ?? 0) || 0,
		};
	} catch {
		return null;
	}
}

export async function patchSubscribeEnabled(
	plugin: FridayPlugin,
	token: string,
	projectId: string,
	enabled: boolean,
): Promise<PatchOutcome> {
	try {
		const r = await apiJson(plugin, token, 'PATCH', `/v1/projects/${encodeURIComponent(projectId)}`, {
			subscribeEnabled: enabled,
		});
		if (r.status >= 200 && r.status < 300) return 'ok';
		if (r.status === 402 || r.status === 403 || errorCode(r.json) === 'plan_required') return 'plan_required';
		return 'error';
	} catch {
		return 'error';
	}
}

/**
 * Publish step (called from ensureShareBaseUrl once the remote project is bound, before the build):
 * stamp params.subscribe.project/endpoint and PATCH subscribeEnabled only when it changed.
 * Never throws; failures are a non-blocking Notice and retried on the next publish.
 */
export async function syncSubscribeOnPublish(
	plugin: FridayPlugin,
	ctx: {
		projectName: string;
		projectId: string;
		auth: { token: string; kind: 'user' | 'guest' };
		getConfig: (projectName: string) => Promise<Record<string, unknown>>;
		saveConfig: (projectName: string, key: string, value: unknown) => Promise<boolean>;
	},
): Promise<void> {
	try {
		const config = await ctx.getConfig(ctx.projectName);
		const params = (config.params && typeof config.params === 'object' ? config.params : {}) as Record<string, unknown>;
		const plan = planPublishSubscribe(params.subscribe, {
			projectId: ctx.projectId,
			endpoint: subscribeEndpoint(apiBase(plugin)),
			guest: ctx.auth.kind === 'guest',
		});
		if (!plan.params) return;
		let next = plan.params;
		if (plan.patch !== null) {
			const outcome = await patchSubscribeEnabled(plugin, ctx.auth.token, ctx.projectId, plan.patch);
			next = applyPatchOutcome(next, plan.patch, outcome);
			if (outcome === 'plan_required') new Notice(tr(plugin, 'ui.subscribe_plan_required'));
			else if (outcome === 'error') new Notice(tr(plugin, 'ui.subscribe_sync_failed'));
		}
		await ctx.saveConfig(ctx.projectName, 'params', { ...params, subscribe: next });
	} catch (e) {
		console.warn('[subscribe] publish sync failed', e);
	}
}

// ---------------------------------------------------------------- export

export async function listAudienceProjects(plugin: FridayPlugin): Promise<AudienceListItem[]> {
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') return [];
	const r = await apiJson(plugin, auth.token, 'GET', '/v1/projects?include=deleted_audience');
	if (r.status !== 200 || !r.json) throw new Error(`HTTP ${r.status}`);
	const rows = (r.json.projects ?? []) as Array<Record<string, unknown>>;
	return rows
		.map((p) => ({
			id: String(p.id ?? ''),
			siteId: typeof (p.siteId ?? p.site_id) === 'string' ? String(p.siteId ?? p.site_id) : undefined,
			title: typeof p.title === 'string' ? p.title : null,
			publicUrl: typeof p.publicUrl === 'string' ? p.publicUrl : null,
			sourcePath: typeof (p.sourcePath ?? p.source_path) === 'string' ? String(p.sourcePath ?? p.source_path) : null,
			status: typeof p.status === 'string' ? p.status : undefined,
			deletedAt: typeof p.deletedAt === 'string' ? p.deletedAt : null,
			purgeAt: typeof p.purgeAt === 'string' ? p.purgeAt : null,
			subscriberCount: typeof p.subscriberCount === 'number' ? p.subscriberCount : undefined,
			subscribeEnabled: p.subscribeEnabled === true,
		}))
		.filter((p) => p.id);
}

function vaultIndex(app: App): VaultIndex {
	return {
		files: app.vault.getMarkdownFiles().map((f) => f.path),
		linkpathDest: (lp, from) => app.metadataCache.getFirstLinkpathDest(lp, from)?.path ?? null,
	};
}

function mdLabels(plugin: FridayPlugin): Partial<MarkdownLabels> {
	const k = (s: string) => tr(plugin, `ui.subscribe_md_${s}`);
	return {
		heading: k('heading'), notice: k('notice'), summary: k('summary'), total: k('total'),
		last7: k('last7'), last30: k('last30'), topArticle: k('top_article'), deleted: k('deleted'),
		list: k('list'), colEmail: k('col_email'), colDate: k('col_date'), colArticle: k('col_article'),
		colReferrer: k('col_referrer'), empty: k('empty'),
	};
}

async function listExisting(app: App, folder: string): Promise<Set<string>> {
	try {
		if (!(await app.vault.adapter.exists(folder))) return new Set();
		const l = await app.vault.adapter.list(folder);
		return new Set(l.files.map((f) => normalizePath(f)));
	} catch {
		return new Set();
	}
}

/**
 * Fetch every subscriber of `projectId` and write CSV or Markdown into the vault.
 * `localSourcePath` (current selection) is used when the API has no sourcePath.
 */
export async function exportSubscribers(
	plugin: FridayPlugin,
	opts: { projectId: string; format: ExportFormat; localSourcePath?: string | null },
): Promise<{ path: string; count: number } | null> {
	const app = plugin.app;
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') {
		new Notice(tr(plugin, 'ui.subscribe_guest_hint'));
		return null;
	}
	const progress = new Notice(tr(plugin, 'ui.subscribe_export_loading', { count: 0 }), 0);
	try {
		const base = `/v1/projects/${encodeURIComponent(opts.projectId)}/subscribers`;
		const result = await fetchAllSubscribers(
			async (cursor) => {
				const q = `?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
				const r = await apiJson(plugin, auth.token, 'GET', `${base}${q}`);
				if (r.status !== 200 || !r.json) throw new Error(`HTTP ${r.status} ${errorCode(r.json)}`.trim());
				return r.json as unknown as SubscribersPage;
			},
			{ onPage: (n) => progress.setMessage(tr(plugin, 'ui.subscribe_export_loading', { count: n })) },
		);
		let summary: AudienceSummary | null = null;
		if (opts.format === 'md') {
			const s = await apiJson(plugin, auth.token, 'GET', `${base}/summary?days=30`);
			if (s.status === 200 && s.json) summary = s.json;
		}
		const project: AudienceProject = result.project ?? { id: opts.projectId };
		const sourcePath = (project.sourcePath || opts.localSourcePath || '').replace(/^\/+|\/+$/g, '');
		const folder = chooseExportFolder(sourcePath);
		const existing = await listExisting(app, folder);
		const now = new Date();
		const path = normalizePath(
			exportFilePath(folder, siteSlugFor(project, opts.projectId), now, opts.format, (p) => existing.has(normalizePath(p))),
		);
		const ctx = { project, sourcePath, vault: vaultIndex(app) };
		const content =
			opts.format === 'csv'
				? buildCsv(result.subscribers, ctx)
				: buildMarkdown(result.subscribers, {
						...ctx,
						summary,
						exportedAt: now,
						...(result.total != null ? { total: result.total } : {}),
						labels: mdLabels(plugin),
					});
		const hidden = folder.startsWith('.');
		if (!(await app.vault.adapter.exists(folder))) {
			if (hidden) await app.vault.adapter.mkdir(folder);
			else await app.vault.createFolder(folder);
		}
		if (hidden) {
			// Dot-folders are not indexed by the vault; write through the adapter.
			await app.vault.adapter.write(path, content);
		} else {
			const file = await app.vault.create(path, content);
			if (opts.format === 'md' && file instanceof TFile) {
				await app.workspace.getLeaf(true).openFile(file);
			}
		}
		progress.hide();
		new Notice(tr(plugin, 'ui.subscribe_export_done', { count: result.subscribers.length, path }), 8000);
		return { path, count: result.subscribers.length };
	} catch (e) {
		progress.hide();
		new Notice(tr(plugin, 'ui.subscribe_export_failed', { error: e instanceof Error ? e.message : String(e) }));
		return null;
	}
}

type PickerItem = { project: AudienceListItem; format: ExportFormat };

/** Command "Export subscribers…": pick a site (incl. deleted ones inside the 30-day window) and a format. */
export class SubscriberExportPicker extends SuggestModal<PickerItem> {
	constructor(
		private plugin: FridayPlugin,
		private items: AudienceListItem[],
	) {
		super(plugin.app);
		this.setPlaceholder(tr(plugin, 'ui.subscribe_picker_placeholder'));
	}

	getSuggestions(query: string): PickerItem[] {
		const q = query.trim().toLowerCase();
		const out: PickerItem[] = [];
		for (const project of this.items) {
			const label = pickerLabel(project, tr(this.plugin, 'ui.subscribe_deleted_label')).toLowerCase();
			if (q && !label.includes(q) && !(project.id || '').includes(q)) continue;
			out.push({ project, format: 'csv' }, { project, format: 'md' });
		}
		return out;
	}

	renderSuggestion(item: PickerItem, el: HTMLElement): void {
		el.createDiv({ text: pickerLabel(item.project, tr(this.plugin, 'ui.subscribe_deleted_label')) });
		el.createEl('small', {
			text: item.format === 'csv' ? tr(this.plugin, 'ui.subscribe_export_csv') : tr(this.plugin, 'ui.subscribe_export_md'),
		});
	}

	onChooseSuggestion(item: PickerItem): void {
		void exportSubscribers(this.plugin, { projectId: item.project.id, format: item.format });
	}
}

export async function openSubscriberExportPicker(plugin: FridayPlugin): Promise<void> {
	const auth = await userToken(plugin);
	if (!auth || auth.kind === 'guest') {
		new Notice(tr(plugin, 'ui.subscribe_guest_hint'));
		return;
	}
	try {
		const items = (await listAudienceProjects(plugin)).filter(
			(p) => p.status === 'deleted' || p.subscribeEnabled || (p.subscriberCount ?? 0) > 0,
		);
		if (items.length === 0) {
			new Notice(tr(plugin, 'ui.subscribe_picker_empty'));
			return;
		}
		new SubscriberExportPicker(plugin, items).open();
	} catch (e) {
		new Notice(tr(plugin, 'ui.subscribe_export_failed', { error: e instanceof Error ? e.message : String(e) }));
	}
}

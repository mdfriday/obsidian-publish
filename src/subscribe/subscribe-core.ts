/**
 * Subscribe capability — pure logic (no Obsidian imports) so it is unit-testable with `node --test`.
 * Design: arch/drafts/subscribe-design.md §4.1 (config contract) and §7 (plugin).
 *
 * params.subscribe (plugin-owned, lower-case keys; Base 2.4 partial reads enabled/title/description/project/endpoint):
 *   { enabled, title, description, project, endpoint, v: 1, synced, syncedproject }
 * `synced` / `syncedproject` remember the last server flag we PATCHed so publish only PATCHes on change.
 */

export interface SubscribeParams {
	enabled: boolean;
	title: string;
	description: string;
	project: string;
	endpoint: string;
	v: 1;
	/** Last subscribeEnabled value the server acknowledged for `syncedproject`. */
	synced?: boolean;
	syncedproject?: string;
}

export interface SubscribeUiFields {
	enabled: boolean;
	title: string;
	description: string;
}

/** Base 2.4 partial defaults (families/base/layouts/_partials/subscribe.html). */
export const SUBSCRIBE_DEFAULTS = {
	en: { title: 'Subscribe to updates', description: 'Get new posts by email.' },
	zh: { title: '订阅更新', description: '通过邮件获取新文章。' },
} as const;

export function subscribeDefaults(lang: string | undefined): { title: string; description: string } {
	return (lang || '').toLowerCase().startsWith('zh') ? SUBSCRIBE_DEFAULTS.zh : SUBSCRIBE_DEFAULTS.en;
}

export const SUBSCRIBE_CAPABILITY = 'subscribe';

/** True when the catalog entry advertises the subscribe capability (theme places the form). */
export function themeSupportsSubscribe(entry: { capabilities?: string[] } | null | undefined): boolean {
	return !!entry?.capabilities?.includes(SUBSCRIBE_CAPABILITY);
}

export function subscribeEndpoint(apiBaseUrl: string): string {
	return `${(apiBaseUrl || '').replace(/\/+$/, '')}/v1/public/subscribe`;
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** Normalize whatever is in config.json into a full SubscribeParams (or null when never configured). */
export function readSubscribeParams(raw: unknown): SubscribeParams | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const out: SubscribeParams = {
		enabled: r.enabled === true,
		title: str(r.title),
		description: str(r.description),
		project: str(r.project),
		endpoint: str(r.endpoint),
		v: 1,
	};
	if (typeof r.synced === 'boolean') out.synced = r.synced;
	if (typeof r.syncedproject === 'string' && r.syncedproject) out.syncedproject = r.syncedproject;
	return out;
}

/**
 * UI → config (persistSiteFields). Keeps project/endpoint/sync memory from the previous value.
 * Guests are always written as disabled. Returns null when nothing should be written
 * (never configured and the toggle is off) so untouched sites keep a clean config.
 */
export function mergeSubscribeUi(
	prevRaw: unknown,
	ui: SubscribeUiFields,
	opts: { guest: boolean },
): SubscribeParams | null {
	const prev = readSubscribeParams(prevRaw);
	const enabled = !opts.guest && ui.enabled;
	if (!prev && !enabled && !ui.title.trim() && !ui.description.trim()) return null;
	return {
		...(prev ?? { project: '', endpoint: '', v: 1 as const }),
		enabled,
		// "" → Base partial falls back to i18n / its en|zh default for the site language.
		title: ui.title.trim(),
		description: ui.description.trim(),
		v: 1,
	};
}

export interface PublishSubscribePlan {
	/** Params to write before the build (null = leave config untouched). */
	params: SubscribeParams | null;
	/** subscribeEnabled to PATCH, or null when the server already has it. */
	patch: boolean | null;
}

/** Publish-time plan: stamp project + endpoint, decide whether the server flag must change. */
export function planPublishSubscribe(
	prevRaw: unknown,
	ctx: { projectId: string; endpoint: string; guest: boolean },
): PublishSubscribePlan {
	const prev = readSubscribeParams(prevRaw);
	if (!prev) return { params: null, patch: null };
	const params: SubscribeParams = {
		...prev,
		enabled: ctx.guest ? false : prev.enabled,
		project: ctx.projectId || prev.project,
		endpoint: ctx.endpoint || prev.endpoint,
	};
	if (ctx.guest || !ctx.projectId) return { params, patch: null };
	const known = prev.syncedproject === ctx.projectId ? prev.synced : undefined;
	// Unknown server state + disabled: the server default is off, nothing to do.
	if (known === undefined && !params.enabled) return { params, patch: null };
	return { params, patch: known === params.enabled ? null : params.enabled };
}

export type PatchOutcome = 'ok' | 'plan_required' | 'error';

/** Fold the PATCH result back into params (written again so the next publish knows). */
export function applyPatchOutcome(
	params: SubscribeParams,
	desired: boolean,
	outcome: PatchOutcome,
): SubscribeParams {
	if (outcome === 'ok') return { ...params, synced: desired, syncedproject: params.project };
	if (outcome === 'plan_required') {
		// Server refuses (guest principal): do not render a form that can never store.
		return { ...params, enabled: false, synced: false, syncedproject: params.project };
	}
	return params; // transient: retry on next publish
}

// ---------------------------------------------------------------- API records

export interface SubscriberRecord {
	id: string;
	email: string;
	status?: string;
	createdAt: string;
	lastSeenAt?: string | null;
	submitCount?: number;
	page?: {
		url?: string | null;
		path?: string | null;
		title?: string | null;
		file?: string | null;
		kind?: string | null;
		placement?: string | null;
		lang?: string | null;
	} | null;
	releaseId?: string | null;
	referrerHost?: string | null;
	utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
	country?: string | null;
}

export interface AudienceProject {
	id: string;
	siteId?: string;
	title?: string | null;
	publicUrl?: string | null;
	sourcePath?: string | null;
	status?: string;
	deletedAt?: string | null;
	purgeAt?: string | null;
}

export interface SubscribersPage {
	project?: AudienceProject;
	total?: number;
	subscribers: SubscriberRecord[];
	nextCursor?: string | null;
}

export interface AudienceSummary {
	total?: number;
	new7d?: number;
	new30d?: number;
	topPages?: Array<{ path?: string; title?: string; url?: string; count: number }>;
}

/** Page through GET …/subscribers until nextCursor is null. `fetchPage(cursor)` does the HTTP. */
export async function fetchAllSubscribers(
	fetchPage: (cursor: string | null) => Promise<SubscribersPage>,
	opts: { maxPages?: number; onPage?: (loaded: number, total: number | undefined) => void } = {},
): Promise<{ project?: AudienceProject; total?: number; subscribers: SubscriberRecord[] }> {
	const maxPages = opts.maxPages ?? 1000;
	const all: SubscriberRecord[] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;
	let project: AudienceProject | undefined;
	let total: number | undefined;
	for (let i = 0; i < maxPages; i++) {
		const page = await fetchPage(cursor);
		if (i === 0) {
			project = page.project;
			total = page.total;
		}
		for (const s of page.subscribers ?? []) {
			if (seen.has(s.id)) continue;
			seen.add(s.id);
			all.push(s);
		}
		opts.onPage?.(all.length, total);
		const next = page.nextCursor ?? null;
		if (!next || next === cursor) break;
		cursor = next;
	}
	all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
	return { project, total, subscribers: all };
}

// ---------------------------------------------------------------- dates

function pad(n: number, w = 2): string {
	return String(n).padStart(w, '0');
}

/** Local ISO with offset, e.g. 2026-10-03T13:23:50+08:00. */
export function localIso(input: string | Date | null | undefined): string {
	if (!input) return '';
	const d = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(d.getTime())) return '';
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? '+' : '-';
	const abs = Math.abs(off);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

/** Local "YYYY-MM-DD HH:mm". */
export function localShort(input: string | Date | null | undefined): string {
	const iso = localIso(input);
	return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '';
}

export function localDate(input: string | Date | null | undefined): string {
	return localIso(input).slice(0, 10);
}

// ---------------------------------------------------------------- note links

/** Vault-relative markdown paths (with .md) — injected so tests need no vault. */
export type VaultIndex = {
	files: string[];
	/** Obsidian metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path */
	linkpathDest?: (linkpath: string, from: string) => string | null;
};

function trimSlashes(p: string): string {
	return p.replace(/^\/+|\/+$/g, '');
}

/**
 * Resolve page.file (Foundry `.File.Dir + .File.OriginalBaseName`, e.g. "plans/claim-and-upgrade",
 * "index" for home) to a vault note under the published `sourcePath`.
 * Order: exact → case-insensitive → linkpath → single-note site → null.
 */
export function resolveNotePath(
	file: string | null | undefined,
	sourcePath: string | null | undefined,
	vault: VaultIndex,
): string | null {
	const src = trimSlashes(sourcePath || '');
	// Single-note site: every article is the note itself.
	if (src.toLowerCase().endsWith('.md')) {
		return vault.files.includes(src) ? src : null;
	}
	const rel = trimSlashes((file || '').replace(/\.md$/i, ''));
	if (!rel) return null;
	const prefix = src ? `${src}/` : '';
	const candidates = [`${prefix}${rel}.md`];
	// Home / section pages come from index.md or _index.md in that folder.
	const base = rel.split('/').pop() || '';
	if (base === 'index' || base === '_index') {
		const dir = rel.slice(0, rel.length - base.length);
		candidates.push(`${prefix}${dir}index.md`, `${prefix}${dir}_index.md`);
	}
	for (const c of candidates) if (vault.files.includes(c)) return c;
	const lower = new Map<string, string>();
	for (const f of vault.files) {
		if (!prefix || f.toLowerCase().startsWith(prefix.toLowerCase())) lower.set(f.toLowerCase(), f);
	}
	for (const c of candidates) {
		const hit = lower.get(c.toLowerCase());
		if (hit) return hit;
	}
	if (base !== 'index' && base !== '_index' && vault.linkpathDest) {
		const dest = vault.linkpathDest(base, prefix || '/');
		if (dest && (!prefix || dest.toLowerCase().startsWith(prefix.toLowerCase()))) return dest;
	}
	return null;
}

// ---------------------------------------------------------------- export location

export const EXPORT_FOLDER = 'MDFriday Exports';
export const EXPORT_FOLDER_HIDDEN = '.mdfriday-exports';

/** `MDFriday Exports/` unless that would be inside the published folder (then `.mdfriday-exports/`). */
export function chooseExportFolder(sourcePath: string | null | undefined): string {
	const src = trimSlashes(sourcePath || '');
	if (src.toLowerCase().endsWith('.md')) return EXPORT_FOLDER; // single-note site
	if (src === '') return EXPORT_FOLDER_HIDDEN; // whole vault is published
	const target = EXPORT_FOLDER.toLowerCase();
	const s = src.toLowerCase();
	if (target === s || target.startsWith(`${s}/`)) return EXPORT_FOLDER_HIDDEN;
	return EXPORT_FOLDER;
}

export function slugify(input: string | null | undefined): string {
	return (input || '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

/** `<slug>-subscribers-YYYY-MM-DD-HHmm.<ext>`, `-2`, `-3`… on collision. */
export function exportFilePath(
	folder: string,
	slug: string,
	at: Date,
	ext: 'csv' | 'md',
	exists: (path: string) => boolean,
): string {
	const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
	const base = `${folder}/${slug || 'site'}-subscribers-${stamp}`;
	let p = `${base}.${ext}`;
	for (let n = 2; exists(p) && n < 1000; n++) p = `${base}-${n}.${ext}`;
	return p;
}

export function siteSlugFor(project: AudienceProject | undefined, fallback: string): string {
	return slugify(project?.title) || slugify(project?.siteId) || slugify(fallback) || 'site';
}

// ---------------------------------------------------------------- CSV

export const CSV_COLUMNS = [
	'email', 'date_added', 'project', 'page_title', 'page_url', 'source_note', 'referrer',
	'utm_source', 'utm_medium', 'utm_campaign', 'country', 'lang', 'placement', 'last_seen', 'submit_count',
] as const;

export function csvCell(v: unknown): string {
	const s = v == null ? '' : String(v);
	// Neutralise spreadsheet formulas (CSV injection) without touching normal text.
	const safe = /^[=+@\t\r]|^-(?=[\d(=+@])/.test(s) ? `'${s}` : s;
	return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface ExportContext {
	project: AudienceProject;
	/** Vault-relative published path (folder or .md). */
	sourcePath: string;
	vault: VaultIndex;
}

function notePathFor(s: SubscriberRecord, ctx: ExportContext): string | null {
	return resolveNotePath(s.page?.file, ctx.sourcePath, ctx.vault);
}

/** RFC 4180, CRLF, UTF-8 BOM. */
export function buildCsv(subs: SubscriberRecord[], ctx: ExportContext): string {
	const rows = [CSV_COLUMNS.join(',')];
	for (const s of subs) {
		rows.push(
			[
				s.email,
				localIso(s.createdAt),
				ctx.project.id,
				s.page?.title ?? '',
				s.page?.url ?? '',
				notePathFor(s, ctx) ?? '',
				s.referrerHost ?? '',
				s.utm?.source ?? '',
				s.utm?.medium ?? '',
				s.utm?.campaign ?? '',
				s.country ?? '',
				s.page?.lang ?? '',
				s.page?.placement ?? '',
				localIso(s.lastSeenAt ?? null),
				s.submitCount ?? 1,
			]
				.map(csvCell)
				.join(','),
		);
	}
	return `\uFEFF${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- Markdown

/** Table-cell safe text: no newlines, escaped pipes. */
export function mdCell(v: unknown): string {
	const s = v == null ? '' : String(v);
	return s.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim();
}

function mdLinkText(s: string): string {
	return s.replace(/[\r\n]+/g, ' ').replace(/([[\]\\])/g, '\\$1');
}

function wikilink(notePath: string, title: string, inTable: boolean): string {
	const target = notePath.replace(/\.md$/i, '');
	const label = (title || '').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
	const sep = inTable ? '\\|' : '|';
	const t = target.replace(/\|/g, ' ');
	return label ? `[[${t}${sep}${label}]]` : `[[${t}]]`;
}

function urlForMd(url: string): string {
	return url.replace(/ /g, '%20').replace(/\)/g, '%29').replace(/\|/g, '%7C');
}

/** Article cell: vault wikilink → public URL link → title → path → "—". */
export function articleCell(
	page: { url?: string | null; title?: string | null; path?: string | null } | null | undefined,
	notePath: string | null,
	inTable = true,
): string {
	const title = page?.title || '';
	if (notePath) return wikilink(notePath, title, inTable);
	if (page?.url) {
		const text = mdLinkText(title || page.path || page.url);
		const link = `[${text}](${urlForMd(page.url)})`;
		return inTable ? link.replace(/\|/g, '\\|') : link;
	}
	if (title) return inTable ? mdCell(title) : title;
	return page?.path ? (inTable ? mdCell(page.path) : page.path) : '—';
}

function yamlStr(s: string): string {
	return JSON.stringify(s ?? '');
}

export function buildMarkdown(
	subs: SubscriberRecord[],
	ctx: ExportContext & {
		summary?: AudienceSummary | null;
		exportedAt: Date;
		total?: number;
		labels?: Partial<MarkdownLabels>;
	},
): string {
	const L = { ...DEFAULT_MD_LABELS, ...(ctx.labels ?? {}) };
	const p = ctx.project;
	const siteTitle = p.title || p.siteId || p.id;
	const total = ctx.summary?.total ?? ctx.total ?? subs.length;
	const deleted = p.status === 'deleted';
	const status = deleted ? `deleted (purges ${localDate(p.purgeAt ?? null)})` : p.status || 'published';
	const lines: string[] = [
		'---',
		'type: mdfriday-subscribers',
		`site: ${yamlStr(siteTitle)}`,
		`project: ${p.id}`,
		`site_url: ${yamlStr(p.publicUrl || '')}`,
		`status: ${yamlStr(status)}`,
		`exported_at: ${localIso(ctx.exportedAt)}`,
		`total: ${total}`,
		'---',
		`# ${L.heading} · ${siteTitle.replace(/[\r\n]+/g, ' ')}`,
		`> ${L.notice.replace('{{date}}', localShort(ctx.exportedAt))}`,
		'',
		`## ${L.summary}`,
	];
	const s7 = ctx.summary?.new7d;
	const s30 = ctx.summary?.new30d;
	lines.push(
		`- ${L.total} **${total}**` +
			(s7 != null ? ` · ${L.last7} **${s7}**` : '') +
			(s30 != null ? ` · ${L.last30} **${s30}**` : ''),
	);
	// Top article: summary.topPages if present, else counted from the rows.
	let top: { title: string; url: string; path: string; count: number; file: string | null } | null = null;
	const counts = new Map<string, { title: string; url: string; path: string; count: number; file: string | null }>();
	for (const s of subs) {
		const key = s.page?.path || s.page?.url || '';
		if (!key) continue;
		const c = counts.get(key) ?? { title: s.page?.title || '', url: s.page?.url || '', path: s.page?.path || '', count: 0, file: s.page?.file ?? null };
		c.count++;
		counts.set(key, c);
	}
	for (const c of counts.values()) if (!top || c.count > top.count) top = c;
	const tp = ctx.summary?.topPages?.[0];
	if (tp) {
		const row = counts.get(tp.path || '') ?? null;
		top = { title: tp.title || '', url: tp.url || '', path: tp.path || '', count: tp.count, file: row?.file ?? null };
	}
	if (top) {
		const note = resolveNotePath(top.file, ctx.sourcePath, ctx.vault);
		lines.push(`- ${L.topArticle}: ${articleCell(top, note, false)} (${top.count})`);
	}
	if (deleted) lines.push(`- ${L.deleted.replace('{{date}}', localDate(p.purgeAt ?? null))}`);
	lines.push('', `## ${L.list}`, '');
	lines.push(`| # | ${L.colEmail} | ${L.colDate} | ${L.colArticle} | ${L.colReferrer} |`, '|---|---|---|---|---|');
	subs.forEach((s, i) => {
		lines.push(
			`| ${i + 1} | ${mdCell(s.email)} | ${localShort(s.createdAt)} | ${articleCell(s.page, notePathFor(s, ctx))} | ${mdCell(s.referrerHost) || '—'} |`,
		);
	});
	if (subs.length === 0) lines.push(`| — | ${L.empty} | | | |`);
	return `${lines.join('\n')}\n`;
}

export interface MarkdownLabels {
	heading: string;
	notice: string;
	summary: string;
	total: string;
	last7: string;
	last30: string;
	topArticle: string;
	deleted: string;
	list: string;
	colEmail: string;
	colDate: string;
	colArticle: string;
	colReferrer: string;
	empty: string;
}

export const DEFAULT_MD_LABELS: MarkdownLabels = {
	heading: 'Subscribers',
	notice: 'Exported from MDFriday on {{date}}. Contains personal data, do not publish.',
	summary: 'Summary',
	total: 'Total',
	last7: 'last 7 days',
	last30: 'last 30 days',
	topArticle: 'Top article',
	deleted: 'Site deleted · subscribers purge on {{date}}',
	list: 'List',
	colEmail: 'Email',
	colDate: 'Date added',
	colArticle: 'Article',
	colReferrer: 'Referrer',
	empty: 'No subscribers yet',
};

/** Export picker label for a project row. */
export function pickerLabel(p: AudienceProject & { subscriberCount?: number }, deletedTpl: string): string {
	const name = p.title || p.siteId || p.id;
	const count = typeof p.subscriberCount === 'number' ? ` (${p.subscriberCount})` : '';
	if (p.status === 'deleted') return `${name}${count} — ${deletedTpl.replace('{{date}}', localDate(p.purgeAt ?? null))}`;
	return `${name}${count}`;
}

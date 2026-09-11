/**
 * Shared note media helpers for faithful packaging and themed Foundry builds.
 *
 * Collects vault media referenced by a single note (wikilink embeds + markdown
 * images) using Obsidian link resolution — same approach as as-is preview.
 */

import type { Plugin } from 'obsidian';
import { normalizePath, TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

/** File extensions treated as note attachments (images / media / pdf). */
export const NOTE_MEDIA_EXT = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'bmp',
	'ico',
	'avif',
	'mp4',
	'webm',
	'mov',
	'mp3',
	'wav',
	'ogg',
	'm4a',
	'pdf',
]);

/** Project-static prefix so staged files land at public/media/... */
export const NOTE_MEDIA_STATIC_PREFIX = 'media';

export type StagedNoteMedia = {
	file: TFile;
	/** Vault-relative path (posix). */
	vaultPath: string;
	/** Path under project static/ (posix), e.g. media/Attachments/a.png */
	staticRelPath: string;
};

export function isNoteMediaFile(file: TFile): boolean {
	return NOTE_MEDIA_EXT.has(file.extension.toLowerCase());
}

export function stripUrlQueryHash(url: string): string {
	const q = url.indexOf('?');
	const h = url.indexOf('#');
	let end = url.length;
	if (q >= 0) end = Math.min(end, q);
	if (h >= 0) end = Math.min(end, h);
	return url.slice(0, end);
}

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

/**
 * Match Foundry/Quartz slugifyFilePath for media destinations so wikilink
 * `<img src>` after SSG points at the staged static file.
 */
export function slugifyMediaPath(fp: string): string {
	const stripped = toPosix(fp).replace(/^\/+|\/+$/g, '');
	const extMatch = stripped.match(/\.[A-Za-z0-9]+$/);
	const ext = extMatch?.[0] ?? '';
	const withoutExt = ext ? stripped.slice(0, -ext.length) : stripped;
	const keepExt = ext && !['.md', '.html'].includes(ext.toLowerCase()) ? ext : '';
	const slug = withoutExt
		.split('/')
		.map((segment) =>
			segment
				.replace(/\s/g, '-')
				.replace(/&/g, '-and-')
				.replace(/%/g, '-percent')
				.replace(/\?/g, '')
				.replace(/#/g, ''),
		)
		.join('/')
		.replace(/\/$/, '');
	return slug + keepExt;
}

/**
 * Resolve a linkpath / markdown image target to a vault media file.
 */
export function resolveNoteMediaFile(
	plugin: Plugin,
	linkpath: string,
	notePath: string,
): TFile | null {
	const raw = linkpath.trim();
	if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('data:')) return null;

	let decoded = raw;
	try {
		decoded = decodeURIComponent(stripUrlQueryHash(raw));
	} catch {
		decoded = stripUrlQueryHash(raw);
	}

	const dest =
		plugin.app.metadataCache.getFirstLinkpathDest(decoded, notePath) ??
		plugin.app.vault.getAbstractFileByPath(normalizePath(decoded));

	if (dest instanceof TFile && isNoteMediaFile(dest)) {
		return dest;
	}
	return null;
}

/**
 * Collect unique vault media files referenced by the note (embeds + md images).
 */
export async function collectNoteMediaFiles(plugin: Plugin, note: TFile): Promise<TFile[]> {
	const seen = new Set<string>();
	const out: TFile[] = [];

	const add = (file: TFile | null) => {
		if (!file || seen.has(file.path)) return;
		seen.add(file.path);
		out.push(file);
	};

	const cache = plugin.app.metadataCache.getFileCache(note);
	for (const embed of cache?.embeds ?? []) {
		const linkpath = embed.link.split('#')[0]?.split('|')[0]?.trim();
		if (!linkpath) continue;
		add(resolveNoteMediaFile(plugin, linkpath, note.path));
	}

	try {
		const source = await plugin.app.vault.read(note);
		const mdImg = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?\s*\)/g;
		let m: RegExpExecArray | null;
		while ((m = mdImg.exec(source))) {
			const raw = m[1]?.trim();
			if (!raw) continue;
			add(resolveNoteMediaFile(plugin, raw, note.path));
		}
	} catch {
		// ignore source scan failures
	}

	return out;
}

/**
 * Copy collected media into project static/media/<vault-relative-path>.
 * Replaces any previous static/media tree for a clean stage.
 */
export async function stageNoteMediaToStatic(
	plugin: Plugin,
	files: TFile[],
	projectStaticDir: string,
): Promise<StagedNoteMedia[]> {
	const mediaRoot = path.join(projectStaticDir, NOTE_MEDIA_STATIC_PREFIX);
	await fs.promises.rm(mediaRoot, { recursive: true, force: true });
	await fs.promises.mkdir(mediaRoot, { recursive: true });

	const staged: StagedNoteMedia[] = [];

	for (const file of files) {
		const vaultPath = toPosix(normalizePath(file.path));
		const staticRelPath = slugifyMediaPath(
			path.posix.join(NOTE_MEDIA_STATIC_PREFIX, vaultPath),
		);
		const destAbs = path.join(projectStaticDir, ...staticRelPath.split('/'));

		await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
		const data = await plugin.app.vault.adapter.readBinary(file.path);
		await fs.promises.writeFile(destAbs, Buffer.from(data));

		staged.push({ file, vaultPath, staticRelPath });
	}

	return staged;
}

/**
 * Rewrite wikilink embeds and markdown images so Foundry resolves them under
 * static/media/... (public URL /media/...).
 */
export function rewriteNoteSourceForStagedMedia(
	plugin: Plugin,
	note: TFile,
	source: string,
	staged: StagedNoteMedia[],
): string {
	if (staged.length === 0) return source;

	const byVault = new Map(staged.map((s) => [s.vaultPath, s]));
	let out = source;

	const cache = plugin.app.metadataCache.getFileCache(note);
	const embeds = [...(cache?.embeds ?? [])].sort(
		(a, b) => b.position.start.offset - a.position.start.offset,
	);

	for (const embed of embeds) {
		const linkpath = embed.link.split('#')[0]?.split('|')[0]?.trim();
		if (!linkpath) continue;
		const dest = resolveNoteMediaFile(plugin, linkpath, note.path);
		if (!dest) continue;
		const hit = byVault.get(toPosix(normalizePath(dest.path)));
		if (!hit) continue;

		const start = embed.position.start.offset;
		const end = embed.position.end.offset;
		const original = out.slice(start, end);
		const replaced = rewriteEmbedToken(original, hit.staticRelPath);
		if (replaced !== original) {
			out = out.slice(0, start) + replaced + out.slice(end);
		}
	}

	out = out.replace(/!\[([^\]]*)]\(\s*<?([^)\s>]+)>?\s*\)/g, (full, alt: string, raw: string) => {
		const dest = resolveNoteMediaFile(plugin, raw.trim(), note.path);
		if (!dest) return full;
		const hit = byVault.get(toPosix(normalizePath(dest.path)));
		if (!hit) return full;
		const target = encodeURI(hit.staticRelPath);
		return `![${alt}](${target})`;
	});

	return out;
}

/**
 * ![[path#anchor|alias]] → ![[media/...#anchor|alias]]
 */
function rewriteEmbedToken(token: string, staticRelPath: string): string {
	const m = /^!\[\[([\s\S]*?)\]\]$/u.exec(token.trim());
	if (!m?.[1]) return token;

	const inner = m[1];
	const pipeIndex = inner.indexOf('|');
	const alias = pipeIndex !== -1 ? inner.slice(pipeIndex + 1) : undefined;
	const beforePipe = pipeIndex !== -1 ? inner.slice(0, pipeIndex) : inner;
	const hashIndex = beforePipe.indexOf('#');
	const anchor = hashIndex !== -1 ? beforePipe.slice(hashIndex) : '';

	let next = staticRelPath + anchor;
	if (alias !== undefined) next += `|${alias}`;
	return `![[${next}]]`;
}

/**
 * Materialize rewritten markdown at content target.
 * If target is a symlink, replace it with a regular file so we never write
 * into the vault. Symlink/watch live-reload is intentionally not preserved
 * for this staging path (can be revisited later).
 */
export async function writeRewrittenNoteContent(
	targetPath: string,
	content: string,
): Promise<{ replacedSymlink: boolean }> {
	let replacedSymlink = false;
	try {
		const st = await fs.promises.lstat(targetPath);
		if (st.isSymbolicLink()) {
			await fs.promises.unlink(targetPath);
			replacedSymlink = true;
		}
	} catch {
		// missing target — writeFile will create
	}

	await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.promises.writeFile(targetPath, content, 'utf8');
	return { replacedSymlink };
}

/**
 * Mark fileLink.isSymlink=true so Foundry's copyFile sync does not overwrite
 * the rewritten content/index.md before build/serve.
 */
export async function markProjectFileLinkSkipSync(projectPath: string): Promise<void> {
	const metaPath = path.join(projectPath, '.mdfriday', 'project.json');
	try {
		const raw = await fs.promises.readFile(metaPath, 'utf8');
		const meta = JSON.parse(raw) as {
			fileLink?: { sourcePath: string; targetPath: string; isSymlink: boolean };
		};
		if (!meta.fileLink) return;
		if (meta.fileLink.isSymlink) return;
		meta.fileLink = { ...meta.fileLink, isSymlink: true };
		await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
	} catch (err) {
		console.warn('[note-media] Failed to mark fileLink skip-sync:', err);
	}
}

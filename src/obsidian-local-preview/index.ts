/**
 * Obsidian Local Preview — single-note dynamic package.
 *
 * Pipeline (current vault only):
 *  1. Collect current Obsidian appearance / theme / snippets / plugins
 *  2. Export Theme Snapshot (CSS / vars / assets) — see obsidian-preview.md
 *  3. Render MD with Obsidian MarkdownRenderer (plugin runtime)
 *  4. Package static HTML + CSS into a temp dir (theme classes injected)
 *  5. Serve with a simple static web server
 *
 * Goal: browser preview matches Obsidian Reading View for this vault.
 * Foundry themes stay on the existing Foundry MD path.
 */

import type { Plugin, TFile } from 'obsidian';
import { MarkdownRenderer as ObsidianMarkdownRenderer } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { buildEncryptGateHtml, encryptAESGCM } from './encrypt';

export type ThemeSnapshot = {
	generatedAt: number;
	sourceTheme: string | null;
	hasSnippets: boolean;
	appearance?: Record<string, unknown> | null;
	css: {
		theme: string;
		snippets: string;
		vars: string;
		core: string;
		plugins: string;
	};
	assets: { relativePath: string; absolutePath: string }[];
	manifest: {
		name: string;
		version: string;
		generatedAt: number;
		sourceTheme: string | null;
		hasSnippets: boolean;
		assetCount: number;
	};
};

export type LocalPreviewResult = {
	url: string;
	rootDir: string;
	htmlPath: string;
	snapshotPath: string;
};

export type LocalPreviewOptions = {
	file: TFile;
	title?: string;
	/** When set, AES-GCM gate (same as Foundry theme encrypt cap) */
	password?: string;
};

export type ThemeClassBundle = {
	/** Classes to put on <html> / <body> / markdown container */
	themeClassAttr: string;
	/** PreferDark from live body or prefers-color-scheme */
	preferDark: boolean;
	sourceTheme: string | null;
};

/**
 * Resolve a vault-relative path to absolute path.
 * Prefer adapter.getBasePath(); fall back to vault.adapter / plugin vault root.
 */
function resolveVaultPath(plugin: Plugin, vaultPath: string): string {
	const adapter = plugin.app.vault.adapter as any;
	const absRoot =
		typeof adapter.getBasePath === 'function'
			? adapter.getBasePath()
			: typeof adapter.getFullPath === 'function'
				? adapter.getFullPath('')
				: process.cwd();
	return path.join(absRoot, vaultPath.replace(/^\.\//, ''));
}

/**
 * Read a file from vault if it exists.
 */
async function readVaultFile(
	plugin: Plugin,
	vaultPath: string,
): Promise<string | null> {
	try {
		if (await plugin.app.vault.adapter.exists(vaultPath)) {
			return await plugin.app.vault.adapter.read(vaultPath);
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * Extract CSS url(...) references.
 */
function collectCssUrls(css: string): string[] {
	const out: string[] = [];
	const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(css))) {
		const raw = m[2]?.trim();
		if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
		out.push(raw);
	}
	return out;
}

/**
 * Collect CSS variables from the live document body.
 */
function collectCssVars(): string {
	const style = getComputedStyle(document.body);
	const lines: string[] = [':root {'];
	let count = 0;
	for (let i = 0; i < style.length; i++) {
		const key = style[i];
		if (!key || !key.startsWith('--')) continue;
		const val = style.getPropertyValue(key).trim();
		if (!val) continue;
		count += 1;
		lines.push(`  ${key}: ${val};`);
	}
	lines.push('}');
	if (count === 0) {
		return '/* no CSS variables detected */';
	}
	return lines.join('\n');
}

/**
 * Prefer dark when body has theme-dark, or when prefers-color-scheme is dark.
 */
function preferDarkMode(): boolean {
	const bodyClasses = Array.from(document.body.classList);
	if (bodyClasses.includes('theme-dark')) return true;
	if (bodyClasses.includes('theme-light')) return false;
	return (
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-color-scheme: dark)').matches
	);
}

/**
 * Collect theme CSS classes that must be on the packaged body.
 *
 * Obsidian themes gate colors under `.theme-light` / `.theme-dark`. Community
 * themes (e.g. AnuPpuccin) also use class-select flavors like `.ctp-latte`
 * / `.ctp-mocha`. Blue Topaz uses `body.color-scheme-options-*`.
 *
 * Live body is primary; class-select defaults from theme CSS are used when
 * live body is incomplete (no flavor yet).
 */
export function detectThemeClasses(themeCss = ''): string[] {
	const classes: string[] = [];
	const bodyClasses = Array.from(document.body.classList);
	const hasLight = bodyClasses.includes('theme-light');
	const hasDark = bodyClasses.includes('theme-dark');
	if (hasDark) classes.push('theme-dark');
	else if (hasLight) classes.push('theme-light');
	else if (preferDarkMode()) classes.push('theme-dark');
	else classes.push('theme-light');

	// Class-select flavors from live body (when theme is selected)
	for (const cls of bodyClasses) {
		if (cls === 'theme-light' || cls === 'theme-dark') continue;
		if (isThemeFlavorClass(cls)) {
			if (!classes.includes(cls)) classes.push(cls);
		}
	}

	// Fallback from theme CSS when live body has no flavor
	if (themeCss) {
		const fromTheme = detectClassSelectFlavor(themeCss, preferDarkMode());
		for (const cls of fromTheme) {
			if (!classes.includes(cls) && isThemeFlavorClass(cls)) {
				classes.push(cls);
			}
		}
	}

	return classes;
}

/** True for community-theme flavor / scheme classes that must be on body. */
function isThemeFlavorClass(cls: string): boolean {
	return (
		cls.startsWith('ctp-') ||
		cls.startsWith('anp-') ||
		cls.startsWith('anuppuccin') ||
		cls.startsWith('color-scheme-options-') ||
		cls.includes('-accent') ||
		/\b(dark|light)-mode\b/i.test(cls) ||
		cls.startsWith('theme-')
	);
}

/**
 * Default class-select flavor when the live body has none but theme CSS
 * references known selectors (e.g. AnuPpuccin .ctp-latte / .ctp-mocha,
 * Blue Topaz body.color-scheme-options-*).
 */
export function detectClassSelectFlavor(
	themeCss: string,
	preferDark: boolean,
): string[] {
	const out: string[] = [];
	if (!themeCss) return out;

	const dark = preferDark || themeCss.includes('.theme-dark.ctp-mocha');

	// AnuPpuccin-style: extract defaults from @settings block
	const defaults = parseClassSelectDefaults(themeCss);
	// Prefer live defaults for light/dark flavors when present
	if (defaults.lightFlavor && defaults.darkFlavor) {
		out.push(dark ? defaults.darkFlavor : defaults.lightFlavor);
	} else if (themeCss.includes('ctp-latte') || themeCss.includes('ctp-mocha')) {
		if (dark && (themeCss.includes('ctp-mocha') || themeCss.includes('.theme-dark.ctp-mocha'))) {
			out.push('ctp-mocha');
		} else if (themeCss.includes('ctp-latte') || themeCss.includes('.theme-light.ctp-latte')) {
			out.push('ctp-latte');
		}
	}

	// Blue Topaz-style: body.color-scheme-options-*
	const schemeMatches = [...themeCss.matchAll(/color-scheme-options-([a-z0-9\-]+)/gi)];
	if (schemeMatches.length > 0) {
		const names = schemeMatches.map((m) => `color-scheme-options-${m[1]}`);
		const preferred = dark
			? names.find((n) =>
					/mocha|dark|night|nord|chocolate|flamingo|lilac|pink|autumn|avocado|monochrome|simplicity|topaz-nord|honey/i.test(
						n,
					),
				)
			: names.find((n) => /default|light|latte/i.test(n));
		const chosen =
			preferred ||
			names.find((n) => n !== 'color-scheme-options-default') ||
			names[0];
		if (chosen && !out.includes(chosen)) out.push(chosen);
	}

	return out;
}

/**
 * Parse class-select defaults for light/dark flavors from a theme `@settings`
 * block (AnuPpuccin-style).
 *
 * Prefer id names like `anuppuccin-theme-light` / `anuppuccin-theme-dark`,
 * not every class-select (accents etc.).
 */
export function parseClassSelectDefaults(
	themeCss: string,
): { lightFlavor?: string; darkFlavor?: string } {
	const defaults: { lightFlavor?: string; darkFlavor?: string } = {};
	if (!themeCss) return defaults;

	// Prefer id + default near theme-light / theme-dark
	// e.g. id: anuppuccin-theme-light ... default: ctp-latte
	const light = themeCss.match(
		/id:\s*[\s\S]{0,80}?theme-light[\s\S]{0,400}?default:\s*([a-z0-9\-]+)/i,
	);
	const dark = themeCss.match(
		/id:\s*[\s\S]{0,80}?theme-dark[\s\S]{0,400}?default:\s*([a-z0-9\-]+)/i,
	);
	if (light?.[1] && light[1] !== 'none') defaults.lightFlavor = light[1];
	if (dark?.[1] && dark[1] !== 'none') defaults.darkFlavor = dark[1];

	return defaults;
}

/**
 * Extract enabled snippets + theme name from appearance.json.
 *
 * Obsidian uses `cssTheme` (community / theme folder name). Older builds
 * may still write `theme`; support both.
 */
async function collectAppearance(plugin: Plugin): Promise<{
	themeName: string | null;
	snippets: string[];
	appearance: Record<string, unknown> | null;
}> {
	const appearanceRaw = await readVaultFile(plugin, '.obsidian/appearance.json');
	if (!appearanceRaw) {
		return { themeName: null, snippets: [], appearance: null };
	}
	let appearance: Record<string, unknown>;
	try {
		appearance = JSON.parse(appearanceRaw);
	} catch {
		return { themeName: null, snippets: [], appearance: null };
	}
	// Prefer cssTheme (current API); fall back to legacy theme field.
	const themeName =
		(typeof appearance.cssTheme === 'string' && appearance.cssTheme.trim()) ||
		(typeof appearance.theme === 'string' && appearance.theme.trim()) ||
		null;
	const snippetsRaw = Array.isArray(appearance.enabledCssSnippets)
		? appearance.enabledCssSnippets
		: [];

	const snippets: string[] = [];
	for (const name of snippetsRaw) {
		if (typeof name !== 'string' || !name.trim()) continue;
		const snippetPath = `.obsidian/snippets/${name.trim()}.css`;
		const content = await readVaultFile(plugin, snippetPath);
		if (content) snippets.push(content);
	}

	return { themeName, snippets, appearance };
}

/**
 * Discover installed theme folder names under `.obsidian/themes/`.
 */
async function listVaultThemes(plugin: Plugin): Promise<string[]> {
	const themesDir = `.obsidian/themes`;
	try {
		if (!(await plugin.app.vault.adapter.exists(themesDir))) return [];
		const names: string[] = [];
		const children = await plugin.app.vault.adapter.list(themesDir);
		for (const entry of [...children.files, ...children.folders]) {
			const base = path.basename(entry);
			if (base && base !== '.' && base !== '..') names.push(base);
		}
		if (names.length === 0) {
			const dirs = await plugin.app.vault.adapter.list(themesDir);
			for (const f of dirs.files) {
				if (f.endsWith('/theme.css') || path.basename(f) === 'theme.css') {
					names.push(path.basename(path.dirname(f)));
				}
			}
		}
		return [...new Set(names)].sort();
	} catch {
		return [];
	}
}

/**
 * Prefer vault theme.css file; if not available and only one theme is
 * installed, use it (helps when appearance.cssTheme is empty).
 */
async function resolveThemeCssFile(
	plugin: Plugin,
	themeName: string | null,
): Promise<{ content: string; name: string | null }> {
	if (themeName) {
		const candidates = [
			`.obsidian/themes/${themeName}/theme.css`,
			`.obsidian/themes/${encodeURIComponent(themeName)}/theme.css`,
		];
		for (const p of candidates) {
			const content = await readVaultFile(plugin, p);
			if (content) return { content, name: themeName };
		}
	}

	// cssTheme empty but a theme may still be installed — try best-effort.
	const themes = await listVaultThemes(plugin);
	if (themes.length === 1) {
		const only = themes[0];
		const content = await readVaultFile(
			plugin,
			`.obsidian/themes/${only}/theme.css`,
		);
		if (content) return { content, name: only };
	}
	// Prefer first non-empty theme.css when multiple installed and no cssTheme.
	for (const only of themes) {
		const content = await readVaultFile(
			plugin,
			`.obsidian/themes/${only}/theme.css`,
		);
		if (content) return { content, name: only };
	}
	return { content: '', name: null };
}

/**
 * Read core Obsidian CSS (app.css) if available.
 */
async function collectCoreCss(plugin: Plugin): Promise<string> {
	try {
		const url = 'app://obsidian.md/app.css';
		const res = await fetch(url);
		if (res.ok) return await res.text();
	} catch {
		// ignore
	}
	return '';
}

/**
 * Collect styles.css from active community plugins (if present).
 * Obsidian injects plugin styles automatically; we re-collect for static package.
 */
async function collectActivePluginStyles(plugin: Plugin): Promise<string> {
	const parts: string[] = [];
	try {
		const raw = await readVaultFile(plugin, '.obsidian/community-plugins.json');
		if (!raw) return '';
		const ids = JSON.parse(raw) as string[];
		if (!Array.isArray(ids)) return '';
		for (const id of ids) {
			if (typeof id !== 'string' || !id.trim()) continue;
			const content = await readVaultFile(
				plugin,
				`.obsidian/plugins/${id}/styles.css`,
			);
			if (content && content.trim()) {
				parts.push(`/* plugin: ${id} */\n${content}`);
			}
		}
	} catch {
		// ignore
	}
	return parts.join('\n\n');
}

/**
 * Collect live theme + plugin CSS sheets (excluding app.css if already collected).
 * Prefer CSSOM (applied theme), then fall back to inline <style> tags.
 */
function collectLiveSheets(): string {
	const parts: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		try {
			if (sheet.href && sheet.href.includes('app.css')) continue;
			if (sheet.cssRules) {
				for (const rule of Array.from(sheet.cssRules)) {
					parts.push(rule.cssText);
				}
			}
		} catch {
			// CORS / restricted stylesheet — try href-less rule extraction via textContent if available
			try {
				// Some engines expose cssText even when cssRules is blocked.
				const anySheet = sheet as CSSStyleSheet & { cssText?: string };
				if (anySheet.cssText && anySheet.cssText.trim().length > 0) {
					parts.push(anySheet.cssText);
				}
			} catch {
				// ignore
			}
		}
	}
	// Obsidian may inject theme CSS as a <style> tag (not always exposed via CSSOM)
	for (const styleEl of Array.from(document.querySelectorAll('style'))) {
		const text = styleEl.textContent?.trim();
		if (text && text.length > 0) {
			parts.push(text);
		}
	}
	return parts.join('\n\n');
}

/**
 * Copy a vault-relative path into assets/, return rewritten path.
 */
async function copyAsset(
	plugin: Plugin,
	assetPath: string,
	assetsDir: string,
	assetsMap: Map<string, string>,
): Promise<{ outPath: string; destAbs: string }> {
	const abs = resolveVaultPath(plugin, assetPath);
	if (!(await plugin.app.vault.adapter.exists(abs))) {
		throw new Error(`asset missing: ${assetPath}`);
	}
	const destName = path.basename(assetPath).replace(/[^\w.\-]/g, '_');
	const destRel = path.join('assets', destName);
	const destAbs = path.join(assetsDir, destName);
	const content = await plugin.app.vault.adapter.read(abs);
	await fs.promises.writeFile(destAbs, content);
	assetsMap.set(assetPath, destRel);
	return { outPath: destRel, destAbs };
}

/**
 * Rewrite CSS url(...) paths into assets/.
 * Themes often use vault-relative public/ paths (e.g. public/fonts/...) that
 * resolve relative to the theme folder, not the vault root.
 */
function rewriteCssUrls(
	css: string,
	assetsMap: Map<string, string>,
	themeAssetHints: string[] = [],
): string {
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, rawUrl: string) => {
		const clean = rawUrl.trim();
		if (clean.startsWith('data:') || clean.startsWith('blob:') || clean.startsWith('http')) {
			return full;
		}
		// Absolute path from root
		if (clean.startsWith('/')) return full;

		// Try exact match
		if (assetsMap.has(clean)) {
			return `url(${assetsMap.get(clean)})`;
		}
		// Basename match
		const base = path.basename(clean);
		for (const [k, v] of assetsMap) {
			if (path.basename(k) === base) {
				return `url(${v})`;
			}
		}
		// Theme-relative public/ hints (public/fonts/...) — map to theme folder assets
		for (const hint of themeAssetHints) {
			const hintBase = path.basename(hint);
			if (clean === hint || clean.endsWith(`/${hintBase}`) || clean.endsWith(hintBase)) {
				if (assetsMap.has(hint)) {
					return `url(${assetsMap.get(hint)})`;
				}
			}
			// public/fonts/... relative to theme folder (clean starts with public/)
			if (clean.startsWith('public/') && assetsMap.has(clean)) {
				return `url(${assetsMap.get(clean)})`;
			}
		}
		// Theme asset path may be stored as vault-relative public/...
		if (clean.startsWith('public/') && assetsMap.has(clean)) {
			return `url(${assetsMap.get(clean)})`;
		}
		return full;
	});
}

/**
 * Export Theme Snapshot (theme + snippets + vars + fonts + core + plugins).
 * Matches the Phase 1–2 pipeline of obsidian-preview.md.
 *
 * @param assetsDir Directory where asset files are written. Must be under the
 *   packaged preview root so static server can resolve rewritten URLs.
 */
export async function exportThemeSnapshot(
	plugin: Plugin,
	assetsDir: string = path.join(os.tmpdir(), 'mdf-obsidian-preview-assets'),
): Promise<ThemeSnapshot> {
	const appearance = await collectAppearance(plugin);
	const coreCss = await collectCoreCss(plugin);
	const liveSheets = collectLiveSheets();
	const vars = collectCssVars();
	const pluginStyles = await collectActivePluginStyles(plugin);

	// Prefer vault theme.css (self-contained). Live CSSOM may be incomplete
	// (CORS, missing rules, empty when theme not selected).
	const themeName = appearance.themeName || null;
	const themeFileCss = await resolveThemeCssFile(plugin, themeName);
	// Prefer theme file; fall back to live sheets. Live sheets alone often miss
	// theme CSS when appearance.cssTheme is empty or theme not selected.
	const themeCss = themeFileCss.content || liveSheets;
	const snippetsCss = appearance.snippets.join('\n\n');

	// Assets: scan CSS for fonts/images (relative). Prefer vault-relative
	// public/ paths first (theme fonts often use theme-root-relative URLs).
	const allCss = [coreCss, themeCss, snippetsCss, pluginStyles].join('\n');
	const urls = [...new Set(collectCssUrls(allCss))];
	await fs.promises.mkdir(assetsDir, { recursive: true });
	const assetsMap = new Map<string, string>();
	const assets: ThemeSnapshot['assets'] = [];

	// Theme folder-relative assets: public/fonts/... under .obsidian/themes/
	const themePublicHints = new Set<string>();
	if (themeFileCss.name) {
		for (const u of urls) {
			if (u.startsWith('public/') || u.includes('/public/')) {
				themePublicHints.add(u);
			}
		}
	}

	for (const u of urls) {
		// Skip absolute / already data
		if (u.startsWith('/') || u.startsWith('http') || u.startsWith('data:')) continue;
		const copied = await copyAssetBestEffort(
			plugin,
			u,
			assetsDir,
			assetsMap,
			themeFileCss.name,
			themePublicHints,
		);
		if (copied) {
			assets.push({
				relativePath: copied.outPath,
				absolutePath: copied.destAbs,
			});
		}
	}

	const themeRewritten = rewriteCssUrls(themeCss, assetsMap, [
		...themePublicHints,
	]);
	const snippetsRewritten = rewriteCssUrls(snippetsCss, assetsMap);
	const coreRewritten = rewriteCssUrls(coreCss, assetsMap);
	const pluginsRewritten = rewriteCssUrls(pluginStyles, assetsMap);

	const snapshot: ThemeSnapshot = {
		generatedAt: Date.now(),
		sourceTheme: themeName,
		hasSnippets: snippetsCss.length > 0,
		appearance: appearance.appearance,
		css: {
			theme: themeRewritten,
			snippets: snippetsRewritten,
			vars,
			core: coreRewritten,
			plugins: pluginsRewritten,
		},
		assets,
		manifest: {
			name: themeName || 'Obsidian',
			version: '1.0.0',
			generatedAt: Date.now(),
			sourceTheme: themeName,
			hasSnippets: snippetsCss.length > 0,
			assetCount: assets.length,
		},
	};
	return snapshot;
}

/**
 * Resolve and copy a CSS asset into assetsDir, best-effort.
 * Tries vault-relative path, theme-relative public/, then app origin.
 */
async function copyAssetBestEffort(
	plugin: Plugin,
	assetPath: string,
	assetsDir: string,
	assetsMap: Map<string, string>,
	themeName: string | null,
	themePublicHints: Set<string>,
): Promise<{ outPath: string; destAbs: string } | null> {
	// Already mapped?
	if (assetsMap.has(assetPath)) {
		return {
			outPath: assetsMap.get(assetPath)!,
			destAbs: path.join(assetsDir, path.basename(assetsMap.get(assetPath)!)),
		};
	}

	// 1) Vault-relative (absolute path within vault)
	try {
		const copied = await copyAsset(plugin, assetPath, assetsDir, assetsMap);
		return { outPath: copied.outPath, destAbs: copied.destAbs };
	} catch {
		// continue
	}

	// 2) Theme folder-relative public/ path
	if (themeName) {
		const themeRel = `.obsidian/themes/${themeName}/${assetPath.replace(/^public\//, '')}`;
		try {
			const copied = await copyAsset(plugin, themeRel, assetsDir, assetsMap);
			assetsMap.set(assetPath, copied.outPath);
			assetsMap.set(themeRel, copied.outPath);
			return { outPath: copied.outPath, destAbs: copied.destAbs };
		} catch {
			// continue
		}
	}

	// 3) Theme-relative public/ from themePublicHints
	for (const hint of themePublicHints) {
		if (assetPath === hint || assetPath.endsWith(path.basename(hint))) {
			const themeRel = `.obsidian/themes/${themeName}/${assetPath}`;
			try {
				const copied = await copyAsset(plugin, themeRel, assetsDir, assetsMap);
				assetsMap.set(assetPath, copied.outPath);
				assetsMap.set(themeRel, copied.outPath);
				return { outPath: copied.outPath, destAbs: copied.destAbs };
			} catch {
				// continue
			}
		}
	}

	// 4) App-origin (Obsidian core fonts)
	try {
		const url = `app://obsidian.md/${assetPath}`;
		const res = await fetch(url);
		if (res.ok) {
			const buf = Buffer.from(await res.arrayBuffer());
			const destName = path.basename(assetPath).replace(/[^\w.\-]/g, '_');
			const destRel = path.join('assets', destName);
			const destAbs = path.join(assetsDir, destName);
			await fs.promises.writeFile(destAbs, buf);
			assetsMap.set(assetPath, destRel);
			return { outPath: destRel, destAbs };
		}
	} catch {
		// ignore
	}

	return null;
}

/**
 * Write Theme Snapshot to disk for offline preview.
 */
export async function writeThemeSnapshot(
	snapshotDir: string,
	snapshot: ThemeSnapshot,
): Promise<{
	themeCssPath: string;
	snippetsCssPath: string;
	varsCssPath: string;
	coreCssPath: string;
	manifestPath: string;
}> {
	await fs.promises.mkdir(snapshotDir, { recursive: true });
	const themeCssPath = path.join(snapshotDir, 'theme.css');
	const snippetsCssPath = path.join(snapshotDir, 'snippets.css');
	const varsCssPath = path.join(snapshotDir, 'vars.css');
	const coreCssPath = path.join(snapshotDir, 'obsidian-core.css');
	const manifestPath = path.join(snapshotDir, 'manifest.json');

	await fs.promises.writeFile(themeCssPath, snapshot.css.theme);
	await fs.promises.writeFile(snippetsCssPath, snapshot.css.snippets);
	await fs.promises.writeFile(varsCssPath, snapshot.css.vars);
	await fs.promises.writeFile(coreCssPath, snapshot.css.core);
	await fs.promises.writeFile(
		manifestPath,
		JSON.stringify(snapshot.manifest, null, 2),
	);
	return {
		themeCssPath,
		snippetsCssPath,
		varsCssPath,
		coreCssPath,
		manifestPath,
	};
}

/**
 * Resolve theme classes for packaging (live body + theme defaults).
 */
export function resolveThemeClassBundle(
	plugin: Plugin,
	themeCss: string,
): ThemeClassBundle {
	const preferDark = preferDarkMode();
	const live = detectThemeClasses(themeCss);
	const classSelect = detectClassSelectFlavor(themeCss, preferDark);
	// Prefer live classes; merge class-select defaults when missing
	const all = [...new Set([...live, ...classSelect])];
	// Ensure theme-light/dark always present
	if (!all.some((c) => c === 'theme-light' || c === 'theme-dark')) {
		all.unshift(preferDark ? 'theme-dark' : 'theme-light');
	}
	return {
		themeClassAttr: all.join(' '),
		preferDark,
		sourceTheme: null,
	};
}

/**
 * Render a single note with Obsidian MarkdownRenderer.
 */
export async function renderNoteWithObsidian(
	plugin: Plugin,
	file: TFile,
	source: string,
	themeClasses: string[] = [],
): Promise<{ html: string; title: string }> {
	const classes = themeClasses.length
		? themeClasses.join(' ')
		: detectThemeClasses().join(' ');
	const container = document.createElement('div');
	container.className = `markdown-preview-view markdown-rendered ${classes}`.trim();
	// Append to body so theme classes on container inherit from body styles
	if (!document.body.contains(container)) {
		document.body.appendChild(container);
	}
	try {
		await ObsidianMarkdownRenderer.render(
			plugin.app,
			source,
			container,
			file.path,
			plugin,
		);
		// Wait for plugin-rendered content (dataview etc.)
		await new Promise((r) => setTimeout(r, 120));
		// If container is still empty after render, wait a bit more for async plugins
		if (!container.innerHTML.trim()) {
			await new Promise((r) => setTimeout(r, 300));
		}
		return {
			html: container.innerHTML,
			title: file.basename,
		};
	} finally {
		if (container.parentNode) container.parentNode.removeChild(container);
	}
}

/** Keep previous independent servers for stop when regenerating preview. */
const activeServers: Array<{ url: string; stop: () => void }> = [];

export function stopAllLocalPreviewServers(): void {
	for (const s of activeServers.splice(0)) {
		try {
			s.stop();
		} catch {
			// ignore
		}
	}
}

export type FaithfulPackageResult = {
	rootDir: string;
	htmlPath: string;
	snapshotPath: string;
};

/**
 * Write a single-note faithful static package into `absRoot`
 * (Theme Snapshot + MarkdownRenderer). Used by both tmp preview and
 * Foundry `projects/<name>/public/`.
 */
export async function writeFaithfulPackage(
	plugin: Plugin,
	opts: LocalPreviewOptions & { absRoot: string },
): Promise<FaithfulPackageResult> {
	const { file, absRoot } = opts;
	await fs.promises.mkdir(absRoot, { recursive: true });

	const assetsDir = path.join(absRoot, 'assets');
	const snapshot = await exportThemeSnapshot(plugin, assetsDir);
	const snapshotDir = path.join(absRoot, 'theme-snapshot');
	await writeThemeSnapshot(snapshotDir, snapshot);

	const source = await plugin.app.vault.read(file);
	const themeClasses = detectThemeClasses(snapshot.css.theme);
	const preferDark = preferDarkMode();
	const classSelect = detectClassSelectFlavor(snapshot.css.theme, preferDark);
	const allThemeClasses = [...new Set([...themeClasses, ...classSelect])];
	const themeClassAttr = allThemeClasses.join(' ');

	const rendered = await renderNoteWithObsidian(plugin, file, source, allThemeClasses);

	const contentInner = `
  <div class="obsidian-content-wrapper">
    <div class="markdown-preview-view markdown-rendered ${escapeHtml(themeClassAttr)}">
      ${rendered.html}
    </div>
  </div>
  <footer class="mdfriday-built-with">
    Built with <a href="https://mdfriday.com" target="_blank" rel="noopener noreferrer">MDFriday</a>
  </footer>`;

	const password = (opts.password || '').trim();
	let bodyMain = contentInner;
	let encryptHead = '';
	if (password) {
		const encrypted = encryptAESGCM(password, contentInner);
		const gate = buildEncryptGateHtml({
			encryptedBase64: encrypted,
			level: 'page',
			path: '/',
			titleZh: '这篇笔记已加密，请输入密码解锁。',
		});
		bodyMain = gate.bodyInner;
		encryptHead = gate.headExtra;
	}

	const indexHtmlPath = path.join(absRoot, 'index.html');
	// Scroll fix: app.css / theme often set html,body { height:100% }
	// and .markdown-preview-view { height:100%; overflow-y:auto }.
	// Force document-level scrolling for the static package.
	const html = `
<!DOCTYPE html>
<html lang="zh-cn" class="${escapeHtml(themeClassAttr)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(rendered.title)} · MDFriday</title>
  ${encryptHead}
  <style>
/* core */
${snapshot.css.core}
/* theme */
${snapshot.css.theme}
/* snippets */
${snapshot.css.snippets}
/* plugin styles */
${snapshot.css.plugins}
/* vars */
${snapshot.css.vars}
/* page */
.obsidian-content-wrapper {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem;
  font-size: 16px;
}
.markdown-preview-view.markdown-rendered {
  line-height: 1.6;
}
.markdown-preview-view.markdown-rendered img {
  max-width: 100%;
  height: auto;
}
.mdfriday-built-with {
  margin: 3rem auto 2rem;
  max-width: 720px;
  text-align: center;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  color: var(--text-muted, #888);
  opacity: 0.85;
}
.mdfriday-built-with a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid currentColor;
  opacity: 0.9;
}
.mdfriday-built-with a:hover {
  opacity: 1;
}

  </style>
</head>
<body style="overflow: auto; -webkit-user-select: text; -moz-user-select: text; user-select: text;" class="${escapeHtml(themeClassAttr)}">
  ${bodyMain}
</body>
</html>
`;
	await fs.promises.writeFile(indexHtmlPath, html);

	return {
		rootDir: absRoot,
		htmlPath: indexHtmlPath,
		snapshotPath: snapshotDir,
	};
}

/**
 * Faithful build into a Foundry project `public/` directory.
 * Clears existing public contents so preview/publish share one artifact.
 */
export async function buildFaithfulToProject(
	plugin: Plugin,
	opts: LocalPreviewOptions & { publicDir: string },
): Promise<FaithfulPackageResult> {
	const { file, publicDir } = opts;
	await fs.promises.rm(publicDir, { recursive: true, force: true });
	return writeFaithfulPackage(plugin, { file, absRoot: publicDir, title: opts.title });
}

/**
 * Package a single note into tmpdir + local static server (dev convenience).
 * Prefer buildFaithfulToProject for preview/publish that must share Foundry public/.
 */
export async function packageSingleNotePreview(
	plugin: Plugin,
	opts: LocalPreviewOptions,
): Promise<LocalPreviewResult> {
	const { file } = opts;
	const absRoot = path.join(
		os.tmpdir(),
		`mdf-local-preview-${createHash('sha1')
			.update(`${file.path}-${Date.now()}`)
			.digest('hex')
			.slice(0, 10)}`,
	);
	const packaged = await writeFaithfulPackage(plugin, { file, absRoot, title: opts.title });
	const server = await startStaticServer(packaged.rootDir);
	activeServers.push(server);
	return {
		url: server.url,
		rootDir: packaged.rootDir,
		htmlPath: packaged.htmlPath,
		snapshotPath: packaged.snapshotPath,
	};
}

/**
 * Serve an existing directory (e.g. Foundry project public/) with a static server.
 */
export async function serveFaithfulPublicDir(
	publicDir: string,
): Promise<{ url: string; stop: () => void }> {
	stopAllLocalPreviewServers();
	const server = await startStaticServer(publicDir);
	activeServers.push(server);
	return server;
}

/**
 * Start an independent local static server for Obsidian preview.
 * Uses require('http') — dynamic import('http') fails in Obsidian plugin runtime.
 */
export async function startStaticServer(
	dir: string,
): Promise<{ url: string; stop: () => void }> {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const http = require('http') as typeof import('http');
	const server = http.createServer((req, res) => {
		try {
			const urlPath = (req.url || '/').split('?')[0];
			let target = path.join(dir, decodeURIComponent(urlPath));
			// Prevent path traversal
			if (!target.startsWith(dir)) {
				res.writeHead(403);
				res.end('Forbidden');
				return;
			}
			if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
				// Default to index.html for root
				if (urlPath === '/' || urlPath === '') {
					target = path.join(dir, 'index.html');
				} else {
					res.writeHead(404);
					res.end('Not found');
					return;
				}
			}
			if (!fs.existsSync(target)) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const ext = path.extname(target).toLowerCase();
			const mimeMap: Record<string, string> = {
				'.html': 'text/html; charset=utf-8',
				'.css': 'text/css; charset=utf-8',
				'.js': 'application/javascript',
				'.json': 'application/json',
				'.png': 'image/png',
				'.jpg': 'image/jpeg',
				'.jpeg': 'image/jpeg',
				'.svg': 'image/svg+xml',
				'.gif': 'image/gif',
				'.webp': 'image/webp',
				'.woff': 'font/woff',
				'.woff2': 'font/woff2',
				'.ttf': 'font/ttf',
				'.otf': 'font/otf',
				'.txt': 'text/plain; charset=utf-8',
			};
			const contentType = mimeMap[ext] || 'application/octet-stream';
			res.writeHead(200, {
				'Content-Type': contentType,
				'Cache-Control': 'no-cache',
			});
			fs.createReadStream(target).pipe(res);
		} catch (e) {
			res.writeHead(500);
			res.end(String(e));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as { port: number };
	const url = `http://127.0.0.1:${address.port}/`;
	return {
		url,
		stop: () => server.close(),
	};
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * @deprecated Phase 1.5 — obsidian-tag local render removed.
 * Single-note look-alike is PublishMode=faithful; themed always uses Foundry SSG.
 */
export function isObsidianThemeMode(_tags: string[] = []): boolean {
	return false;
}

/** @deprecated Phase 1.5 — always true for themed builds */
export function isFoundryThemeMode(_tags: string[] = []): boolean {
	return true;
}

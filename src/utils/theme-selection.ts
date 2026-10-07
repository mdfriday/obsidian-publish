import type { CatalogEntry } from '../theme/types';

/**
 * Folder (wiki) skins shown in the publish picker.
 * Catalog `kinds: ["wiki"]` alone is too broad (book / notebook also tag wiki);
 * ship only the supported Obsidian-folder families.
 */
export const FOLDER_WIKI_THEME_SLUGS = [
	'quartz',
	'creator',
	'flint',
	'jasper',
] as const;

/** Folder publish: allowlisted wiki skins only (quartz / creator / flint / jasper). */
export function isFolderWikiTheme(theme: CatalogEntry): boolean {
	const family = (theme.family || '').toLowerCase();
	const slug = (theme.slug || '').toLowerCase();
	return (FOLDER_WIKI_THEME_SLUGS as readonly string[]).some(
		(id) => family === id || slug === id,
	);
}

/** Sidebar theme list: notes family for a single note; allowlisted wiki themes for a folder. */
export function filterThemesForSelection(
	themes: CatalogEntry[],
	kind: 'note' | 'folder',
): CatalogEntry[] {
	const withPack = themes.filter((t) => !!t.packUrl);
	if (kind === 'folder') {
		return withPack.filter(isFolderWikiTheme);
	}
	return withPack.filter((t) => (t.family || '').toLowerCase() === 'notes');
}

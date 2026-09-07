import type FridayPlugin from '../main';
import {themeApiService} from '../theme/themeApiService';
import type {CatalogEntry} from '../theme/types';

/** Default variant slugs — resolved against catalog at runtime. */
export const DEFAULT_THEME_SLUGS = {
	NOTE: 'paper',
	QUARTZ: 'quartz',
} as const;

/**
 * Themed builds always use Foundry's default MarkdownIt renderer.
 * Obsidian-tag local render was removed (Phase 1.5); use PublishMode=faithful instead.
 */
export function shouldUseInternalRenderer(_themeTags: readonly string[] = []): boolean {
	return true;
}

export async function resolveDefaultTheme(
	plugin: FridayPlugin,
	isFolder: boolean,
): Promise<CatalogEntry | null> {
	const slug = isFolder ? DEFAULT_THEME_SLUGS.QUARTZ : DEFAULT_THEME_SLUGS.NOTE;
	try {
		return await themeApiService.getThemeBySlug(slug, plugin);
	} catch (error) {
		console.warn('[theme] catalog unavailable for default theme:', error);
		return null;
	}
}

/** @deprecated use resolveDefaultTheme */
export function getDefaultTheme(isFolder: boolean) {
	const slug = isFolder ? DEFAULT_THEME_SLUGS.QUARTZ : DEFAULT_THEME_SLUGS.NOTE;
	return { slug, isFolder };
}

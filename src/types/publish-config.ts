/**
 * Path-scoped publish domain model (Phase 0).
 *
 * Entry points (inventory):
 * - file-menu → main.addPublishMenuItems → publishToWeb → Site.applyDefaultsAndPublish
 * - file-menu → addToPublishListMenuItem → openPublishPanel (config only)
 * - command publish-to-web / quick-share → same as above
 * - Site.startPublish → sidebar form state (mode / theme / password)
 *
 * Defaults (right-click direct publish):
 * - note  → mode=faithful, no theme, no password
 * - folder → mode=themed, default theme (quartz), no password
 *
 * Folder never uses faithful. Obsidian-tag local render is removed (Phase 1.5).
 */

import { DEFAULT_THEME_SLUGS } from '../utils/theme';

export type SelectionKind = 'note' | 'folder';

/** Single-note: faithful | themed. Folder: themed only. */
export type PublishMode = 'faithful' | 'themed';

export type AccountTier = 'guest' | 'free' | 'pro';

export interface PathPublishConfig {
	mode: PublishMode;
	/** Catalog slug; required when mode=themed */
	themeSlug?: string;
	/** Local flag only — plaintext submitted at publish time, not persisted */
	hasPasswordFlag?: boolean;
	updatedAt?: number;
}

export interface PublishRecord {
	url: string;
	publishedAt: number;
	mode: PublishMode;
	projectName: string;
	path?: string;
}

export function selectionKindFromContents(contents: {
	file?: unknown;
	folder?: unknown;
}[]): SelectionKind {
	const first = contents[0];
	if (first?.folder) return 'folder';
	return 'note';
}

/** Right-click / quick-publish defaults (ignore saved path config). */
export function getDefaultPublishConfig(kind: SelectionKind): PathPublishConfig {
	if (kind === 'folder') {
		return {
			mode: 'themed',
			themeSlug: DEFAULT_THEME_SLUGS.QUARTZ,
			hasPasswordFlag: false,
		};
	}
	return {
		mode: 'faithful',
		hasPasswordFlag: false,
	};
}

/** Folder is always themed; note may be either. */
export function coercePublishMode(
	kind: SelectionKind,
	mode: PublishMode | undefined,
): PublishMode {
	if (kind === 'folder') return 'themed';
	return mode === 'themed' ? 'themed' : 'faithful';
}

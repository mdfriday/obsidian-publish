import type {CatalogEntry, MdfridayThemeParams} from './types';

/** User / plugin keys preserved across theme switches. */
const PRESERVED_PARAM_KEYS = new Set([
	'branding',
	'password',
	'logo',
	'favicon',
	'disqusShortname',
	'autoPublish',
	'lastPublishUrl',
	'mdfriday',
]);

/**
 * Standard Base capability roots. Always replaced from the theme.
 * Keep aligned with theme-pack CAP_ACTIVATION_DEFAULTS.
 * Every other siteParams key is a customParam default: write only when absent.
 */
const THEME_CAPABILITY_PARAM_KEYS = new Set([
	'search',
	'explorer',
	'graph',
	'clipboard',
	'breadcrumbs',
	'readerMode',
	'toc',
	'llmCopy',
]);

export function entryToMdfridayParams(
	entry: CatalogEntry,
	userStatic?: Record<string, true>,
): MdfridayThemeParams {
	const params: MdfridayThemeParams = {
		family: entry.family,
		variant: entry.variant,
		version: entry.version,
	};
	if (userStatic && Object.keys(userStatic).length > 0) {
		params.userStatic = userStatic;
	}
	return params;
}

export function entryToModuleImport(entry: CatalogEntry): { path: string } {
	if (!entry.packUrl) {
		throw new Error(`Theme "${entry.slug}" is not entitled (${entry.lockReason ?? 'locked'})`);
	}
	return { path: entry.packUrl };
}

/**
 * Merge theme siteParams into existing config.params.
 * Capability keys always follow the theme. customParams fill only when the project
 * does not already have that key, so a user logo survives the next apply.
 * navLinks is not taken from the theme: Advanced cannot edit it yet, so new projects
 * default to []. Once a project already has navLinks (future UI), that value is kept.
 */
export function mergeThemeSiteParams(
	existingParams: Record<string, unknown> | undefined,
	entry: CatalogEntry,
	userStatic?: Record<string, true>,
): Record<string, unknown> {
	const prev = existingParams ?? {};
	const preserved: Record<string, unknown> = {};
	for (const key of PRESERVED_PARAM_KEYS) {
		if (key === 'mdfriday') continue;
		if (key in prev) preserved[key] = prev[key];
	}

	const prevMdfriday = (prev.mdfriday as Record<string, unknown> | undefined) ?? {};
	const mdfriday = entryToMdfridayParams(entry, userStatic) as unknown as Record<string, unknown>;
	// Keep prior userStatic when caller did not pass a fresh scan.
	if (!userStatic && prevMdfriday.userStatic) {
		mdfriday.userStatic = prevMdfriday.userStatic;
	}

	const siteParams = entry.siteParams ?? {};
	const params: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(siteParams)) {
		// Do not seed navLinks from the theme — plugin has no editor yet.
		if (key === 'navLinks') continue;
		if (THEME_CAPABILITY_PARAM_KEYS.has(key) || !(key in prev)) {
			params[key] = value;
		} else {
			params[key] = prev[key];
		}
	}
	for (const [key, value] of Object.entries(preserved)) {
		if (!(key in params)) params[key] = value;
	}
	params.mdfriday = mdfriday;
	// Default empty for new projects; keep whatever the project already stored
	// (today usually [], later whatever Advanced writes).
	params.navLinks = 'navLinks' in prev ? prev.navLinks : [];
	return params;
}

export function buildThemeConfigPatch(
	entry: CatalogEntry,
	userStatic?: Record<string, true>,
	existingParams?: Record<string, unknown>,
): {
	module: { imports: Array<{ path: string }> };
	params: Record<string, unknown>;
} {
	return {
		module: { imports: [entryToModuleImport(entry)] },
		params: mergeThemeSiteParams(existingParams, entry, userStatic),
	};
}

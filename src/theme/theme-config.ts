import type {CatalogEntry, MdfridayThemeParams} from './types';

/** User / plugin keys preserved across theme switches. */
const PRESERVED_PARAM_KEYS = new Set([
	'branding',
	'password',
	'favicon',
	'disqusShortname',
	'autoPublish',
	'lastPublishUrl',
	'mdfriday',
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
 * Drops previous theme capability / custom keys; keeps user preserved fields.
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
	return {
		...preserved,
		...siteParams,
		mdfriday,
	};
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

import type {CatalogEntry, MdfridayThemeParams} from './types';

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

export function buildThemeConfigPatch(
	entry: CatalogEntry,
	userStatic?: Record<string, true>,
): {
	module: { imports: Array<{ path: string }> };
	params: { mdfriday: MdfridayThemeParams };
} {
	return {
		module: { imports: [entryToModuleImport(entry)] },
		params: { mdfriday: entryToMdfridayParams(entry, userStatic) },
	};
}

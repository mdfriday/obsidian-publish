import type {CatalogEntry, MdfridayThemeParams} from './types';

export function entryToMdfridayParams(entry: CatalogEntry): MdfridayThemeParams {
	return {
		family: entry.family,
		variant: entry.variant,
		version: entry.version,
	};
}

export function entryToModuleImport(entry: CatalogEntry): { path: string } {
	if (!entry.packUrl) {
		throw new Error(`Theme "${entry.slug}" is not entitled (${entry.lockReason ?? 'locked'})`);
	}
	return { path: entry.packUrl };
}

export function buildThemeConfigPatch(entry: CatalogEntry): {
	module: { imports: Array<{ path: string }> };
	params: { mdfriday: MdfridayThemeParams };
} {
	return {
		module: { imports: [entryToModuleImport(entry)] },
		params: { mdfriday: entryToMdfridayParams(entry) },
	};
}

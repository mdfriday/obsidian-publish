/**
 * Catalog entry from GET /v1/theme-catalog (arch/19 §7.4).
 * Foundry downloads pack via module.imports.path; plugin does not fetch zips.
 */
export type ThemeAccess = 'free' | 'plan' | 'purchase';
export type LockReason = 'purchase_required' | 'plan_required' | null;

export interface CatalogEntry {
	slug: string;
	family: string;
	variant: string;
	name: string;
	tier: string;
	access: ThemeAccess;
	entitled: boolean;
	lockReason: LockReason;
	version: string;
	/** Canonical pack URL for Foundry — null when not entitled */
	packUrl: string | null;
	coverUrl?: string;
	demoUrl?: string;
	kinds: string[];
	tags: string[];
	official?: boolean;
	description?: string;
	thumbnail?: string;
}

/** @deprecated Use CatalogEntry */
export type ThemeItem = CatalogEntry;

export interface ThemeSearchResult {
	themes: CatalogEntry[];
	hasMore: boolean;
}

export interface MdfridayThemeParams {
	family: string;
	variant: string;
	version: string;
}

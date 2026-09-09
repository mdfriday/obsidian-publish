import type {CatalogEntry, LockReason, ThemeAccess} from './types';

export interface EntitlementContext {
	plan: string;
	tierGrants: Set<string>;
	themeEntitlements: Set<string>;
	tierEntitlements: Set<string>;
}

export interface EntitlementApiResponse {
	plan: string;
	tierGrants: string[];
	entitlements: Array<{ scope: string; ref: string }>;
}

/** Mirror §7.3 canUse — UI display only; download gate stays on server. */
export function canUse(
	ctx: EntitlementContext,
	entry: Pick<CatalogEntry, 'slug' | 'tier' | 'access'>,
): { entitled: boolean; lockReason: LockReason } {
	if (entry.access === 'free') {
		return { entitled: true, lockReason: null };
	}
	if (ctx.themeEntitlements.has(entry.slug)) {
		return { entitled: true, lockReason: null };
	}
	if (ctx.tierEntitlements.has(entry.tier)) {
		return { entitled: true, lockReason: null };
	}
	if (ctx.tierGrants.has(entry.tier)) {
		return { entitled: true, lockReason: null };
	}
	if (entry.access === 'purchase') {
		return { entitled: false, lockReason: 'purchase_required' };
	}
	return { entitled: false, lockReason: 'plan_required' };
}

export function entitlementContextFromApi(
	body: EntitlementApiResponse | null,
): EntitlementContext {
	const ctx: EntitlementContext = {
		plan: body?.plan ?? 'guest',
		tierGrants: new Set(body?.tierGrants ?? []),
		themeEntitlements: new Set(),
		tierEntitlements: new Set(),
	};
	for (const row of body?.entitlements ?? []) {
		if (row.scope === 'theme') ctx.themeEntitlements.add(row.ref);
		if (row.scope === 'tier') ctx.tierEntitlements.add(row.ref);
	}
	return ctx;
}

export interface PublicCatalogEntry {
	slug: string;
	family: string;
	variant: string;
	name: string;
	tier: string;
	access: ThemeAccess;
	priceCents?: number;
	version: string;
	coverUrl?: string;
	demoUrl?: string;
	kinds?: string[];
	tags?: string[];
	official?: boolean;
	userAssets?: Array<{
		id: string;
		path: string;
		label?: string;
		description?: string;
	}>;
	siteParams?: Record<string, unknown>;
}

export function mergePublicCatalogEntry(
	entry: PublicCatalogEntry,
	ctx: EntitlementContext,
	packUrl?: string | null,
): CatalogEntry {
	const { entitled, lockReason } = canUse(ctx, entry);
	return {
		slug: entry.slug,
		family: entry.family,
		variant: entry.variant,
		name: entry.name,
		tier: entry.tier,
		access: entry.access,
		entitled,
		lockReason,
		version: entry.version,
		packUrl: entitled ? packUrl ?? null : null,
		coverUrl: entry.coverUrl,
		demoUrl: entry.demoUrl,
		kinds: entry.kinds ?? [],
		tags: entry.tags ?? [],
		official: entry.official,
		userAssets: entry.userAssets,
		siteParams: entry.siteParams,
		description: entry.tags?.length ? entry.tags.join(' · ') : entry.name,
		thumbnail: entry.coverUrl,
	};
}

/**
 * Theme catalog — CDN public snapshot (C7) + API entitlement/packUrl merge.
 */

import {requestUrl} from 'obsidian';
import type {CatalogEntry, ThemeSearchResult} from './types';
import type FridayPlugin from '../main';
import {
	entitlementContextFromApi,
	mergePublicCatalogEntry,
	type PublicCatalogEntry,
} from './theme-entitlement';

interface ApiCatalogEntry extends PublicCatalogEntry {
	entitled?: boolean;
	lockReason?: string | null;
	packUrl?: string | null;
}

let catalogCache: CatalogEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_EXPIRY_MS = 2 * 60 * 60 * 1000;

function catalogApiBase(plugin?: FridayPlugin): string {
	const fromSettings = plugin?.settings.cloudflareApiBaseUrl?.trim();
	if (fromSettings) {
		return fromSettings.replace(/\/$/, '');
	}
	if (plugin?.licenseState?.getApiUrl()) {
		return plugin.licenseState.getApiUrl()!.replace(/\/$/, '');
	}
	return 'https://api.fsky.top';
}

function catalogCdnBase(apiBase: string): string {
	if (apiBase.includes('fsky.top') || apiBase.includes('127.0.0.1')) {
		return 'https://cdn.fsky.top';
	}
	return 'https://cdn.mdfriday.com';
}

function authHeaders(plugin?: FridayPlugin): Record<string, string> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	const token = plugin?.settings.mdfKey?.trim();
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

async function fetchPublicSnapshot(
	cdnBase: string,
): Promise<PublicCatalogEntry[]> {
	// Catalog objects use max-age=86400; Obsidian/Electron may serve a stale
	// snapshot without siteParams. Bust with timestamp + no-cache headers.
	const url = `${cdnBase}/meta/theme-catalog.json?_=${Date.now()}`;
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
		},
	});
	if (response.status !== 200) {
		throw new Error(`Theme catalog snapshot unavailable (${response.status}): ${url}`);
	}
	const body = response.json as { entries?: PublicCatalogEntry[] };
	if (!Array.isArray(body.entries)) {
		throw new Error('Invalid theme catalog snapshot');
	}
	return body.entries;
}

async function fetchApiPackMap(
	apiBase: string,
	plugin?: FridayPlugin,
): Promise<
	Map<
		string,
		{
			packUrl: string | null;
			entitled: boolean;
			lockReason: string | null;
			siteParams?: Record<string, unknown>;
		}
	>
> {
	const url = `${apiBase}/v1/theme-catalog?_=${Date.now()}`;
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: {
			...authHeaders(plugin),
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
		},
	});
	if (response.status !== 200) {
		return new Map();
	}
	const body = response.json as { entries?: ApiCatalogEntry[] };
	const map = new Map<
		string,
		{
			packUrl: string | null;
			entitled: boolean;
			lockReason: string | null;
			siteParams?: Record<string, unknown>;
		}
	>();
	for (const entry of body.entries ?? []) {
		map.set(entry.slug, {
			packUrl: entry.packUrl ?? null,
			entitled: entry.entitled !== false,
			lockReason: entry.lockReason ?? null,
			siteParams: entry.siteParams,
		});
	}
	return map;
}

async function fetchEntitlements(
	apiBase: string,
	plugin?: FridayPlugin,
) {
	const token = plugin?.settings.mdfKey?.trim();
	if (!token) return null;
	try {
		const response = await requestUrl({
			url: `${apiBase}/v1/me/theme-entitlements`,
			method: 'GET',
			headers: authHeaders(plugin),
		});
		if (response.status !== 200) return null;
		return response.json as {
			plan: string;
			tierGrants: string[];
			entitlements: Array<{ scope: string; ref: string }>;
		};
	} catch {
		return null;
	}
}

async function fetchCatalog(plugin?: FridayPlugin): Promise<CatalogEntry[]> {
	const apiBase = catalogApiBase(plugin);
	const cdnBase = catalogCdnBase(apiBase);

	let publicEntries: PublicCatalogEntry[];
	try {
		publicEntries = await fetchPublicSnapshot(cdnBase);
	} catch (cdnErr) {
		console.warn('[themeApiService] CDN snapshot failed, falling back to API:', cdnErr);
		const response = await requestUrl({
			url: `${apiBase}/v1/theme-catalog`,
			method: 'GET',
			headers: authHeaders(plugin),
		});
		if (response.status !== 200) {
			throw new Error(`Theme catalog unavailable (${response.status})`);
		}
		const body = response.json as { entries?: ApiCatalogEntry[] };
		if (!Array.isArray(body.entries)) {
			throw new Error('Invalid theme catalog response');
		}
		return body.entries.map((raw) =>
			mergePublicCatalogEntry(raw, entitlementContextFromApi(null), raw.packUrl ?? null),
		);
	}

	const [entBody, packMap] = await Promise.all([
		fetchEntitlements(apiBase, plugin),
		fetchApiPackMap(apiBase, plugin),
	]);
	const ctx = entitlementContextFromApi(entBody);

	return publicEntries.map((entry) => {
		const api = packMap.get(entry.slug);
		const merged = mergePublicCatalogEntry(entry, ctx, api?.packUrl ?? null);
		if (api) {
			merged.entitled = api.entitled;
			merged.lockReason = (api.lockReason as CatalogEntry['lockReason']) ?? null;
			if (api.entitled && api.packUrl) {
				merged.packUrl = api.packUrl;
			}
			// Prefer CDN siteParams; fall back to API if snapshot was stale/missing.
			if (
				(!merged.siteParams || Object.keys(merged.siteParams).length === 0) &&
				api.siteParams &&
				Object.keys(api.siteParams).length > 0
			) {
				merged.siteParams = api.siteParams;
			}
		}
		return merged;
	});
}

function filterThemes(
	themes: CatalogEntry[],
	searchTerm = '',
	selectedTags: string[] = [],
): CatalogEntry[] {
	let out = themes;
	if (searchTerm.trim()) {
		const term = searchTerm.trim().toLowerCase();
		out = out.filter(
			(t) =>
				t.name.toLowerCase().includes(term) ||
				t.slug.toLowerCase().includes(term) ||
				t.family.toLowerCase().includes(term) ||
				t.tags.some((tag) => tag.toLowerCase().includes(term)),
		);
	}
	if (selectedTags.length) {
		out = out.filter((t) =>
			selectedTags.every((sel) => t.tags.some((tag) => tag === sel)),
		);
	}
	return out;
}

export const themeApiService = {
	async initializeThemes(plugin?: FridayPlugin): Promise<void> {
		const now = Date.now();
		if (!catalogCache || now - cacheTimestamp > CACHE_EXPIRY_MS) {
			catalogCache = await fetchCatalog(plugin);
			cacheTimestamp = now;
		}
	},

	async getAllThemes(plugin?: FridayPlugin): Promise<CatalogEntry[]> {
		await this.initializeThemes(plugin);
		return catalogCache ?? [];
	},

	async searchThemes(
		page = 1,
		limit = 20,
		searchTerm = '',
		selectedTags: string[] = [],
		plugin?: FridayPlugin,
	): Promise<ThemeSearchResult> {
		await this.initializeThemes(plugin);
		const filtered = filterThemes(catalogCache ?? [], searchTerm, selectedTags);
		const start = (page - 1) * limit;
		const themes = filtered.slice(start, start + limit);
		return { themes, hasMore: start + limit < filtered.length };
	},

	async fetchThemes(
		page = 1,
		limit = 20,
		selectedTags: string[] = [],
		searchTerm = '',
		plugin?: FridayPlugin,
	): Promise<ThemeSearchResult> {
		return this.searchThemes(page, limit, searchTerm, selectedTags, plugin);
	},

	async fetchAllTags(plugin?: FridayPlugin): Promise<string[]> {
		const themes = await this.getAllThemes(plugin);
		return [...new Set(themes.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
	},

	async getThemeBySlug(slug: string, plugin?: FridayPlugin): Promise<CatalogEntry | null> {
		const themes = await this.getAllThemes(plugin);
		return themes.find((t) => t.slug === slug) ?? null;
	},

	async getThemeById(slug: string, plugin?: FridayPlugin): Promise<CatalogEntry | null> {
		return this.getThemeBySlug(slug, plugin);
	},

	async findByFamilyVariant(
		family: string,
		variant: string,
		plugin?: FridayPlugin,
	): Promise<CatalogEntry | null> {
		const themes = await this.getAllThemes(plugin);
		return themes.find((t) => t.family === family && t.variant === variant) ?? null;
	},

	async fetchThemeByName(name: string, plugin?: FridayPlugin): Promise<CatalogEntry | null> {
		const themes = await this.getAllThemes(plugin);
		const lower = name.toLowerCase();
		return themes.find((t) => t.name.toLowerCase() === lower) ?? null;
	},

	clearCache(): void {
		catalogCache = null;
		cacheTimestamp = 0;
	},
};

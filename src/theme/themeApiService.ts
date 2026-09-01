/**
 * Theme catalog — GET /v1/theme-catalog on the Cloudflare control plane.
 * Download/build: Foundry reads module.imports.path from config.json.
 */

import {requestUrl} from 'obsidian';
import type {CatalogEntry, ThemeSearchResult} from './types';
import type FridayPlugin from '../main';

interface RawCatalogEntry {
	slug: string;
	family: string;
	variant: string;
	name: string;
	tier: string;
	access: string;
	entitled: boolean;
	lockReason: string | null;
	version: string;
	packUrl: string | null;
	coverUrl?: string;
	demoUrl?: string;
	kinds?: string[];
	tags?: string[];
	official?: boolean;
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

function mapEntry(raw: RawCatalogEntry): CatalogEntry {
	return {
		slug: raw.slug,
		family: raw.family,
		variant: raw.variant,
		name: raw.name,
		tier: raw.tier,
		access: raw.access as CatalogEntry['access'],
		entitled: raw.entitled !== false,
		lockReason: (raw.lockReason as CatalogEntry['lockReason']) ?? null,
		version: raw.version,
		packUrl: raw.packUrl ?? null,
		coverUrl: raw.coverUrl,
		demoUrl: raw.demoUrl,
		kinds: raw.kinds ?? [],
		tags: raw.tags ?? [],
		official: raw.official,
		description: raw.tags?.length ? raw.tags.join(' · ') : raw.name,
		thumbnail: raw.coverUrl,
	};
}

async function fetchCatalog(plugin?: FridayPlugin): Promise<CatalogEntry[]> {
	const base = catalogApiBase(plugin);
	const url = `${base}/v1/theme-catalog?_t=${Date.now()}`;
	const response = await requestUrl({
		url,
		method: 'GET',
		headers: { Accept: 'application/json' },
	});

	if (response.status !== 200) {
		throw new Error(`Theme catalog unavailable (${response.status}): ${url}`);
	}

	const body = response.json as { entries?: RawCatalogEntry[] };
	if (!Array.isArray(body.entries)) {
		throw new Error('Invalid theme catalog response');
	}

	return body.entries.map(mapEntry);
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

	/** @deprecated use getThemeBySlug */
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

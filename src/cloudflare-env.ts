/**
 * Cloudflare env → API / Share / Account / CDN URLs.
 *
 * Env is compile-time only (no Settings switch):
 * - `npm run dev` / watch → staging (fsky.top)
 * - `npm run build` (production) → production (mdfriday.com)
 * - Override: `MDF_CF_ENV=local|staging|production npm run …`
 */

export type CloudflareEnvResolved = 'local' | 'staging' | 'production';

export interface CloudflareEndpoints {
	apiBaseUrl: string;
	publicBaseUrl: string;
	accountBaseUrl: string;
	/** Marketing / www origin (themes catalog, demos, brand link). */
	siteBaseUrl: string;
	/** Hosted Turnstile challenge (HTTPS). Empty for local (skip). */
	guestChallengeUrl: string;
	/** Theme / base static assets (pack chrome, encrypt gate, …). */
	cdnBaseUrl: string;
}

/** Injected by esbuild (`MDF_CF_ENV` or production→production / watch→staging). */
declare const __MDF_DEFAULT_CF_ENV__: string | undefined;

/**
 * Build-locked env. First install and every startup use this.
 * Injected by esbuild: watch → staging, production build → production.
 */
export const DEFAULT_CLOUDFLARE_ENV: CloudflareEnvResolved = normalizeResolvedEnv(
	typeof __MDF_DEFAULT_CF_ENV__ === 'string' ? __MDF_DEFAULT_CF_ENV__ : 'staging',
);

/** Canonical presets — edit hosts here only. */
export const CLOUDFLARE_ENV_PRESETS: Record<CloudflareEnvResolved, CloudflareEndpoints> = {
	local: {
		apiBaseUrl: 'http://127.0.0.1:8787',
		publicBaseUrl: 'http://127.0.0.1:8788',
		accountBaseUrl: 'http://127.0.0.1:8080/account',
		siteBaseUrl: 'http://127.0.0.1:8080',
		guestChallengeUrl: '',
		// Local Foundry still loads published theme chrome from staging CDN.
		cdnBaseUrl: 'https://cdn.fsky.top',
	},
	staging: {
		apiBaseUrl: 'https://api.fsky.top',
		publicBaseUrl: 'https://share.fsky.top',
		accountBaseUrl: 'https://fsky.top/account',
		siteBaseUrl: 'https://fsky.top',
		guestChallengeUrl: 'https://fsky.top/guest-challenge/',
		cdnBaseUrl: 'https://cdn.fsky.top',
	},
	production: {
		apiBaseUrl: 'https://api.mdfriday.com',
		publicBaseUrl: 'https://share.mdfriday.com',
		accountBaseUrl: 'https://mdfriday.com/account',
		siteBaseUrl: 'https://mdfriday.com',
		guestChallengeUrl: 'https://mdfriday.com/guest-challenge/',
		cdnBaseUrl: 'https://cdn.mdfriday.com',
	},
};

function normalizeResolvedEnv(raw: string): CloudflareEnvResolved {
	if (raw === 'local' || raw === 'staging' || raw === 'production') {
		return raw;
	}
	return 'staging';
}

export function endpointsForEnv(env: CloudflareEnvResolved): CloudflareEndpoints {
	return { ...CLOUDFLARE_ENV_PRESETS[env] };
}

type EnvSettings = {
	cloudflareAccountBaseUrl?: string;
	cloudflareApiBaseUrl?: string;
	cloudflarePublicBaseUrl?: string;
	cloudflareResolvedEnv?: CloudflareEnvResolved | null;
	/** @deprecated ignored — compile-time DEFAULT_CLOUDFLARE_ENV wins */
	cloudflareEnv?: string;
};

function resolvedFromSettings(settings: EnvSettings): CloudflareEnvResolved {
	if (
		settings.cloudflareResolvedEnv === 'local' ||
		settings.cloudflareResolvedEnv === 'staging' ||
		settings.cloudflareResolvedEnv === 'production'
	) {
		return settings.cloudflareResolvedEnv;
	}
	return DEFAULT_CLOUDFLARE_ENV;
}

/** Account base without trailing slash — always from presets when settings lag. */
export function resolveAccountBaseUrl(settings: EnvSettings): string {
	const fromSettings = settings.cloudflareAccountBaseUrl?.trim();
	if (fromSettings && !isStaleLocalAccountUrl(fromSettings, settings)) {
		return fromSettings.replace(/\/$/, '');
	}
	return endpointsForEnv(resolvedFromSettings(settings)).accountBaseUrl.replace(/\/$/, '');
}

/** Detect UI/settings stuck on localhost while env mode is remote. */
function isStaleLocalAccountUrl(url: string, settings: EnvSettings): boolean {
	const mode = resolvedFromSettings(settings);
	if (mode === 'local') return false;
	return /127\.0\.0\.1|localhost/i.test(url);
}

export function resolveApiBaseUrl(settings: EnvSettings): string {
	const fromSettings = settings.cloudflareApiBaseUrl?.trim();
	if (fromSettings) return fromSettings.replace(/\/$/, '');
	return endpointsForEnv(resolvedFromSettings(settings)).apiBaseUrl.replace(/\/$/, '');
}

export function resolvePublicBaseUrl(settings: EnvSettings): string {
	const fromSettings = settings.cloudflarePublicBaseUrl?.trim();
	if (fromSettings) return fromSettings.replace(/\/$/, '');
	return endpointsForEnv(resolvedFromSettings(settings)).publicBaseUrl.replace(/\/$/, '');
}

/** Theme CDN origin for base/family static assets (encrypt gate, pack chrome). */
export function resolveCdnBaseUrl(settings: EnvSettings): string {
	return endpointsForEnv(resolvedFromSettings(settings)).cdnBaseUrl.replace(/\/$/, '');
}

/** Marketing site origin (themes, demos, brand) for the compile-time / resolved env. */
export function resolveSiteBaseUrl(settings?: EnvSettings): string {
	const env = settings ? resolvedFromSettings(settings) : DEFAULT_CLOUDFLARE_ENV;
	return endpointsForEnv(env).siteBaseUrl.replace(/\/$/, '');
}

/**
 * Foundry log level mapped from compile-time Cloudflare env.
 * production → error (quiet for users); staging → info; local → debug.
 */
export type FoundryLogLevelName = 'debug' | 'info' | 'warn' | 'error';

export function logLevelForCloudflareEnv(
	env: CloudflareEnvResolved = DEFAULT_CLOUDFLARE_ENV,
): FoundryLogLevelName {
	switch (env) {
		case 'production':
			return 'error';
		case 'local':
			return 'debug';
		case 'staging':
		default:
			return 'info';
	}
}


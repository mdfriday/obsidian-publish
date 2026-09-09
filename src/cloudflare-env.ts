/**
 * Single place for Cloudflare env → API / Share / Account URLs.
 *
 * - Edit `CLOUDFLARE_ENV_PRESETS` for hostnames.
 * - Ship default comes from build (`npm run build` → staging).
 * - Override at build time: `MDF_CF_ENV=production npm run build`
 * - Runtime: Settings → Cloudflare environment (local | auto | staging | production).
 */

import { requestUrl } from 'obsidian';

export type CloudflareEnvMode = 'auto' | 'local' | 'staging' | 'production';
export type CloudflareEnvResolved = 'local' | 'staging' | 'production';

export interface CloudflareEndpoints {
  apiBaseUrl: string;
  publicBaseUrl: string;
  accountBaseUrl: string;
  /** Hosted Turnstile challenge (HTTPS). Empty for local (skip). */
  guestChallengeUrl: string;
  /** Theme / base static assets (pack chrome, encrypt gate, …). */
  cdnBaseUrl: string;
}

/** Injected by esbuild (`MDF_CF_ENV` or production→staging / watch→local). */
declare const __MDF_DEFAULT_CF_ENV__: string | undefined;

/**
 * First-install / DEFAULT_SETTINGS env mode.
 * Production builds default to staging; change via `MDF_CF_ENV=production npm run build`.
 */
export const DEFAULT_CLOUDFLARE_ENV: CloudflareEnvMode = normalizeEnvMode(
  typeof __MDF_DEFAULT_CF_ENV__ === 'string' ? __MDF_DEFAULT_CF_ENV__ : 'staging',
);

/** Canonical presets — edit hosts here only. */
export const CLOUDFLARE_ENV_PRESETS: Record<CloudflareEnvResolved, CloudflareEndpoints> = {
  local: {
    apiBaseUrl: 'http://127.0.0.1:8787',
    publicBaseUrl: 'http://127.0.0.1:8788',
    accountBaseUrl: 'http://127.0.0.1:8080/account',
    guestChallengeUrl: '',
    // Local Foundry still loads published theme chrome from staging CDN.
    cdnBaseUrl: 'https://cdn.fsky.top',
  },
  staging: {
    apiBaseUrl: 'https://api.fsky.top',
    publicBaseUrl: 'https://share.fsky.top',
    accountBaseUrl: 'https://fsky.top/account',
    guestChallengeUrl: 'https://fsky.top/guest-challenge/',
    cdnBaseUrl: 'https://cdn.fsky.top',
  },
  production: {
    apiBaseUrl: 'https://api.mdfriday.com',
    publicBaseUrl: 'https://share.mdfriday.com',
    accountBaseUrl: 'https://mdfriday.com/account',
    guestChallengeUrl: 'https://mdfriday.com/guest-challenge/',
    cdnBaseUrl: 'https://cdn.mdfriday.com',
  },
};

const LOCAL_HEALTH = `${CLOUDFLARE_ENV_PRESETS.local.apiBaseUrl}/v1/health`;

function normalizeEnvMode(raw: string): CloudflareEnvMode {
  if (raw === 'local' || raw === 'auto' || raw === 'staging' || raw === 'production') {
    return raw;
  }
  return 'staging';
}

/**
 * Resolve env mode to a concrete environment.
 * `auto`: prefer local when `npm run local` health responds, else staging.
 */
export async function resolveCloudflareEnv(
  mode: CloudflareEnvMode,
  probe: (url: string) => Promise<boolean> = probeLocalHealth,
): Promise<CloudflareEnvResolved> {
  if (mode === 'local' || mode === 'staging' || mode === 'production') {
    return mode;
  }
  const localUp = await probe(LOCAL_HEALTH);
  return localUp ? 'local' : 'staging';
}

export function endpointsForEnv(env: CloudflareEnvResolved): CloudflareEndpoints {
  return { ...CLOUDFLARE_ENV_PRESETS[env] };
}

/** Account base without trailing slash — always from presets when settings lag. */
export function resolveAccountBaseUrl(settings: {
  cloudflareAccountBaseUrl?: string;
  cloudflareResolvedEnv?: CloudflareEnvResolved | null;
  cloudflareEnv?: CloudflareEnvMode;
}): string {
  const fromSettings = settings.cloudflareAccountBaseUrl?.trim();
  if (fromSettings && !isStaleLocalAccountUrl(fromSettings, settings)) {
    return fromSettings.replace(/\/$/, '');
  }
  const resolved =
    settings.cloudflareResolvedEnv ||
    (settings.cloudflareEnv === 'local' ||
    settings.cloudflareEnv === 'staging' ||
    settings.cloudflareEnv === 'production'
      ? settings.cloudflareEnv
      : 'staging');
  return endpointsForEnv(resolved).accountBaseUrl.replace(/\/$/, '');
}

/** Detect UI/settings stuck on localhost while env mode is remote. */
function isStaleLocalAccountUrl(
  url: string,
  settings: { cloudflareEnv?: CloudflareEnvMode; cloudflareResolvedEnv?: CloudflareEnvResolved | null },
): boolean {
  const mode = settings.cloudflareResolvedEnv || settings.cloudflareEnv;
  if (mode === 'local') return false;
  return /127\.0\.0\.1|localhost/i.test(url);
}

export function resolveApiBaseUrl(settings: {
  cloudflareApiBaseUrl?: string;
  cloudflareResolvedEnv?: CloudflareEnvResolved | null;
  cloudflareEnv?: CloudflareEnvMode;
}): string {
  const fromSettings = settings.cloudflareApiBaseUrl?.trim();
  if (fromSettings) return fromSettings.replace(/\/$/, '');
  const resolved =
    settings.cloudflareResolvedEnv ||
    (settings.cloudflareEnv === 'local' ||
    settings.cloudflareEnv === 'staging' ||
    settings.cloudflareEnv === 'production'
      ? settings.cloudflareEnv
      : 'staging');
  return endpointsForEnv(resolved).apiBaseUrl.replace(/\/$/, '');
}

export function resolvePublicBaseUrl(settings: {
  cloudflarePublicBaseUrl?: string;
  cloudflareResolvedEnv?: CloudflareEnvResolved | null;
  cloudflareEnv?: CloudflareEnvMode;
}): string {
  const fromSettings = settings.cloudflarePublicBaseUrl?.trim();
  if (fromSettings) return fromSettings.replace(/\/$/, '');
  const resolved =
    settings.cloudflareResolvedEnv ||
    (settings.cloudflareEnv === 'local' ||
    settings.cloudflareEnv === 'staging' ||
    settings.cloudflareEnv === 'production'
      ? settings.cloudflareEnv
      : 'staging');
  return endpointsForEnv(resolved).publicBaseUrl.replace(/\/$/, '');
}

/** Theme CDN origin for base/family static assets (encrypt gate, pack chrome). */
export function resolveCdnBaseUrl(settings: {
  cloudflareResolvedEnv?: CloudflareEnvResolved | null;
  cloudflareEnv?: CloudflareEnvMode;
}): string {
  const resolved =
    settings.cloudflareResolvedEnv ||
    (settings.cloudflareEnv === 'local' ||
    settings.cloudflareEnv === 'staging' ||
    settings.cloudflareEnv === 'production'
      ? settings.cloudflareEnv
      : 'staging');
  return endpointsForEnv(resolved).cdnBaseUrl.replace(/\/$/, '');
}

/** Use Obsidian requestUrl — browser fetch from app://obsidian.md is CORS-blocked. */
async function probeLocalHealth(url: string): Promise<boolean> {
  try {
    const res = await requestUrl({
      url,
      method: 'GET',
      throw: false,
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

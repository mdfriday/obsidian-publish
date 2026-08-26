/**
 * Single place for Cloudflare env → API / Share / Account URLs.
 * Plugin settings only pick an environment mode; endpoints are derived here.
 */

import { requestUrl } from 'obsidian';

export type CloudflareEnvMode = 'auto' | 'local' | 'staging' | 'production';
export type CloudflareEnvResolved = 'local' | 'staging' | 'production';

export interface CloudflareEndpoints {
  apiBaseUrl: string;
  publicBaseUrl: string;
  accountBaseUrl: string;
}

/** Canonical presets — edit here, not in settings fields. */
export const CLOUDFLARE_ENV_PRESETS: Record<CloudflareEnvResolved, CloudflareEndpoints> = {
  local: {
    apiBaseUrl: 'http://127.0.0.1:8787',
    publicBaseUrl: 'http://127.0.0.1:8788',
    accountBaseUrl: 'http://127.0.0.1:8080/account',
  },
  staging: {
    apiBaseUrl: 'https://api.fsky.top',
    publicBaseUrl: 'https://share.fsky.top',
    accountBaseUrl: 'https://mdfriday.com/account',
  },
  production: {
    apiBaseUrl: 'https://api.mdfriday.com',
    publicBaseUrl: 'https://share.mdfriday.com',
    accountBaseUrl: 'https://mdfriday.com/account',
  },
};

const LOCAL_HEALTH = `${CLOUDFLARE_ENV_PRESETS.local.apiBaseUrl}/v1/health`;

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

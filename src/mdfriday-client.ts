/**
 * X-MDFriday-Client header for requests to the MDFriday API.
 *
 * Value: `obsidian-publish/<manifest version>` (plugin name + version only, no personal data).
 * Only attached to MDFriday API origins (api.mdfriday.com, staging, local dev) — never to
 * third-party hosts such as R2 SigV4 uploads or CDN theme packs, where an extra header
 * could break request signing.
 */

import { CLOUDFLARE_ENV_PRESETS } from './cloudflare-env';

export const MDFRIDAY_CLIENT_HEADER = 'X-MDFriday-Client';
const CLIENT_NAME = 'obsidian-publish';

let clientHeaderValue: string | null = null;
const apiOrigins = new Set<string>(
	Object.values(CLOUDFLARE_ENV_PRESETS)
		.map((e) => originOf(e.apiBaseUrl))
		.filter((o): o is string => !!o),
);

function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/** Call once on plugin load with `this.manifest.version`. */
export function setMdfridayClientVersion(version: string): void {
	const v = (version || '').trim();
	clientHeaderValue = v ? `${CLIENT_NAME}/${v}` : null;
}

/** Register the active API base URL (in case it differs from the presets). */
export function registerMdfridayApiBaseUrl(apiBaseUrl: string | undefined | null): void {
	if (!apiBaseUrl) return;
	const origin = originOf(apiBaseUrl.trim());
	if (origin) apiOrigins.add(origin);
}

export function isMdfridayApiUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (!apiOrigins.has(parsed.origin)) return false;
	// Local dev R2 proxy on the API origin is S3-shaped (SigV4 requests) — leave untouched.
	return !parsed.pathname.startsWith('/v1/dev/r2/');
}

/**
 * Return headers with X-MDFriday-Client added when `url` targets the MDFriday API.
 * Other URLs get the headers back unchanged (same object, possibly undefined).
 */
export function withMdfridayClientHeader(
	url: string,
	headers?: Record<string, string>,
): Record<string, string> | undefined {
	if (!clientHeaderValue || !isMdfridayApiUrl(url)) return headers;
	const out: Record<string, string> = { ...(headers ?? {}) };
	const exists = Object.keys(out).some((k) => k.toLowerCase() === MDFRIDAY_CLIENT_HEADER.toLowerCase());
	if (!exists) out[MDFRIDAY_CLIENT_HEADER] = clientHeaderValue;
	return out;
}

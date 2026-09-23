/** Theme pack default. Not a user file; templates load it from the CDN. */
export const THEME_DEFAULT_BRAND = 'favicon.svg';

/**
 * Vault-relative brand path safe to copy under project static/.
 * The bare theme default is not a user override.
 */
export function userBrandPath(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const rel = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
	if (!rel || rel === THEME_DEFAULT_BRAND) return null;
	if (rel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null;
	return rel;
}

/** Value shown in the advanced field. Theme default renders as empty. */
export function brandPathForUi(value: unknown): string {
	return userBrandPath(value) ?? '';
}

export function brandPathsFromParams(
	params: Record<string, unknown> | undefined,
): string[] {
	if (!params) return [];
	const out: string[] = [];
	for (const key of ['logo', 'favicon'] as const) {
		const rel = userBrandPath(params[key]);
		if (rel && !out.includes(rel)) out.push(rel);
	}
	return out;
}

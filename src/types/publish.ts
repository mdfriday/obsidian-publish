/**
 * Publish method — Cloudflare V2 only (M1 Guest).
 */
export type PublishMethod = 'cloudflare';

export const DEFAULT_PUBLISH_METHOD: PublishMethod = 'cloudflare';

export function normalizePublishMethod(_method?: string): PublishMethod {
	return 'cloudflare';
}

export function shouldUseCloudflarePublish(_method?: string, _config?: unknown): boolean {
	return true;
}

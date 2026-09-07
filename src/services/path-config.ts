import type FridayPlugin from '../main';
import type { PathPublishConfig, PublishMode, SelectionKind } from '../types/publish-config';
import { coercePublishMode, getDefaultPublishConfig } from '../types/publish-config';

export function selectionVaultPath(contents: {
	file?: { path: string } | null;
	folder?: { path: string } | null;
}[]): string | null {
	const first = contents[0];
	if (!first) return null;
	if (first.folder?.path) return first.folder.path;
	if (first.file?.path) return first.file.path;
	return null;
}

export function getPathPublishConfig(
	plugin: FridayPlugin,
	vaultPath: string,
): PathPublishConfig | null {
	const map = plugin.settings.pathConfigs || {};
	return map[vaultPath] ?? null;
}

export async function savePathPublishConfig(
	plugin: FridayPlugin,
	vaultPath: string,
	patch: Partial<PathPublishConfig> & { mode: PublishMode },
): Promise<void> {
	if (!plugin.settings.pathConfigs) {
		plugin.settings.pathConfigs = {};
	}
	const prev = plugin.settings.pathConfigs[vaultPath] || {};
	plugin.settings.pathConfigs[vaultPath] = {
		...prev,
		...patch,
		updatedAt: Date.now(),
	};
	await plugin.saveSettings();
}

/** Hydrate sidebar form from saved path config, or defaults when missing. */
export function resolvePathPublishConfig(
	plugin: FridayPlugin,
	vaultPath: string | null,
	kind: SelectionKind,
): PathPublishConfig {
	if (!vaultPath) {
		return getDefaultPublishConfig(kind);
	}
	const saved = getPathPublishConfig(plugin, vaultPath);
	if (!saved) {
		return getDefaultPublishConfig(kind);
	}
	return {
		mode: coercePublishMode(kind, saved.mode),
		themeSlug: saved.themeSlug,
		hasPasswordFlag: !!saved.hasPasswordFlag,
		updatedAt: saved.updatedAt,
	};
}

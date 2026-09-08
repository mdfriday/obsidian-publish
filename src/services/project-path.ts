import type { TAbstractFile, TFile, TFolder } from 'obsidian';
import type FridayPlugin from '../main';
import type { PathPublishConfig } from '../types/publish-config';

/** Minimal local project shape for path matching (Foundry ObsidianProjectInfo subset). */
export interface LocalProjectPathInfo {
	name: string;
	fileLink?: { sourcePath: string } | null;
	contentLinks?: Array<{ sourcePath: string }> | null;
}

/** Normalize vault-relative path (forward slashes, no leading ./). */
export function normalizeVaultPath(path: string | null | undefined): string | null {
	if (!path) return null;
	return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Convert Foundry absolute (or already-relative) sourcePath to vault-relative.
 */
export function toVaultRelativePath(
	plugin: FridayPlugin,
	sourcePath: string | null | undefined,
): string | null {
	if (!sourcePath) return null;
	const normalized = sourcePath.replace(/\\/g, '/');
	const base = plugin.vaultBasePath?.replace(/\\/g, '/');
	if (base && (normalized === base || normalized.startsWith(base + '/'))) {
		return normalizeVaultPath(normalized.slice(base.length));
	}
	return normalizeVaultPath(normalized);
}

/** Primary vault path for a local Foundry project (file or first content folder). */
export function projectPrimaryVaultPath(
	plugin: FridayPlugin,
	project: LocalProjectPathInfo,
): string | null {
	if (project.fileLink?.sourcePath) {
		return toVaultRelativePath(plugin, project.fileLink.sourcePath);
	}
	const first = project.contentLinks?.[0]?.sourcePath;
	if (first) return toVaultRelativePath(plugin, first);
	return null;
}

export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
	const na = normalizeVaultPath(a);
	const nb = normalizeVaultPath(b);
	return !!na && !!nb && na === nb;
}

/**
 * Remap a stored source path when vault path oldPath → newPath (file or folder rename).
 * Handles prefix remap when a parent folder is renamed.
 */
export function remapPathAfterRename(
	stored: string,
	oldVaultPath: string,
	newVaultPath: string,
	plugin: FridayPlugin,
): string {
	const rel = toVaultRelativePath(plugin, stored) ?? normalizeVaultPath(stored);
	const oldN = normalizeVaultPath(oldVaultPath)!;
	const newN = normalizeVaultPath(newVaultPath)!;
	if (!rel) return stored;

	let nextRel = rel;
	if (rel === oldN) {
		nextRel = newN;
	} else if (rel.startsWith(oldN + '/')) {
		nextRel = newN + rel.slice(oldN.length);
	} else {
		return stored;
	}

	const base = plugin.vaultBasePath?.replace(/\\/g, '/');
	const wasAbsolute = !!base && stored.replace(/\\/g, '/').startsWith(base);
	if (wasAbsolute && base) {
		return `${base}/${nextRel}`.replace(/\/+/g, '/');
	}
	return nextRel;
}

/** Migrate pathConfigs keys when a vault path is renamed. */
export function migratePathConfigsOnRename(
	plugin: FridayPlugin,
	oldPath: string,
	newPath: string,
): boolean {
	const map = plugin.settings.pathConfigs || {};
	const oldN = normalizeVaultPath(oldPath);
	const newN = normalizeVaultPath(newPath);
	if (!oldN || !newN || oldN === newN) return false;

	let changed = false;
	const next: Record<string, PathPublishConfig> = {};
	for (const [key, value] of Object.entries(map)) {
		const keyN = normalizeVaultPath(key) || key;
		if (keyN === oldN) {
			next[newN] = value;
			changed = true;
		} else if (keyN.startsWith(oldN + '/')) {
			next[newN + keyN.slice(oldN.length)] = value;
			changed = true;
		} else {
			next[key] = value;
		}
	}
	if (changed) {
		plugin.settings.pathConfigs = next;
	}
	return changed;
}

export function deletePathConfigKey(plugin: FridayPlugin, vaultPath: string): boolean {
	const map = plugin.settings.pathConfigs || {};
	const key = normalizeVaultPath(vaultPath);
	if (!key || !(key in map) && !(vaultPath in map)) return false;
	const next = { ...map };
	delete next[key];
	delete next[vaultPath];
	plugin.settings.pathConfigs = next;
	return true;
}

export function selectionFromAbstract(
	file: TAbstractFile,
): { folder: TFolder | null; file: TFile | null } {
	// Caller should pass TFile | TFolder; duck-type for folder vs file.
	if ('extension' in file && typeof (file as TFile).extension === 'string') {
		return { folder: null, file: file as TFile };
	}
	return { folder: file as TFolder, file: null };
}

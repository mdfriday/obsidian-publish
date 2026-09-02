import type { App, TFolder, TFile } from 'obsidian';
import type { UserAssetSlot } from './types';

export function buildUserStaticMap(
	files: Set<string>,
	slots: UserAssetSlot[] | undefined,
): Record<string, true> {
	const out: Record<string, true> = {};
	if (!slots?.length) return out;
	for (const slot of slots) {
		if (files.has(slot.path)) {
			out[slot.path] = true;
		}
	}
	return out;
}

export async function listVaultStaticFiles(
	app: App,
	vaultRelativeStaticPath: string,
): Promise<Set<string>> {
	const out = new Set<string>();
	const root = app.vault.getAbstractFileByPath(vaultRelativeStaticPath);
	if (!(root instanceof TFolder)) {
		return out;
	}

	const walk = (folder: TFolder, prefix: string) => {
		for (const child of folder.children) {
			const rel = prefix ? `${prefix}/${child.name}` : child.name;
			if (child instanceof TFolder) {
				walk(child, rel);
			} else if (child instanceof TFile) {
				out.add(rel);
			}
		}
	};

	walk(root, '');
	return out;
}

export function mergeMdfridayParams(
	existing: Record<string, unknown> | undefined,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	return { ...(existing ?? {}), ...patch };
}

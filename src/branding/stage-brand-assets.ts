import type { Plugin } from 'obsidian';
import { TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { userBrandPath } from './brand-path';

/**
 * Copy chosen vault images into project static/ at the same relative path.
 * Missing vault files are skipped. Theme default favicon.svg is not copied.
 */
export async function stageBrandAssets(
	plugin: Plugin,
	projectStaticDir: string,
	vaultPaths: string[],
): Promise<string[]> {
	const staged: string[] = [];
	for (const raw of vaultPaths) {
		const rel = userBrandPath(raw);
		if (!rel) continue;
		const file = plugin.app.vault.getAbstractFileByPath(rel);
		if (!(file instanceof TFile)) {
			console.warn(`[brand] vault file missing, skip static copy: ${rel}`);
			continue;
		}
		const dest = path.join(projectStaticDir, ...rel.split('/'));
		await fs.promises.mkdir(path.dirname(dest), { recursive: true });
		const data = await plugin.app.vault.adapter.readBinary(file.path);
		await fs.promises.writeFile(dest, Buffer.from(data));
		staged.push(rel);
	}
	return staged;
}

import * as fs from 'fs';
import * as path from 'path';
import { Platform } from 'obsidian';
import JSZip from 'jszip';

/**
 * Resolve the directory to zip for export.
 * Themed previews keep absPreviewDir as the project root (with public/).
 * Faithful previews set absPreviewDir to the public dir itself.
 */
export async function resolveExportPublicDir(absPreviewDir: string): Promise<string> {
	const nested = path.join(absPreviewDir, 'public');
	try {
		const st = await fs.promises.stat(nested);
		if (st.isDirectory()) return nested;
	} catch {
		/* no nested public/ */
	}
	return absPreviewDir;
}

export async function createZipFromDirectory(sourceDir: string): Promise<Uint8Array> {
	const zip = new JSZip();

	const addDirectoryToZip = async (dirPath: string, zipFolder: JSZip) => {
		const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

		for (const item of items) {
			const itemPath = path.join(dirPath, item.name);

			if (item.isDirectory()) {
				const subFolder = zipFolder.folder(item.name);
				if (subFolder) {
					await addDirectoryToZip(itemPath, subFolder);
				}
			} else if (item.isFile()) {
				const fileContent = await fs.promises.readFile(itemPath);
				zipFolder.file(item.name, new Uint8Array(fileContent));
			}
		}
	};

	await addDirectoryToZip(sourceDir, zip);
	return await zip.generateAsync({ type: 'uint8array' });
}

export type SaveDialogResult = {
	canceled: boolean;
	filePath?: string;
};

/**
 * Native save dialog via Obsidian desktop's Electron bridge (`window.electron`),
 * same approach as the official obsidian-importer plugin.
 */
export async function showZipSaveDialog(opts: {
	title: string;
	defaultPath: string;
}): Promise<SaveDialogResult> {
	if (!Platform.isDesktopApp) {
		throw new Error('Save dialog is only available on Obsidian desktop');
	}

	const dialog = window.electron?.remote?.dialog;
	if (!dialog?.showSaveDialog) {
		throw new Error('Save dialog is only available on Obsidian desktop');
	}

	return dialog.showSaveDialog({
		title: opts.title,
		defaultPath: opts.defaultPath,
		filters: [
			{ name: 'ZIP Files', extensions: ['zip'] },
			{ name: 'All Files', extensions: ['*'] },
		],
	});
}

export async function writeZipFile(filePath: string, zipContent: Uint8Array): Promise<void> {
	await fs.promises.writeFile(filePath, zipContent);
}

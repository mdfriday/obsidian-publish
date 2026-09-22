/**
 * Minimal typings for the Electron bridge Obsidian exposes on desktop
 * (`window.electron`), used by official plugins such as obsidian-importer.
 */
interface ElectronFileFilter {
	name: string;
	extensions: string[];
}

interface ElectronSaveDialogOptions {
	title?: string;
	defaultPath?: string;
	filters?: ElectronFileFilter[];
}

interface ElectronSaveDialogReturnValue {
	canceled: boolean;
	filePath?: string;
}

interface ElectronDialog {
	showSaveDialog(options: ElectronSaveDialogOptions): Promise<ElectronSaveDialogReturnValue>;
}

interface ElectronRemote {
	dialog: ElectronDialog;
}

interface ElectronBridge {
	remote: ElectronRemote;
}

interface Window {
	electron?: ElectronBridge;
}

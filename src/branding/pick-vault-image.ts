import { FuzzySuggestModal, TFile, type App, type FuzzyMatch } from 'obsidian';

const IMAGE_EXT = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'ico',
	'avif',
]);

export function pickVaultImage(app: App, placeholder: string): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (vaultPath: string | null) => {
			if (settled) return;
			settled = true;
			resolve(vaultPath);
		};

		const modal = new (class extends FuzzySuggestModal<TFile> {
			chosen: string | null = null;

			getItems(): TFile[] {
				return app.vault
					.getFiles()
					.filter((file) => IMAGE_EXT.has(file.extension.toLowerCase()));
			}

			getItemText(file: TFile): string {
				return file.path;
			}

			onChooseItem(file: TFile): void {
				this.chosen = file.path;
			}

			selectSuggestion(value: FuzzyMatch<TFile>, evt: MouseEvent | KeyboardEvent): void {
				// SuggestModal.close() runs before onChooseItem, so record the file first.
				this.chosen = value.item?.path ?? null;
				super.selectSuggestion(value, evt);
			}

			onClose(): void {
				super.onClose();
				finish(this.chosen);
			}
		})(app);

		modal.setPlaceholder(placeholder);
		modal.open();
	});
}

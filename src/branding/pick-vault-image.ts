import { Modal, TFile, type App } from 'obsidian';

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

export function vaultImageSrc(app: App, vaultPath: string): string {
	const file = app.vault.getAbstractFileByPath(vaultPath);
	if (!(file instanceof TFile)) return '';
	if (!IMAGE_EXT.has(file.extension.toLowerCase())) return '';
	return app.vault.getResourcePath(file);
}

function listVaultImages(app: App): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => IMAGE_EXT.has(file.extension.toLowerCase()))
		.sort((a, b) => a.path.localeCompare(b.path));
}

export function pickVaultImage(
	app: App,
	options: { title: string; empty: string },
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new BrandImageModal(app, options, resolve);
		modal.open();
	});
}

class BrandImageModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private options: { title: string; empty: string },
		private done: (vaultPath: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('brand-pick-modal');
		contentEl.empty();
		contentEl.addClass('brand-pick');
		contentEl.createEl('h3', { text: this.options.title, cls: 'brand-pick-title' });

		const files = listVaultImages(this.app);
		if (!files.length) {
			contentEl.createDiv({ cls: 'brand-pick-empty', text: this.options.empty });
			return;
		}

		const list = contentEl.createDiv({ cls: 'brand-pick-list' });
		for (const file of files) {
			const row = list.createEl('button', { cls: 'brand-pick-row' });
			row.type = 'button';
			const thumb = row.createEl('img', { cls: 'brand-pick-thumb' });
			thumb.alt = '';
			thumb.src = this.app.vault.getResourcePath(file);
			row.createDiv({ cls: 'brand-pick-path', text: file.path });
			row.addEventListener('click', () => {
				this.finish(file.path);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private finish(vaultPath: string | null): void {
		if (this.settled) return;
		this.settled = true;
		this.done(vaultPath);
	}
}

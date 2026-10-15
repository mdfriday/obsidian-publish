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

/** Higher is better. 0 means no match. A typed substring outranks a loose character sequence. */
function fuzzyScore(query: string, text: string): number {
	const q = query.trim().toLowerCase();
	if (!q) return 1;
	const t = text.toLowerCase();
	const at = t.indexOf(q);
	if (at >= 0) return 1000 - at;
	let qi = 0;
	let score = 0;
	let prev = -2;
	for (let i = 0; i < t.length && qi < q.length; i++) {
		if (t[i] !== q[qi]) continue;
		score += prev === i - 1 ? 3 : 1;
		prev = i;
		qi++;
	}
	return qi === q.length ? score : 0;
}

function listVaultImages(app: App): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => IMAGE_EXT.has(file.extension.toLowerCase()))
		.sort((a, b) => a.path.localeCompare(b.path));
}

export function pickVaultImage(
	app: App,
	options: { title: string; empty: string; placeholder: string; noMatch: string },
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
		private options: { title: string; empty: string; placeholder: string; noMatch: string },
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

		const search = contentEl.createEl('input', { cls: 'brand-pick-search', type: 'text' });
		search.placeholder = this.options.placeholder;
		const list = contentEl.createDiv({ cls: 'brand-pick-list' });
		const render = () => {
			list.empty();
			const matched = files
				.map((file) => ({ file, score: fuzzyScore(search.value, file.path) }))
				.filter((row) => row.score > 0)
				.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
			if (!matched.length) {
				list.createDiv({ cls: 'brand-pick-empty', text: this.options.noMatch });
				return;
			}
			for (const { file } of matched) {
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
		};
		search.addEventListener('input', render);
		render();
		search.focus();
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

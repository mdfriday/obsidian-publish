// Theme Selection Modal
import {App, Modal} from "obsidian";
import {themeApiService} from "./themeApiService";
import type {CatalogEntry} from "./types";
import type FridayPlugin from "../main";

export class ThemeSelectionModal extends Modal {
	private selectedSlug: string;
	private onSelect: (entry: CatalogEntry) => void;
	private themes: CatalogEntry[] = [];
	private allThemes: CatalogEntry[] = [];
	private allTags: string[] = [];
	private selectedTags: string[] = [];
	private searchTerm: string = '';
	private loading = false;
	private loadingTags = false;
	private loadingError: string | null = null;
	private loadingState: 'initial' | 'tags' | 'themes' | 'search' | 'idle' | 'error' = 'idle';
	private searchTimeout: NodeJS.Timeout | null = null;
	private plugin: FridayPlugin;
	private isForSingleFile: boolean = false;

	constructor(
		app: App,
		selectedSlug: string,
		onSelect: (entry: CatalogEntry) => void,
		plugin: FridayPlugin,
		isForSingleFile: boolean = false,
	) {
		super(app);
		this.selectedSlug = selectedSlug;
		this.onSelect = onSelect;
		this.plugin = plugin;
		this.isForSingleFile = isForSingleFile;
		this.setTitle(plugin.i18n.t('theme.choose_theme'));
	}

	private t(key: string, params?: Record<string, unknown>): string {
		return this.plugin.i18n.t(key, params);
	}

	async onOpen() {
		const {contentEl, modalEl} = this;
		modalEl.addClass('friday-theme-modal');
		contentEl.empty();
		this.loadingState = 'initial';
		this.renderModal();

		try {
			await this.loadTags();
			await this.loadThemes();
			this.renderModal();
		} catch (error) {
			console.error('Failed to load theme catalog:', error);
			this.loadingState = 'error';
			this.loadingError = error instanceof Error ? error.message : 'Unknown error';
			this.renderModal();
		}
	}

	private async loadTags() {
		this.loadingTags = true;
		this.loadingState = 'tags';
		try {
			this.allThemes = await themeApiService.getAllThemes(this.plugin);
			if (this.isForSingleFile) {
				this.allThemes = this.allThemes.filter((theme) =>
					theme.kinds.includes('note'),
				);
			}
			this.allTags = this.extractTagsFromThemes(this.allThemes);
		} finally {
			this.loadingTags = false;
		}
	}

	private extractTagsFromThemes(themes: CatalogEntry[]): string[] {
		return [...new Set(themes.flatMap((theme) => theme.tags))].sort((a, b) =>
			a.localeCompare(b),
		);
	}

	private async loadThemes() {
		this.loading = true;
		this.loadingState = this.searchTerm || this.selectedTags.length > 0 ? 'search' : 'themes';
		this.loadingError = null;

		try {
			let filtered = [...this.allThemes];
			if (this.searchTerm.trim()) {
				const term = this.searchTerm.trim().toLowerCase();
				filtered = filtered.filter(
					(theme) =>
						theme.name.toLowerCase().includes(term) ||
						theme.slug.toLowerCase().includes(term) ||
						theme.tags.some((tag) => tag.toLowerCase().includes(term)),
				);
			}
			if (this.selectedTags.length > 0) {
				filtered = filtered.filter((theme) =>
					this.selectedTags.every((selectedTag) =>
						theme.tags.some((tag) => tag === selectedTag),
					),
				);
			}
			this.themes = filtered.slice(0, 20);
			this.loadingState = 'idle';
		} catch (error) {
			this.themes = [];
			this.loadingState = 'error';
			this.loadingError = error instanceof Error ? error.message : 'Unknown error';
		} finally {
			this.loading = false;
		}
	}

	private renderModal() {
		const {contentEl} = this;
		contentEl.empty();

		if (this.loadingState === 'initial' || this.loadingState === 'tags') {
			const themesSection = contentEl.createDiv('themes-section');
			this.renderLoadingState(themesSection);
			return;
		}

		const searchSection = contentEl.createDiv('search-section');
		const searchWrapper = searchSection.createDiv('search-input-wrapper');
		const searchInput = searchWrapper.createEl('input', {
			type: 'text',
			placeholder: this.t('theme.search_themes'),
			cls: 'search-input',
		});
		searchWrapper.createDiv('search-icon').setText('🔍');

		searchInput.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			if (this.searchTimeout) clearTimeout(this.searchTimeout);
			this.searchTimeout = setTimeout(async () => {
				await this.loadThemes();
				this.renderThemes();
			}, 300);
		});

		const tagsSection = searchSection.createDiv('tags-section');
		const tagsHeader = tagsSection.createDiv('tags-header');
		tagsHeader.createEl('span', {text: this.t('theme.filter_by_tags'), cls: 'tags-label'});

		if (this.selectedTags.length > 0) {
			const clearBtn = tagsHeader.createEl('button', {
				text: this.t('theme.clear_filters'),
				cls: 'clear-filters-btn',
			});
			clearBtn.addEventListener('click', async () => {
				this.selectedTags = [];
				this.searchTerm = '';
				searchInput.value = '';
				await this.loadThemes();
				this.renderModal();
			});
		}

		const tagsGrid = tagsSection.createDiv('tags-grid');
		this.allTags.forEach((tag) => {
			const tagBtn = tagsGrid.createEl('button', {
				text: tag,
				cls: `tag-btn ${this.selectedTags.includes(tag) ? 'selected' : ''}`,
			});
			tagBtn.addEventListener('click', async () => {
				if (this.selectedTags.includes(tag)) {
					this.selectedTags = this.selectedTags.filter((t) => t !== tag);
				} else {
					this.selectedTags.push(tag);
				}
				await this.loadThemes();
				this.renderModal();
			});
		});

		const themesSection = contentEl.createDiv('themes-section');
		this.renderThemes(themesSection);
	}

	private renderThemes(container?: HTMLElement) {
		const themesSection =
			container || (this.contentEl.querySelector('.themes-section') as HTMLElement);
		if (!themesSection) return;

		themesSection.empty();

		if (this.loadingState === 'error') {
			this.renderErrorState(themesSection);
			return;
		}

		if (this.loading || this.loadingState !== 'idle') {
			this.renderLoadingState(themesSection);
			return;
		}

		if (this.themes.length === 0) {
			themesSection.createDiv('no-results').createEl('p', {
				text: this.t('theme.no_themes_found'),
			});
			return;
		}

		const themesGrid = themesSection.createDiv('themes-grid');
		this.themes.forEach((theme) => {
			const locked = !theme.entitled || !theme.packUrl;
			const themeCard = themesGrid.createDiv(
				`theme-card ${theme.slug === this.selectedSlug ? 'selected' : ''}${locked ? ' is-locked' : ''}`,
			);

			const imageSection = themeCard.createDiv('theme-image-section');
			if (theme.thumbnail) {
				imageSection.style.backgroundImage = `url("${theme.thumbnail}")`;
				imageSection.style.backgroundSize = 'cover';
				imageSection.style.backgroundPosition = 'center top';
			}

			if (theme.demoUrl) {
				const liveDemoBtn = imageSection.createEl('a', {
					text: this.t('theme.live_demo'),
					cls: 'live-demo-btn',
				});
				liveDemoBtn.href = theme.demoUrl;
				liveDemoBtn.target = '_blank';
				liveDemoBtn.addEventListener('click', (e) => e.stopPropagation());
			}

			const infoSection = themeCard.createDiv('theme-info-section');
			const leftInfo = infoSection.createDiv('theme-info-left');
			leftInfo.createEl('h3', {text: theme.name, cls: 'theme-title'});
			const metaInfo = leftInfo.createDiv('theme-meta-info');
			metaInfo.createEl('span', {
				text: `${theme.family}/${theme.variant}`,
				cls: 'theme-author',
			});
			metaInfo.createEl('span', {text: ' • ', cls: 'separator'});
			metaInfo.createEl('span', {text: `v${theme.version}`, cls: 'theme-version'});
			leftInfo.createEl('p', {
				text: theme.description || '',
				cls: 'theme-description',
			});

			const rightInfo = infoSection.createDiv('theme-info-right');
			rightInfo.createDiv({
				text: theme.tier,
				cls: `theme-price ${theme.access}`,
			});
			if (locked && theme.lockReason) {
				rightInfo.createDiv({text: theme.lockReason, cls: 'theme-lock-reason'});
			}

			const bottomSection = themeCard.createDiv('theme-bottom-section');
			if (theme.tags.length) {
				const tags = bottomSection.createDiv('theme-tags');
				theme.tags.forEach((tag) => {
					tags.createEl('span', {text: tag, cls: 'tag'});
				});
			}

			const useBtn = bottomSection.createEl('button', {
				text:
					theme.slug === this.selectedSlug
						? this.t('theme.current')
						: locked
							? this.t('theme.locked')
							: this.t('theme.use_it'),
				cls: `use-theme-btn ${theme.slug === this.selectedSlug ? 'current' : ''}`,
			});
			if (locked) {
				useBtn.disabled = true;
				themeCard.addClass('is-locked');
				return;
			}

			const select = () => {
				this.onSelect(theme);
				this.close();
			};
			useBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				select();
			});
			themeCard.addEventListener('click', select);
		});
	}

	private renderLoadingState(container: HTMLElement) {
		if (this.loadingState === 'initial' || this.loadingState === 'tags') {
			const loadingContainer = container.createDiv('loading-container');
			loadingContainer.createDiv('loading-spinner');
			loadingContainer.createDiv('loading-text').setText(
				this.loadingState === 'tags'
					? this.t('theme.loading_tags')
					: this.t('theme.loading_initial'),
			);
			return;
		}
		if (this.loading) {
			container.createDiv('loading-message').setText(
				this.loadingState === 'search'
					? this.t('theme.loading_search')
					: this.t('theme.loading_themes'),
			);
		}
	}

	private renderErrorState(container: HTMLElement) {
		const errorContainer = container.createDiv('error-container');
		errorContainer.createDiv('error-icon').setText('⚠️');
		errorContainer.createDiv('error-message').setText(
			this.loadingError || this.t('theme.loading_error'),
		);
		const retryButton = errorContainer.createEl('button', {
			text: this.t('theme.retry'),
			cls: 'retry-button',
		});
		retryButton.addEventListener('click', async () => {
			themeApiService.clearCache();
			await this.onOpen();
		});
	}

	onClose() {
		this.contentEl.empty();
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
	}
}

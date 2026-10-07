// Run: npm test   (node --test, native TypeScript type stripping; Node >= 22.6)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	FOLDER_WIKI_THEME_SLUGS,
	filterThemesForSelection,
	isFolderWikiTheme,
} from '../src/utils/theme-selection.ts';
import type { CatalogEntry } from '../src/theme/types.ts';

function entry(
	partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'slug' | 'family'>,
): CatalogEntry {
	return {
		variant: partial.slug,
		version: '1.0.0',
		name: partial.slug,
		packUrl: `https://example.com/${partial.slug}.zip`,
		kinds: ['wiki'],
		tags: [],
		tier: 'professional',
		access: 'free',
		entitled: true,
		lockReason: null,
		...partial,
	} as CatalogEntry;
}

describe('filterThemesForSelection (folder)', () => {
	it('allowlists quartz / creator / flint / jasper only', () => {
		const themes = [
			entry({ slug: 'quartz', family: 'quartz' }),
			entry({ slug: 'creator', family: 'creator' }),
			entry({ slug: 'flint', family: 'flint' }),
			entry({ slug: 'jasper', family: 'jasper' }),
			entry({ slug: 'book', family: 'book', kinds: ['docs', 'wiki'] }),
			entry({ slug: 'notebook', family: 'notebook', kinds: ['wiki', 'docs'] }),
			entry({ slug: 'paper', family: 'notes', kinds: ['note'] }),
		];

		const folder = filterThemesForSelection(themes, 'folder');
		assert.deepEqual(
			folder.map((t) => t.slug).sort(),
			[...FOLDER_WIKI_THEME_SLUGS].sort(),
		);
		assert.equal(isFolderWikiTheme(entry({ slug: 'book', family: 'book' })), false);
		assert.equal(isFolderWikiTheme(entry({ slug: 'flint', family: 'flint' })), true);
	});

	it('note selection still uses notes family only', () => {
		const themes = [
			entry({ slug: 'paper', family: 'notes', kinds: ['note'] }),
			entry({ slug: 'quartz', family: 'quartz' }),
		];
		const note = filterThemesForSelection(themes, 'note');
		assert.deepEqual(
			note.map((t) => t.slug),
			['paper'],
		);
	});
});

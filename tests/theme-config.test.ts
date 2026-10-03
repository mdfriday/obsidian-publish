// Run: npm test   (node --test, native TypeScript type stripping; Node >= 22.6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeConfigPatch, mergeThemeSiteParams } from '../src/theme/theme-config.ts';
import type { CatalogEntry } from '../src/theme/types.ts';

function entry(family: string, siteParams: Record<string, unknown>): CatalogEntry {
	return {
		slug: family,
		family,
		variant: family,
		version: '1.0.0',
		name: family,
		packUrl: `https://cdn.fsky.top/t/${family}/1.0.0/pack.zip?version=1.0.0`,
		kinds: [],
		tags: [],
		siteParams,
	} as unknown as CatalogEntry;
}

const quartz = entry('quartz', {
	search: { enabled: true },
	logo: 'quartz.svg',
	navLinks: [{ title: 'MDFriday', url: 'https://mdfriday.com' }],
});
const creator = entry('creator', {
	search: { enabled: true, variant: 'modal' },
	logo: 'favicon.svg',
	favicon: 'favicon.svg',
	navLinks: [],
});

const userLinks = [
	{ title: 'About', url: '/about/' },
	{ title: 'GitHub', url: 'https://github.com/example' },
];

test('new project: theme navLinks defaults are never seeded', () => {
	assert.deepEqual(mergeThemeSiteParams(undefined, quartz).navLinks, []);
	assert.deepEqual(mergeThemeSiteParams({}, creator).navLinks, []);
});

test('switching quartz → creator → quartz keeps the user navLinks', () => {
	let params = mergeThemeSiteParams({ navLinks: userLinks, logo: 'me.png' }, quartz);
	assert.deepEqual(params.navLinks, userLinks);

	params = mergeThemeSiteParams(params, creator);
	assert.deepEqual(params.navLinks, userLinks);
	assert.equal((params.mdfriday as { family: string }).family, 'creator');

	params = mergeThemeSiteParams(params, quartz);
	assert.deepEqual(params.navLinks, userLinks);
	assert.equal((params.mdfriday as { family: string }).family, 'quartz');
	// Other customParams the user set also survive; capability keys follow the theme.
	assert.equal(params.logo, 'me.png');
	assert.deepEqual(params.search, { enabled: true });
});

test('a user-cleared navLinks ([]) is not refilled by the theme', () => {
	const params = mergeThemeSiteParams({ navLinks: [] }, quartz);
	assert.deepEqual(params.navLinks, []);
});

test('buildThemeConfigPatch carries the preserved navLinks and the new pack import', () => {
	const patch = buildThemeConfigPatch(creator, undefined, { navLinks: userLinks });
	assert.deepEqual(patch.params.navLinks, userLinks);
	assert.deepEqual(patch.module.imports, [{ path: creator.packUrl }]);
});

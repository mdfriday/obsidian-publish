#!/usr/bin/env node
/** P7: plugin config patch shape for catalog-driven themes (Foundry downloads pack). */

function buildThemeConfigPatch(entry) {
	if (!entry.packUrl) {
		throw new Error(`Theme "${entry.slug}" is not entitled`);
	}
	return {
		module: { imports: [{ path: entry.packUrl }] },
		params: {
			mdfriday: {
				family: entry.family,
				variant: entry.variant,
				version: entry.version,
			},
		},
	};
}

const newsEntry = {
	slug: 'news',
	family: 'notes',
	variant: 'news',
	version: '1.0.0',
	packUrl: 'https://cdn.fsky.top/t/notes/1.0.0/pack.zip?version=1.0.0',
};

const patch = buildThemeConfigPatch(newsEntry);
const serialized = JSON.stringify(patch);
for (const key of ['assets', 'mode', 'cdn']) {
	if (serialized.includes(`"${key}"`)) {
		console.error(`✗ config patch must not contain "${key}"`);
		process.exit(1);
	}
}

if (patch.params?.mdfriday?.variant !== 'news') {
	console.error('✗ params.mdfriday mismatch');
	process.exit(1);
}

console.log('✓ P7 theme config patch verification passed');

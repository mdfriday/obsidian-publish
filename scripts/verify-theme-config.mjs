#!/usr/bin/env node
/** P7: plugin config patch shape for catalog-driven themes (Foundry downloads pack). */

function mergeThemeSiteParams(existingParams, entry) {
	const PRESERVED = new Set([
		'branding',
		'password',
		'favicon',
		'disqusShortname',
		'autoPublish',
		'lastPublishUrl',
	]);
	const preserved = {};
	for (const key of PRESERVED) {
		if (existingParams && key in existingParams) preserved[key] = existingParams[key];
	}
	return {
		...preserved,
		...(entry.siteParams ?? {}),
		mdfriday: {
			family: entry.family,
			variant: entry.variant,
			version: entry.version,
		},
	};
}

function buildThemeConfigPatch(entry, existingParams) {
	if (!entry.packUrl) {
		throw new Error(`Theme "${entry.slug}" is not entitled`);
	}
	return {
		module: { imports: [{ path: entry.packUrl }] },
		params: mergeThemeSiteParams(existingParams, entry),
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

const quartzEntry = {
	slug: 'quartz',
	family: 'quartz',
	variant: 'quartz',
	version: '1.0.0',
	packUrl: 'https://cdn.fsky.top/t/quartz/1.0.0/pack.zip?version=1.0.0',
	siteParams: {
		search: { enable: true, variant: 'inline', trigger: 'sidebar', content: true, cjk: true },
		explorer: true,
		graph: true,
	},
};

const quartzPatch = buildThemeConfigPatch(quartzEntry, {
	branding: true,
	password: 'secret',
	explorer: false,
	lastPublishUrl: 'https://example.com',
});

if (quartzPatch.params.search?.variant !== 'inline') {
	console.error('✗ quartz siteParams.search not applied');
	process.exit(1);
}
if (quartzPatch.params.explorer !== true) {
	console.error('✗ quartz siteParams.explorer not applied');
	process.exit(1);
}
if (quartzPatch.params.password !== 'secret' || quartzPatch.params.branding !== true) {
	console.error('✗ preserved user params lost');
	process.exit(1);
}
if (quartzPatch.params.lastPublishUrl !== 'https://example.com') {
	console.error('✗ lastPublishUrl not preserved');
	process.exit(1);
}

console.log('✓ P7 theme config patch verification passed');

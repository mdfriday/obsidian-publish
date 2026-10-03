// Run: npm test   (node --test, native TypeScript type stripping; Node >= 22.6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyPatchOutcome, articleCell, buildCsv, buildMarkdown, chooseExportFolder, csvCell, exportFilePath,
	fetchAllSubscribers, mdCell, mergeSubscribeUi, pickerLabel, planPublishSubscribe, resolveNotePath,
	siteSlugFor, subscribeDefaults, subscribeEndpoint, themeSupportsSubscribe,
	type SubscriberRecord, type SubscribersPage,
} from '../src/subscribe/subscribe-core.ts';

const P = 'p_66c1869e4ef175af1b20ba80abfcd96f';
const EP = 'https://api.fsky.top/v1/public/subscribe';

test('defaults match Base partial (en/zh) and endpoint is built from the API host', () => {
	assert.deepEqual(subscribeDefaults('en'), { title: 'Subscribe to updates', description: 'Get new posts by email.' });
	assert.deepEqual(subscribeDefaults('zh-cn'), { title: '订阅更新', description: '通过邮件获取新文章。' });
	assert.equal(subscribeEndpoint('https://api.fsky.top/'), EP);
	assert.equal(subscribeEndpoint('https://api.mdfriday.com'), 'https://api.mdfriday.com/v1/public/subscribe');
});

test('theme capability check', () => {
	assert.equal(themeSupportsSubscribe({ capabilities: ['i18n', 'subscribe'] }), true);
	assert.equal(themeSupportsSubscribe({ capabilities: ['i18n'] }), false);
	assert.equal(themeSupportsSubscribe({}), false);
	assert.equal(themeSupportsSubscribe(null), false);
});

test('guest gating: UI merge forces enabled=false; publish never PATCHes for guests', () => {
	const ui = mergeSubscribeUi(undefined, { enabled: true, title: 'T', description: '' }, { guest: true });
	assert.equal(ui?.enabled, false);
	const plan = planPublishSubscribe({ ...ui, enabled: true }, { projectId: P, endpoint: EP, guest: true });
	assert.equal(plan.params?.enabled, false);
	assert.equal(plan.patch, null);
});

test('UI merge: untouched site writes nothing; keeps project/endpoint/sync memory; trims', () => {
	assert.equal(mergeSubscribeUi(undefined, { enabled: false, title: '', description: '' }, { guest: false }), null);
	const prev = { enabled: false, title: '', description: '', project: P, endpoint: EP, v: 1, synced: false, syncedproject: P };
	const m = mergeSubscribeUi(prev, { enabled: true, title: '  News  ', description: '' }, { guest: false });
	assert.deepEqual(m, { ...prev, enabled: true, title: 'News', description: '' });
});

test('PATCH only on change', () => {
	// never configured → nothing
	assert.deepEqual(planPublishSubscribe(undefined, { projectId: P, endpoint: EP, guest: false }), { params: null, patch: null });
	// first enable → PATCH true, stamps project + endpoint
	const first = planPublishSubscribe({ enabled: true }, { projectId: P, endpoint: EP, guest: false });
	assert.equal(first.patch, true);
	assert.equal(first.params?.project, P);
	assert.equal(first.params?.endpoint, EP);
	// after ok → republish does not PATCH
	const synced = applyPatchOutcome(first.params!, true, 'ok');
	assert.equal(planPublishSubscribe(synced, { projectId: P, endpoint: EP, guest: false }).patch, null);
	// toggle off → PATCH false
	assert.equal(planPublishSubscribe({ ...synced, enabled: false }, { projectId: P, endpoint: EP, guest: false }).patch, false);
	// configured but off and never synced → server default is off, no PATCH
	assert.equal(planPublishSubscribe({ enabled: false, title: 'x' }, { projectId: P, endpoint: EP, guest: false }).patch, null);
	// re-bound to another project → PATCH again
	assert.equal(planPublishSubscribe(synced, { projectId: 'p_' + 'b'.repeat(32), endpoint: EP, guest: false }).patch, true);
	// transient error keeps state → retry next publish
	const err = applyPatchOutcome(first.params!, true, 'error');
	assert.equal(planPublishSubscribe(err, { projectId: P, endpoint: EP, guest: false }).patch, true);
	// 402 plan_required → form disabled, no retry loop
	const pr = applyPatchOutcome(first.params!, true, 'plan_required');
	assert.equal(pr.enabled, false);
	assert.equal(planPublishSubscribe(pr, { projectId: P, endpoint: EP, guest: false }).patch, null);
});

function sub(i: number, extra: Partial<SubscriberRecord> = {}): SubscriberRecord {
	return {
		id: `sub_${i}`,
		email: `u${i}@example.com`,
		createdAt: new Date(Date.UTC(2026, 9, 3, 5, 0, i)).toISOString(),
		lastSeenAt: new Date(Date.UTC(2026, 9, 3, 5, 0, i)).toISOString(),
		submitCount: 1,
		page: { url: `https://share.fsky.top/s/X/p${i}.html`, path: `/s/X/p${i}.html`, title: `P${i}`, file: `p${i}`, kind: 'page', placement: 'article', lang: 'en' },
		referrerHost: null,
		utm: { source: null, medium: null, campaign: null },
		country: 'SG',
		...extra,
	};
}

test('pagination: follows nextCursor, dedupes, sorts ascending, reports progress', async () => {
	const pages: Record<string, SubscribersPage> = {
		'': { project: { id: P, title: 'Site' }, total: 5, subscribers: [sub(5), sub(4)], nextCursor: 'c1' },
		c1: { subscribers: [sub(3), sub(2)], nextCursor: 'c2' },
		c2: { subscribers: [sub(2), sub(1)], nextCursor: null },
	};
	const calls: Array<string | null> = [];
	const progress: number[] = [];
	const r = await fetchAllSubscribers(async (c) => { calls.push(c); return pages[c ?? '']; }, { onPage: (n) => progress.push(n) });
	assert.deepEqual(calls, [null, 'c1', 'c2']);
	assert.deepEqual(r.subscribers.map((s) => s.id), ['sub_1', 'sub_2', 'sub_3', 'sub_4', 'sub_5']);
	assert.equal(r.total, 5);
	assert.equal(r.project?.title, 'Site');
	assert.deepEqual(progress, [2, 4, 5]);
	// a server repeating the same cursor cannot loop forever
	let n = 0;
	await fetchAllSubscribers(async () => { n++; return { subscribers: [], nextCursor: 'same' }; });
	assert.equal(n, 2);
});

const vault = {
	files: ['Docs/plans/Claim-and-Upgrade.md', 'Docs/index.md', 'Docs/guide/_index.md', 'Docs/faq.md', 'Other/faq.md', 'Note.md'],
	linkpathDest: (lp: string) => (lp === 'moved' ? 'Docs/archive/moved.md' : lp === 'elsewhere' ? 'Other/elsewhere.md' : null),
};

test('note-link resolution: exact, case-insensitive, index/_index, linkpath, single-note, miss', () => {
	assert.equal(resolveNotePath('faq', 'Docs', vault), 'Docs/faq.md');
	assert.equal(resolveNotePath('plans/claim-and-upgrade', 'Docs', vault), 'Docs/plans/Claim-and-Upgrade.md');
	assert.equal(resolveNotePath('index', 'Docs', vault), 'Docs/index.md');
	assert.equal(resolveNotePath('guide/index', 'Docs/', vault), 'Docs/guide/_index.md');
	assert.equal(resolveNotePath('x/moved', 'Docs', vault), 'Docs/archive/moved.md');
	assert.equal(resolveNotePath('x/elsewhere', 'Docs', vault), null, 'linkpath outside the published folder is ignored');
	assert.equal(resolveNotePath('anything', 'Note.md', vault), 'Note.md');
	assert.equal(resolveNotePath('', 'Docs', vault), null);
	assert.equal(resolveNotePath('nope', 'Docs', vault), null);
});

test('export path: MDFriday Exports unless inside the published folder; collisions', () => {
	assert.equal(chooseExportFolder('Docs'), 'MDFriday Exports');
	assert.equal(chooseExportFolder('Notes/Post.md'), 'MDFriday Exports');
	assert.equal(chooseExportFolder(''), '.mdfriday-exports');
	assert.equal(chooseExportFolder('/'), '.mdfriday-exports');
	assert.equal(chooseExportFolder('MDFriday Exports'), '.mdfriday-exports');
	assert.equal(chooseExportFolder('MDFriday'), 'MDFriday Exports', 'prefix of a different folder name is not "inside"');
	const at = new Date(2026, 9, 3, 9, 5);
	const taken = new Set(['MDFriday Exports/sunwei-xyz-subscribers-2026-10-03-0905.csv', 'MDFriday Exports/sunwei-xyz-subscribers-2026-10-03-0905-2.csv']);
	assert.equal(exportFilePath('MDFriday Exports', 'sunwei-xyz', at, 'csv', (p) => taken.has(p)), 'MDFriday Exports/sunwei-xyz-subscribers-2026-10-03-0905-3.csv');
	assert.equal(exportFilePath('MDFriday Exports', 'sunwei-xyz', at, 'md', (p) => taken.has(p)), 'MDFriday Exports/sunwei-xyz-subscribers-2026-10-03-0905.md');
	assert.equal(siteSlugFor({ id: P, title: 'sunwei.xyz 知识库' }, 'x'), 'sunwei-xyz-知识库');
	assert.equal(siteSlugFor({ id: P, siteId: 'LNyLAM', title: '' }, 'x'), 'lnylam');
});

test('CSV: BOM, CRLF, RFC 4180 quoting, formula guard, CJK, local dates', () => {
	const rows = [
		sub(1, { page: { title: '定价, "思路"', url: 'https://x/a', file: 'faq', placement: 'article', lang: 'zh' }, referrerHost: 'news.example.org', utm: { source: 'hn', medium: null, campaign: null } }),
		sub(2, { email: '=cmd@example.com', page: { title: 'line1\nline2', url: 'https://x/b', file: 'nope' } }),
	];
	const csv = buildCsv(rows, { project: { id: P }, sourcePath: 'Docs', vault });
	assert.ok(csv.startsWith('\uFEFFemail,date_added,project,page_title,page_url,source_note,'));
	const lines = csv.slice(1).split('\r\n');
	assert.equal(lines.length, 4); // header + 2 + trailing ''
	assert.match(lines[1], /^u1@example\.com,2026-10-03T\d\d:00:01[+-]\d\d:\d\d,p_66c1869e4ef175af1b20ba80abfcd96f,"定价, ""思路""",https:\/\/x\/a,Docs\/faq\.md,news\.example\.org,hn,,,SG,zh,article,/);
	assert.ok(lines[2].startsWith(`'=cmd@example.com,`));
	assert.ok(csv.includes('"line1\nline2"'));
	assert.equal(csvCell('plain'), 'plain');
	assert.equal(csvCell(' pad'), '" pad"');
	assert.equal(csvCell('-3'), "'-3");
	assert.equal(csvCell('- note'), '- note');
});

test('Markdown: front matter, summary, table with escaped pipes, wikilinks and URL fallback', () => {
	const rows = [
		sub(1, { page: { title: '定价 | 思路', url: 'https://share.fsky.top/s/X/plans/a.html', path: '/s/X/plans/a.html', file: 'plans/claim-and-upgrade' }, referrerHost: 'a|b.example' }),
		sub(2, { email: 'pipe|odd@example.com', page: { title: 'Lost [draft]', url: 'https://share.fsky.top/s/X/lost (1).html', path: '/s/X/lost.html', file: 'lost' } }),
		sub(3, { page: { title: '定价 | 思路', url: 'https://share.fsky.top/s/X/plans/a.html', path: '/s/X/plans/a.html', file: 'plans/claim-and-upgrade' } }),
	];
	const md = buildMarkdown(rows, {
		project: { id: P, title: 'sunwei.xyz', publicUrl: 'https://share.fsky.top/s/LNyLAM/', status: 'published' },
		sourcePath: 'Docs', vault, exportedAt: new Date(2026, 9, 3, 14, 30),
		summary: { total: 3, new7d: 3, new30d: 3 },
	});
	assert.match(md, /^---\ntype: mdfriday-subscribers\nsite: "sunwei\.xyz"\nproject: p_66c1869e4ef175af1b20ba80abfcd96f\nsite_url: "https:\/\/share\.fsky\.top\/s\/LNyLAM\/"\nstatus: "published"\nexported_at: 2026-10-03T14:30:00[+-]\d\d:\d\d\ntotal: 3\n---\n# Subscribers · sunwei\.xyz\n/);
	assert.ok(md.includes('- Total **3** · last 7 days **3** · last 30 days **3**'));
	assert.ok(md.includes('- Top article: [[Docs/plans/Claim-and-Upgrade|定价 思路]] (2)'), md);
	assert.ok(md.includes('| 1 | u1@example.com | 2026-10-03 '));
	assert.ok(md.includes('| [[Docs/plans/Claim-and-Upgrade\\|定价 思路]] | a\\|b.example |'));
	assert.ok(md.includes('| pipe\\|odd@example.com |'));
	assert.ok(md.includes('[Lost \\[draft\\]](https://share.fsky.top/s/X/lost%20(1%29.html)'));
	// every table row has exactly 6 unescaped pipes
	for (const line of md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| #'))) {
		assert.equal(line.replace(/\\\|/g, '').split('|').length - 1, 6, line);
	}
	assert.equal(mdCell('a|b\nc'), 'a\\|b c');
	assert.equal(articleCell({ title: '', path: '/x' }, null), '/x');
	assert.equal(articleCell(null, null), '—');
});

test('Markdown + picker: deleted projects show purge date', () => {
	const purgeAt = new Date(2026, 10, 2, 12).toISOString();
	const proj = { id: P, title: 'Old', status: 'deleted', deletedAt: new Date(2026, 9, 3).toISOString(), purgeAt };
	const md = buildMarkdown([], { project: proj, sourcePath: 'Docs', vault, exportedAt: new Date(2026, 9, 3) });
	assert.ok(md.includes('status: "deleted (purges 2026-11-02)"'));
	assert.ok(md.includes('Site deleted · subscribers purge on 2026-11-02'));
	assert.ok(md.includes('No subscribers yet'));
	assert.equal(pickerLabel({ ...proj, subscriberCount: 4 }, 'deleted · purges on {{date}}'), 'Old (4) — deleted · purges on 2026-11-02');
	assert.equal(pickerLabel({ id: P, siteId: 'LNyLAM' }, 'x'), 'LNyLAM');
});

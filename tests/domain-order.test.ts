import assert from 'node:assert/strict';
import test from 'node:test';
import { dnsShortHost } from '../src/services/dns-host.ts';
import { oldestFirst, primaryDomain } from '../src/services/domain-order.ts';

test('dnsShortHost keeps subdomain hosts and uses @ for the apex', () => {
	assert.equal(dnsShortHost('www.sunwei.xyz'), 'www');
	assert.equal(dnsShortHost('sunwei.xyz'), '@');
	assert.equal(dnsShortHost('_mdfriday-verify.sunwei.xyz'), '_mdfriday-verify');
	assert.equal(dnsShortHost('_acme-challenge.sunwei.xyz'), '_acme-challenge');
	assert.equal(dnsShortHost('_acme-challenge.www.sunwei.xyz'), '_acme-challenge.www');
	assert.equal(dnsShortHost('_mdfriday-verify.www.sunwei.xyz'), '_mdfriday-verify.www');
});

test('oldestFirst reverses the newest-first API list', () => {
	const rows = [{ hostname: 'newer.example' }, { hostname: 'older.example' }];
	assert.deepEqual(
		oldestFirst(rows).map((row) => row.hostname),
		['older.example', 'newer.example'],
	);
});

test('primaryDomain is the oldest active hostname', () => {
	const primary = primaryDomain([
		{ hostname: 'second.example', status: 'active', certStatus: 'active' },
		{ hostname: 'first.example', status: 'active', certStatus: 'active' },
		{ hostname: 'pending.example', status: 'pending', certStatus: 'provisioning' },
	]);
	assert.equal(primary?.hostname, 'first.example');
});

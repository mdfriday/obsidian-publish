/**
 * Short Host for a registrar panel that already has the zone selected.
 * Assumes a 2-label public suffix (example.com), same rule as subdomains.
 * www.example.com → www
 * example.com → @
 * _acme-challenge.example.com → _acme-challenge
 * _acme-challenge.www.example.com → _acme-challenge.www
 */
export function dnsShortHost(fqdn: string): string {
	const host = fqdn.replace(/\.$/, '').toLowerCase();
	const parts = host.split('.').filter(Boolean);
	if (parts.length >= 3) return parts.slice(0, -2).join('.');
	if (parts.length === 2) return '@';
	return host;
}

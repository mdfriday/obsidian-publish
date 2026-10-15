export type DomainOrderRow = {
	hostname?: string;
	status?: string;
	certStatus?: string;
};

/** GET /v1/projects/:id/domains is newest-first. Callers that mean "the first domain" want oldest-first, matching share redirect and publish route writes. */
export function oldestFirst<T>(domains: readonly T[] | undefined): T[] {
	return [...(domains ?? [])].reverse();
}

export function primaryDomain<T extends DomainOrderRow>(
	domains: readonly T[] | undefined,
): T | undefined {
	const ordered = oldestFirst(domains);
	return (
		ordered.find((d) => (d.status || '').toLowerCase() === 'active' && d.hostname) ??
		ordered.find((d) => (d.certStatus || '').toLowerCase() === 'active' && d.hostname)
	);
}

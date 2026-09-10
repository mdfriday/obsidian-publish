/**
 * License feature flags from Foundry license info (legacy sync/publish plans).
 * Kept as a type for LicenseStateManager; site access password is unrelated.
 */
export interface LicenseFeatures {
	maxDevices: number;
	maxIps: number;
	syncEnabled: boolean;
	syncQuota: number;
	publishEnabled: boolean;
	maxSites: number;
	maxStorage: number;
	customDomain: boolean;
	customSubDomain: boolean;
	validityDays: number;
}

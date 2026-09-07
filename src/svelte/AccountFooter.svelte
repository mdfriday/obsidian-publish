<script lang="ts">
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let onContinueAuth: () => void;
	export let onOpenAccount: () => void;

	$: t = plugin.i18n?.t || ((key: string) => key);

	$: kind = (plugin.settings.mdfKeyKind || '').toLowerCase();
	$: plan = (plugin.settings.mdfKeyPlan || '').toLowerCase();
	$: hasKey = !!plugin.settings.mdfKey;
	$: email = (plugin.settings.mdfAccountEmail || '').trim();

	$: accountState = (!hasKey
		? 'guest_unverified'
		: kind === 'guest' || plan === 'guest'
			? 'guest_daily'
			: plan === 'personal' || plan === 'pro'
				? 'personal'
				: 'free') as
		| 'guest_unverified'
		| 'guest_daily'
		| 'free'
		| 'personal';

	$: accountUrl = (plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account').replace(
		/\/$/,
		'',
	);

	$: freeTitle = email
		? t('ui.account_free_title', { email })
		: t('ui.account_free_title_no_email');
	$: personalTitle = email
		? t('ui.account_personal_title', { email })
		: t('ui.account_personal_title_no_email');

	function accountUrlWithKey(extra = '') {
		const key = plugin.settings.mdfKey;
		const q = new URLSearchParams();
		if (key) q.set('key', key);
		if (extra === 'upgrade') q.set('upgrade', 'personal');
		const qs = q.toString();
		return qs ? `${accountUrl}/?${qs}` : `${accountUrl}/`;
	}

	function openAuth() {
		void onContinueAuth();
	}

	function openClaimFree() {
		window.open(accountUrlWithKey(), '_blank', 'noopener');
	}

	function openUpgradePersonal() {
		window.open(accountUrlWithKey('upgrade'), '_blank', 'noopener');
	}

	function openManageAccount() {
		void onOpenAccount();
	}

	function openManageSubscription() {
		window.open(accountUrlWithKey(), '_blank', 'noopener');
	}
</script>

<div class="account-footer" data-state={accountState}>
	{#if accountState === 'guest_unverified'}
		<div class="af-card">
			<div class="af-avatar" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
			</div>
			<div class="af-main">
				<div class="af-title">{t('ui.account_guest_unverified_title')}</div>
				<div class="af-sub">{t('ui.account_guest_unverified_sub')}</div>
			</div>
			<div class="af-actions">
				<button class="af-cta" type="button" on:click={openAuth}>
					{t('ui.account_go_verify')} ↗
				</button>
			</div>
		</div>
	{:else if accountState === 'guest_daily'}
		<div class="af-card">
			<div class="af-avatar" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
			</div>
			<div class="af-main">
				<div class="af-title">{t('ui.account_guest_ready_title')}</div>
				<div class="af-sub">{t('ui.account_guest_ready_sub')}</div>
			</div>
			<div class="af-actions af-links">
				<button class="af-link" type="button" on:click={openClaimFree}>
					{t('ui.account_claim_free')}
				</button>
				<span class="af-sep" aria-hidden="true">·</span>
				<button class="af-link" type="button" on:click={openUpgradePersonal}>
					{t('ui.account_upgrade_personal')}
				</button>
			</div>
		</div>
	{:else if accountState === 'free'}
		<div class="af-card">
			<div class="af-avatar" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
			</div>
			<div class="af-main">
				<div class="af-title">{freeTitle}</div>
				<div class="af-sub">{t('ui.account_free_sub')}</div>
			</div>
			<div class="af-actions af-links">
				<button class="af-link" type="button" on:click={openManageAccount}>
					{t('ui.account_manage')} ↗
				</button>
				<span class="af-sep" aria-hidden="true">·</span>
				<button class="af-link" type="button" on:click={openUpgradePersonal}>
					{t('ui.account_upgrade_personal')}
				</button>
				<span class="af-sep" aria-hidden="true">·</span>
				<span class="af-price">{t('ui.account_personal_price')}</span>
			</div>
		</div>
	{:else}
		<div class="af-card">
			<div class="af-avatar" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
					<circle cx="12" cy="7" r="4"></circle>
				</svg>
			</div>
			<div class="af-main">
				<div class="af-title">{personalTitle}</div>
				<div class="af-sub">{t('ui.account_personal_sub')}</div>
			</div>
			<div class="af-actions">
				<button class="af-link" type="button" on:click={openManageSubscription}>
					{t('ui.account_manage_sub')} ↗
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.account-footer {
		margin: 0;
		padding: 10px 0 0;
		border: none;
		background: transparent;
	}

	.af-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 8px;
		background: var(--mdf-card, #ffffff);
		box-sizing: border-box;
	}

	.af-avatar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--mdf-soft, #e7e9ee);
		color: var(--mdf-hint, #8b8fa3);
	}

	.af-main {
		min-width: 0;
		flex: 1;
	}

	.af-title {
		font-family: var(--font-interface);
		font-size: 13px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.af-sub {
		margin-top: 2px;
		font-size: 11px;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.4;
	}

	.af-actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.af-links {
		flex-wrap: wrap;
		gap: 0 2px;
		max-width: 48%;
		justify-content: flex-end;
	}

	.af-cta {
		padding: 0 10px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: var(--mdf-primary, #9375ef);
		color: #fff;
		font-family: var(--font-interface);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.af-cta:hover {
		opacity: 0.92;
	}

	.af-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--mdf-primary, #9375ef);
		font-family: var(--font-interface);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		line-height: 1.3;
	}

	.af-link:hover {
		opacity: 0.85;
	}

	.af-sep {
		color: var(--mdf-hint, #8b8fa3);
		font-size: 11px;
		padding: 0 2px;
		user-select: none;
	}

	.af-price {
		color: var(--mdf-hint, #8b8fa3);
		font-size: 11px;
		font-weight: 500;
		white-space: nowrap;
	}
</style>

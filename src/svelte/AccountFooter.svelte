<script lang="ts">
	import type FridayPlugin from '../main';

	export let plugin: FridayPlugin;
	export let onContinueAuth: () => void;
	export let onOpenAccount: () => void;

	$: t = plugin.i18n?.t || ((key: string) => key);

	$: kind = (plugin.settings.mdfKeyKind || '').toLowerCase();
	$: plan = (plugin.settings.mdfKeyPlan || '').toLowerCase();
	$: hasKey = !!plugin.settings.mdfKey;

	$: accountState = (!hasKey
		? 'guest_unverified'
		: kind === 'guest' || plan === 'guest'
			? 'guest_daily'
			: plan === 'personal' || plan === 'pro'
				? 'pro'
				: 'google_free') as
		| 'guest_unverified'
		| 'guest_daily'
		| 'google_free'
		| 'pro';

	$: usedBytes = plugin.settings.mdfStorageBytes ?? 0;
	$: quotaBytes = plugin.settings.mdfQuotaStorageBytes ?? 0;
	$: usedLabel = formatBytes(usedBytes);
	$: quotaLabel = quotaBytes > 0 ? formatBytes(quotaBytes) : '—';

	$: accountUrl = (plugin.settings.cloudflareAccountBaseUrl || 'https://mdfriday.com/account').replace(
		/\/$/,
		'',
	);

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
		return `${(n / (1024 * 1024)).toFixed(0)}M`;
	}

	function openUpgrade() {
		window.open(`${accountUrl}?upgrade=pro`, '_blank', 'noopener');
	}

	function openManage() {
		void onOpenAccount();
	}

	function openAuth() {
		void onContinueAuth();
	}
</script>

<div class="account-footer" data-state={accountState}>
	{#if accountState === 'guest_unverified'}
		<div class="af-compact">
			<div class="af-quota">
				<div class="af-quota-title">{t('ui.account_guest_title')}</div>
				<div class="af-quota-sub">{t('ui.account_guest_hint')}</div>
			</div>
			<button class="af-auth-cta" type="button" on:click={openAuth}>
				{t('ui.account_go_auth')}
			</button>
		</div>
	{:else if accountState === 'guest_daily'}
		<div class="af-compact">
			<div class="af-quota">
				<div class="af-quota-title">{t('ui.account_daily_title')}</div>
				<div class="af-quota-sub">{t('ui.account_daily_hint')}</div>
			</div>
			<div class="af-btns">
				<button class="af-btn" type="button" on:click={openManage}>{t('ui.account_google_login')}</button>
				<button class="af-btn" type="button" on:click={openUpgrade}>Upgrade</button>
			</div>
		</div>
	{:else if accountState === 'google_free'}
		<div class="af-compact">
			<div class="af-quota">
				<div class="af-quota-title">{t('ui.account_free_badge')}</div>
				<div class="af-quota-sub">{usedLabel} / {quotaLabel || '50M'}</div>
			</div>
			<div class="af-btns">
				<button class="af-btn" type="button" on:click={openUpgrade}>Upgrade</button>
				<button class="af-link" type="button" on:click={openManage}>{t('ui.account_manage')} ↗</button>
			</div>
		</div>
	{:else}
		<div class="af-compact">
			<div class="af-quota">
				<div class="af-quota-title">Pro</div>
				<div class="af-quota-sub">{usedLabel} / {quotaLabel || '1G'}</div>
			</div>
			<button class="af-link" type="button" on:click={openManage}>{t('ui.account_manage_sub')} ↗</button>
		</div>
	{/if}
</div>

<style>
	.account-footer {
		margin: 0;
		padding: 10px 0 0;
		border: none;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.af-compact {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.af-quota {
		min-width: 0;
		flex: 1;
	}

	.af-quota-title {
		font-family: var(--font-interface);
		font-size: 13px;
		font-weight: 600;
		color: var(--mdf-ink, #2e303b);
	}

	.af-quota-sub {
		margin-top: 3px;
		font-size: 12px;
		color: var(--mdf-hint, #8b8fa3);
		line-height: 1.35;
	}

	.af-btns {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.af-btn {
		padding: 0 10px;
		height: 28px;
		border: 1px solid var(--mdf-stroke, #bdc0cb);
		border-radius: 6px;
		background: transparent;
		color: var(--mdf-muted, #4d4f67);
		font-family: var(--font-interface);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	.af-auth-cta {
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--mdf-primary, #9375ef);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.af-link {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--mdf-hint, #8b8fa3);
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
	}
</style>

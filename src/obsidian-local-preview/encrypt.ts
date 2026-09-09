/**
 * Faithful-publish encrypt gate — same AES-GCM contract + UI as theme base encrypt cap.
 *
 * Build-time: Node encryptAESGCM (matches Foundry).
 * Runtime: CSS/JS from theme CDN (`t/base/{ver}/…`).
 *
 * Faithful packages also embed Obsidian app/theme CSS. That sheet uses selectors like
 * `.theme-light button` (specificity beats `.mdf-btn-primary`), so gate assets must:
 *   1. Load *after* Obsidian CSS
 *   2. Re-assert colors under `#mdf-encrypt-modal` (gate-only island; does not touch note HTML)
 */

import * as crypto from 'crypto';

/**
 * Concrete CDN folder for base encrypt assets.
 * Keep aligned with notes/quartz `engine.base` (e.g. ^2.2.1 → 2.2.1).
 */
export const ENCRYPT_GATE_BASE_VERSION = '2.2.1';

/**
 * Gate-only overrides. Scoped to `#mdf-encrypt-modal` so Obsidian preview CSS
 * cannot restyle the unlock UI, and unlock styles cannot leak into note content.
 */
export const ENCRYPT_GATE_ISOLATE_CSS = `
#mdf-encrypt-modal {
  color: var(--mdf-encrypt-base-dark, #0d0f2c);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
#mdf-encrypt-modal *,
#mdf-encrypt-modal *::before,
#mdf-encrypt-modal *::after {
  box-sizing: border-box;
}
#mdf-encrypt-modal .mdf-unlock-title,
#mdf-encrypt-modal .mdf-unlock-label {
  color: var(--mdf-encrypt-base-dark, #0d0f2c);
}
#mdf-encrypt-modal .mdf-unlock-zh,
#mdf-encrypt-modal .mdf-unlock-helper {
  color: var(--mdf-encrypt-grey-500, #969bb5);
}
#mdf-encrypt-modal .mdf-unlock-body {
  color: var(--mdf-encrypt-grey-600, #656c86);
}
#mdf-encrypt-modal #mdf-password-input {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--mdf-encrypt-grey-200, #e6eaf4);
  border-radius: 12px;
  font-size: 15px;
  line-height: 1.4;
  color: var(--mdf-encrypt-base-dark, #0d0f2c);
  background: #fff;
  font-family: inherit;
}
#mdf-encrypt-modal #mdf-password-input:focus {
  outline: none;
  border-color: var(--mdf-encrypt-indigo-500, #3e57da);
  box-shadow: 0 0 0 3px rgba(62, 87, 218, 0.15);
}
#mdf-encrypt-modal #mdf-password-input.is-error,
#mdf-encrypt-modal .mdf-unlock-card.is-error #mdf-password-input {
  border-color: var(--mdf-encrypt-danger, #d92d20);
  background: var(--mdf-encrypt-danger-bg, #fef3f2);
}
#mdf-encrypt-modal #mdf-decrypt-btn,
#mdf-encrypt-modal .mdf-btn-primary {
  appearance: none;
  -webkit-appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 16px;
  padding: 14px 22px;
  border: none;
  border-radius: var(--mdf-encrypt-radius-btn, 999px);
  background: var(--mdf-encrypt-indigo-500, #3e57da);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 12px rgba(62, 87, 218, 0.28);
}
#mdf-encrypt-modal #mdf-decrypt-btn:hover:not(:disabled),
#mdf-encrypt-modal .mdf-btn-primary:hover:not(:disabled) {
  background: var(--mdf-encrypt-indigo-600, #2c43b8);
  color: #fff;
}
#mdf-encrypt-modal #mdf-decrypt-btn:disabled,
#mdf-encrypt-modal .mdf-btn-primary:disabled {
  cursor: wait;
  opacity: 0.85;
  color: #fff;
}
#mdf-encrypt-modal #mdf-error-message {
  color: var(--mdf-encrypt-danger, #d92d20);
}
`.trim();

export function encryptAESGCM(password: string, content: string): string {
	if (!password || !content) return '';
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

/** Absolute URLs for base encrypt gate assets on theme CDN. */
export function encryptGateAssetUrls(
	cdnOrigin: string,
	baseVersion: string = ENCRYPT_GATE_BASE_VERSION,
): { css: string; js: string } {
	const root = `${cdnOrigin.replace(/\/$/, '')}/t/base/${baseVersion}`;
	return {
		css: `${root}/caps/encrypt/style.css`,
		js: `${root}/decrypt.js`,
	};
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Markup matching theme `encrypt-content` + `encrypt-modal` partials.
 * `headExtra` must be placed *after* Obsidian theme CSS in faithful packages.
 */
export function buildEncryptGateHtml(opts: {
	encryptedBase64: string;
	/** page = single note; site = folder / whole site */
	level: 'page' | 'site';
	path: string;
	titleZh: string;
	/** Theme CDN origin, e.g. https://cdn.fsky.top */
	cdnOrigin: string;
	baseVersion?: string;
}): { bodyInner: string; headExtra: string } {
	const assets = encryptGateAssetUrls(opts.cdnOrigin, opts.baseVersion);
	const eyebrow =
		opts.level === 'site'
			? 'Protected site · Password required'
			: 'Protected content · Password required';
	const body =
		opts.level === 'site'
			? 'This site is encrypted by the publisher. Enter the access password to decrypt and view.'
			: 'This page is encrypted by the publisher. Enter the access password to decrypt and view.';
	const zh = opts.titleZh || '内容已加密，输入访问密码后继续';

	const headExtra = `<link rel="stylesheet" href="${escapeAttr(assets.css)}">
<style id="mdf-encrypt-isolate">${ENCRYPT_GATE_ISOLATE_CSS}</style>`;
	const bodyInner = `
<div
  id="mdf-encrypt-content"
  data-encrypted="${escapeAttr(opts.encryptedBase64)}"
  data-level="${opts.level}"
  data-path="${escapeAttr(opts.path)}"
></div>
<div id="mdf-encrypt-modal" class="mdf-modal" role="dialog" aria-modal="true" aria-labelledby="mdf-unlock-title">
  <div class="mdf-modal__decor" aria-hidden="true">
    <div class="mdf-modal__blob mdf-modal__blob--1"></div>
    <div class="mdf-modal__blob mdf-modal__blob--2"></div>
  </div>
  <div class="mdf-modal-content">
    <div class="mdf-unlock-eyebrow">
      <span class="mdf-unlock-eyebrow__dot" aria-hidden="true"></span>
      <span>${eyebrow}</span>
    </div>
    <h1 class="mdf-unlock-title" id="mdf-unlock-title">Enter password to continue</h1>
    <p class="mdf-unlock-zh" lang="zh-CN">${zh}</p>
    <p class="mdf-unlock-body">${body}</p>
    <div class="mdf-unlock-card" id="mdf-unlock-card">
      <label class="mdf-unlock-label" for="mdf-password-input">Access password</label>
      <input
        type="password"
        id="mdf-password-input"
        class="mdf-unlock-input"
        placeholder="Access password"
        autocomplete="current-password"
        autofocus
      />
      <div id="mdf-error-message" class="mdf-error-hidden" role="alert">
        Wrong password. Check with the publisher and try again.
      </div>
      <button type="button" id="mdf-decrypt-btn" class="mdf-btn-primary">Unlock</button>
      <p class="mdf-unlock-helper">Contact the publisher if you don’t have the password.</p>
    </div>
  </div>
</div>
<script defer src="${escapeAttr(assets.js)}"></script>
`;
	return { bodyInner, headExtra };
}

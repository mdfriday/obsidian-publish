/**
 * AES-GCM helpers matching Foundry NodeTemplateCryptoService + theme decrypt.js.
 * Format: base64(salt[16] | iv[12] | tag[16] | ciphertext)
 */

import * as crypto from 'crypto';

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

/** Minimal decrypt.js (same contract as theme/families/base/static/decrypt.js). */
export const DECRYPT_JS = `async function decryptAESGCM(password, base64Data) {
  const raw = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const tag = raw.slice(28, 44);
  const ciphertext = raw.slice(44);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextWithTag);
  return new TextDecoder().decode(decrypted);
}

async function handleDecryption(providedPassword = null) {
  const contentEl = document.getElementById("mdf-encrypt-content");
  const passwordInput = document.getElementById("mdf-password-input");
  const errorMsg = document.getElementById("mdf-error-message");
  const decryptBtn = document.getElementById("mdf-decrypt-btn");
  const modal = document.getElementById("mdf-encrypt-modal");
  if (!contentEl) return;
  const encrypted = contentEl.dataset.encrypted;
  const path = contentEl.dataset.path || "";
  let password = providedPassword;
  if (!password && passwordInput) password = passwordInput.value.trim();
  if (!password) {
    if (errorMsg) {
      errorMsg.textContent = "Please enter your password";
      errorMsg.classList.remove("mdf-error-hidden");
    }
    return;
  }
  if (!providedPassword && decryptBtn) {
    decryptBtn.disabled = true;
    decryptBtn.textContent = "Unlocking…";
  }
  if (errorMsg) errorMsg.classList.add("mdf-error-hidden");
  try {
    const content = await decryptAESGCM(password, encrypted);
    contentEl.innerHTML = content;
    contentEl.removeAttribute("data-encrypted");
    contentEl.removeAttribute("data-level");
    contentEl.removeAttribute("data-path");
    if (modal) modal.style.display = "none";
    if (path) sessionStorage.setItem("mdf-password-" + path, password);
    return true;
  } catch (e) {
    if (providedPassword) return false;
    if (errorMsg) {
      errorMsg.textContent = "Incorrect password, please try again.";
      errorMsg.classList.remove("mdf-error-hidden");
    }
    if (passwordInput) { passwordInput.value = ""; passwordInput.focus(); }
    return false;
  } finally {
    if (!providedPassword && decryptBtn) {
      decryptBtn.disabled = false;
      decryptBtn.textContent = "Unlock";
    }
  }
}

async function tryAutoDecrypt() {
  const contentEl = document.getElementById("mdf-encrypt-content");
  if (!contentEl) return false;
  const path = contentEl.dataset.path || "";
  if (!path) return false;
  const cached = sessionStorage.getItem("mdf-password-" + path);
  if (!cached) return false;
  const ok = await handleDecryption(cached);
  if (!ok) sessionStorage.removeItem("mdf-password-" + path);
  return ok;
}

async function initEncryptedContent() {
  const contentEl = document.getElementById("mdf-encrypt-content");
  if (!contentEl) return;
  const modal = document.getElementById("mdf-encrypt-modal");
  const decryptBtn = document.getElementById("mdf-decrypt-btn");
  const passwordInput = document.getElementById("mdf-password-input");
  if (await tryAutoDecrypt()) {
    if (modal) modal.style.display = "none";
    return;
  }
  if (modal) modal.style.display = "flex";
  if (decryptBtn) decryptBtn.addEventListener("click", () => handleDecryption());
  if (passwordInput) {
    passwordInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleDecryption();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEncryptedContent);
} else {
  initEncryptedContent();
}
`;

export const ENCRYPT_CSS = `
.mdf-modal {
  position: fixed; z-index: 9999; inset: 0;
  display: none; justify-content: center; align-items: center;
  background: rgba(0,0,0,.35);
}
.mdf-modal-content {
  background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.2);
  max-width: 420px; width: 90%;
}
.mdf-modal-header { padding: 20px 24px; border-bottom: 1px solid #e0e0e0; }
.mdf-modal-header h2 { margin: 0; font-size: 1.25rem; color: #333; }
.mdf-modal-body { padding: 24px; }
.mdf-modal-body p { margin: 0 0 16px; color: #666; }
#mdf-password-input {
  width: 100%; padding: 12px 16px; border: 2px solid #e0e0e0;
  border-radius: 4px; font-size: 1rem; box-sizing: border-box;
}
#mdf-password-input:focus { outline: none; border-color: #3E57DA; }
#mdf-error-message {
  margin-top: 12px; padding: 8px 12px; background: #ffebee; color: #c62828;
  border-radius: 4px; font-size: 0.9rem;
}
.mdf-error-hidden { display: none; }
.mdf-modal-footer {
  padding: 16px 24px; border-top: 1px solid #e0e0e0;
  display: flex; justify-content: flex-end;
}
.mdf-btn-primary {
  background: #3E57DA; color: #fff; border: none;
  padding: 10px 24px; border-radius: 6px; font-size: 1rem; cursor: pointer;
}
.mdf-btn-primary:hover { filter: brightness(1.05); }
@media (prefers-color-scheme: dark) {
  .mdf-modal-content { background: #1e1e1e; }
  .mdf-modal-header h2 { color: #eee; }
  .mdf-modal-body p { color: #aaa; }
  #mdf-password-input { background: #111; color: #eee; border-color: #444; }
}
`;

export function buildEncryptGateHtml(opts: {
	encryptedBase64: string;
	/** page = single note; site = folder / whole site */
	level: 'page' | 'site';
	path: string;
	titleZh: string;
}): { bodyInner: string; headExtra: string } {
	const title =
		opts.level === 'site' ? 'This site is encrypted' : 'This note is encrypted';
	const headExtra = `<style>${ENCRYPT_CSS}</style>`;
	const bodyInner = `
<div
  id="mdf-encrypt-content"
  data-encrypted="${opts.encryptedBase64.replace(/"/g, '&quot;')}"
  data-level="${opts.level}"
  data-path="${opts.path.replace(/"/g, '&quot;')}"
></div>
<div id="mdf-encrypt-modal" class="mdf-modal">
  <div class="mdf-modal-content">
    <div class="mdf-modal-header"><h2>${title}</h2></div>
    <div class="mdf-modal-body">
      <p>${opts.titleZh}</p>
      <input type="password" id="mdf-password-input" placeholder="Password" autofocus />
      <div id="mdf-error-message" class="mdf-error-hidden">Incorrect password, please try again.</div>
    </div>
    <div class="mdf-modal-footer">
      <button id="mdf-decrypt-btn" class="mdf-btn-primary">Unlock</button>
    </div>
  </div>
</div>
<script>${DECRYPT_JS}</script>
`;
	return { bodyInner, headExtra };
}

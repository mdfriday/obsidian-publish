import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import type FridayPlugin from './main';

/** Obsidian official protocol: obsidian://mdfriday-publish?... */
export const OBSIDIAN_PROTOCOL_ACTION = 'mdfriday-publish';

const WORKSPACE_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private credentialDesc(mdfKey: string | null): string {
		return mdfKey
			? `Key ${mdfKey.slice(0, 12)}… — copy to use on Account or another device.`
			: 'Not created yet — issued automatically on first publish.';
	}

	/**
	 * Obsidian 1.13.0+: declarative definitions for settings UI + global search.
	 * Call `this.update()` after mdfKey (or other shown fields) change so Obsidian
	 * re-runs this and refreshes the cached settingItems / search index.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const mdfKey = this.plugin.settings.mdfKey;

		return [
			{
				name: 'Credential (mdf key)',
				desc: this.credentialDesc(mdfKey),
				aliases: ['mdf key', 'credential', 'api key', 'mdfriday key'],
				render: (setting) => {
					// Re-read on each render in case the tab was open across a mint.
					const key = this.plugin.settings.mdfKey;
					setting.setDesc(this.credentialDesc(key));
					setting.addExtraButton((btn) => {
						btn.setIcon('copy');
						btn.setTooltip('Copy key');
						btn.setDisabled(!key);
						btn.onClick(async () => {
							const live = this.plugin.settings.mdfKey;
							if (!live) return;
							await navigator.clipboard.writeText(live);
							new Notice('Mdf key copied', 2000);
						});
					});
				},
			},
			{
				name: 'Workspace ID',
				desc:
					'Identifies this Obsidian vault for publish. Same path in another vault needs a different ID. ' +
					'On a new machine, paste the ID from your other vault (or from the Account dashboard) so projects line up.',
				aliases: ['workspace id', 'vault id', 'workspace'],
				render: (setting) => {
					const live = this.plugin.getWorkspaceId();
					setting.setDesc(
						`Current: ${live}. Edit to match another device’s vault, then save.`,
					);
					setting.addText((text) => {
						text.setPlaceholder('UUID…');
						text.setValue(this.plugin.getWorkspaceId());
						text.inputEl.addClass('mdfriday-workspace-id-input');
						text.onChange((value) => {
							// Draft only — persist on blur / Save button.
							void value;
						});
						text.inputEl.addEventListener('blur', () => {
							void this.persistWorkspaceId(text.getValue());
						});
					});
					setting.addButton((btn) => {
						btn.setButtonText('Save');
						btn.setCta();
						btn.onClick(async () => {
							const input = setting.settingEl.querySelector(
								'input.mdfriday-workspace-id-input',
							);
							const value =
								input?.instanceOf(HTMLInputElement) ? input.value : '';
							await this.persistWorkspaceId(value);
						});
					});
					setting.addExtraButton((btn) => {
						btn.setIcon('copy');
						btn.setTooltip('Copy workspace ID');
						btn.onClick(async () => {
							await navigator.clipboard.writeText(this.plugin.getWorkspaceId());
							new Notice('Workspace ID copied', 2000);
						});
					});
					setting.addExtraButton((btn) => {
						btn.setIcon('refresh-cw');
						btn.setTooltip(
							'Generate new workspace ID (breaks match until you update other devices)',
						);
						btn.onClick(async () => {
							const next = this.plugin.generateWorkspaceId();
							this.plugin.settings.workspaceId = next;
							await this.plugin.saveSettings();
							const input = setting.settingEl.querySelector(
								'input.mdfriday-workspace-id-input',
							);
							if (input?.instanceOf(HTMLInputElement)) input.value = next;
							new Notice(
								'New workspace ID saved — update other devices if needed',
								5000,
							);
							this.plugin.settingTab?.update?.();
						});
					});
				},
			},
		];
	}

	private async persistWorkspaceId(raw: string): Promise<void> {
		const next = raw.trim();
		if (!next || !WORKSPACE_ID_RE.test(next)) {
			new Notice(
				'Workspace ID must be 1–128 characters: letters, digits, . _ : -',
				4000,
			);
			return;
		}
		if (next === this.plugin.getWorkspaceId()) return;
		this.plugin.settings.workspaceId = next;
		await this.plugin.saveSettings();
		new Notice('Workspace ID saved', 2500);
		this.plugin.settingTab?.update?.();
	}
}

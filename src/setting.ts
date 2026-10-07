import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
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
		const workspaceId = this.plugin.getWorkspaceId();

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
					'Identifies this Obsidian vault for publish. Same path in another vault needs a different id. ' +
					'On a new machine, paste the id from your other vault (or from the Account dashboard) so projects line up.',
				aliases: ['workspace id', 'vault id', 'workspace'],
				render: (setting) => {
					const live = this.plugin.getWorkspaceId();
					setting.setDesc(
						`Current: ${live}. Edit to match another device’s vault, then save.`,
					);
					setting.addText((text) => {
						text.setPlaceholder('uuid…');
						text.setValue(this.plugin.getWorkspaceId());
						text.inputEl.addClass('mdfriday-workspace-id-input');
						text.inputEl.style.width = '100%';
						text.inputEl.style.minWidth = '16rem';
						text.onChange((value) => {
							// Draft only — persist on blur / Save button.
							void value;
						});
						text.inputEl.addEventListener('blur', async () => {
							await this.persistWorkspaceId(text.getValue());
						});
					});
					setting.addButton((btn) => {
						btn.setButtonText('Save');
						btn.setCta();
						btn.onClick(async () => {
							const input = setting.settingEl.querySelector(
								'input.mdfriday-workspace-id-input',
							) as HTMLInputElement | null;
							await this.persistWorkspaceId(input?.value ?? '');
						});
					});
					setting.addExtraButton((btn) => {
						btn.setIcon('copy');
						btn.setTooltip('Copy workspace id');
						btn.onClick(async () => {
							await navigator.clipboard.writeText(this.plugin.getWorkspaceId());
							new Notice('Workspace ID copied', 2000);
						});
					});
					setting.addExtraButton((btn) => {
						btn.setIcon('refresh-cw');
						btn.setTooltip('Generate new workspace id (breaks match until you update other devices)');
						btn.onClick(async () => {
							const next = this.plugin.generateWorkspaceId();
							this.plugin.settings.workspaceId = next;
							await this.plugin.saveSettings();
							const input = setting.settingEl.querySelector(
								'input.mdfriday-workspace-id-input',
							) as HTMLInputElement | null;
							if (input) input.value = next;
							new Notice('New Workspace ID saved — update other devices if needed', 5000);
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'MDFriday Publish' });

		// Fallback for Obsidian builds that do not call getSettingDefinitions for display.
		new Setting(containerEl)
			.setName('Credential (mdf key)')
			.setDesc(this.credentialDesc(this.plugin.settings.mdfKey))
			.addExtraButton((btn) => {
				btn.setIcon('copy');
				btn.setTooltip('Copy key');
				btn.setDisabled(!this.plugin.settings.mdfKey);
				btn.onClick(async () => {
					const live = this.plugin.settings.mdfKey;
					if (!live) return;
					await navigator.clipboard.writeText(live);
					new Notice('Mdf key copied', 2000);
				});
			});

		let draft = this.plugin.getWorkspaceId();
		new Setting(containerEl)
			.setName('Workspace ID')
			.setDesc(
				'Identifies this vault for publish matching across machines. Paste the same id on another device to reclaim projects.',
			)
			.addText((text) => {
				text.setValue(draft);
				text.inputEl.style.width = '100%';
				text.inputEl.style.minWidth = '16rem';
				text.onChange((v) => {
					draft = v;
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Save');
				btn.setCta();
				btn.onClick(async () => {
					await this.persistWorkspaceId(draft);
					draft = this.plugin.getWorkspaceId();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon('copy');
				btn.setTooltip('Copy');
				btn.onClick(async () => {
					await navigator.clipboard.writeText(this.plugin.getWorkspaceId());
					new Notice('Workspace ID copied', 2000);
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon('refresh-cw');
				btn.setTooltip('Generate new id');
				btn.onClick(async () => {
					const next = this.plugin.generateWorkspaceId();
					this.plugin.settings.workspaceId = next;
					await this.plugin.saveSettings();
					draft = next;
					this.display();
					new Notice('New Workspace ID saved', 4000);
				});
			});
	}
}

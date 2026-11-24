import { PluginSettingTab, SecretComponent, Setting, type App, type Plugin } from 'obsidian';
import { probeAuth } from '../onboarding/auth-probe';
import { checkClaude, locateClaude } from '../onboarding/claude-code-locator';
import { EFFORT_CHOICES, MODEL_CHOICES, type LlmSessionsSettings } from './settings';
import type { Effort } from '../types';

export interface SettingsHost {
	settings: LlmSessionsSettings;
	saveSettings: () => Promise<void>;
	apiKey: () => string | null;
	vaultBasePath: () => string;
	connectionStatus: string;
	setConnectionStatus: (status: string) => void;
	runOnboarding: () => void;
}

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export class LlmSessionsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private host: SettingsHost,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.host.settings;
		const save = () => void this.host.saveSettings();
		containerEl.empty();

		// Connection
		new Setting(containerEl).setName('Connection').setHeading();
		new Setting(containerEl).setName('Status').setDesc(this.host.connectionStatus || 'Not checked yet.').addButton((b) =>
			b.setButtonText('Test connection').onClick(async () => {
				b.setDisabled(true).setButtonText('Testing…');
				const r = await probeAuth(s, this.host.apiKey(), this.host.vaultBasePath());
				this.host.setConnectionStatus(r.ok ? `Connected: ${r.billing}${r.account ? ` (${r.account})` : ''}` : `Not connected: ${r.error}`);
				this.display();
			}),
		);
		const pathSetting = new Setting(containerEl)
			.setName('Claude Code path')
			.setDesc('The Claude Code program LLM Sessions starts.')
			.addText((t) =>
				t.setValue(s.claudePath).onChange((v) => {
					s.claudePath = v.trim();
					save();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Detect').onClick(async () => {
					const found = await locateClaude();
					if (found) {
						s.claudePath = found;
						save();
					}
					const check = await checkClaude(s.claudePath);
					pathSetting.setDesc(check.message);
					this.display();
				}),
			);
		new Setting(containerEl)
			.setName('Billing')
			.setDesc('Your Claude Code sign-in uses your Claude plan. An API key is billed per use.')
			.addDropdown((d) =>
				d
					.addOption('subscription', 'Use my Claude Code sign-in')
					.addOption('api-key', 'Anthropic API key')
					.setValue(s.billing)
					.onChange((v) => {
						s.billing = v as LlmSessionsSettings['billing'];
						save();
						this.display();
					}),
			);
		if (s.billing === 'api-key') {
			new Setting(containerEl)
				.setName('API key')
				.setDesc('Kept in Obsidian\'s secret storage.')
				.addComponent((c) =>
					new SecretComponent(this.app, c).setValue(s.apiKeySecretId).onChange((id) => {
						s.apiKeySecretId = id;
						save();
					}),
				);
		}
		new Setting(containerEl).setName('Setup').setDesc('Walk through the first-run setup again.').addButton((b) => b.setButtonText('Run setup again').onClick(() => this.host.runOnboarding()));

		// Model
		new Setting(containerEl).setName('Model').setHeading();
		this.modelSetting(containerEl, 'Default chat model', 'Used by chats without their own model. "Latest" follows new releases.', s.defaultModel, (v) => {
			s.defaultModel = v;
			save();
		});
		new Setting(containerEl)
			.setName('Default effort')
			.setDesc('Medium suits most chats; low is cheaper for quick questions.')
			.addDropdown((d) => {
				for (const e of EFFORT_CHOICES) d.addOption(e, e);
				d.setValue(s.defaultEffort).onChange((v) => {
					s.defaultEffort = v as Effort;
					save();
				});
			});
		this.modelSetting(containerEl, 'Summary model', 'Writes callout titles and summaries. The cheapest model is usually enough.', s.summaryModel, (v) => {
			s.summaryModel = v;
			save();
		});
		new Setting(containerEl)
			.setName('Custom instructions')
			.setDesc('Added to every new chat\'s instructions.')
			.addTextArea((t) =>
				t.setValue(s.customInstructions).onChange((v) => {
					s.customInstructions = v;
					save();
				}),
			);

		// Agent
		new Setting(containerEl).setName('Agent').setHeading();
		new Setting(containerEl)
			.setName('Load vault\'s Claude Code project settings')
			.setDesc('Off keeps your coding hooks, MCP servers and CLAUDE.md files out of note chats.')
			.addToggle((t) =>
				t.setValue(s.loadProjectSettings).onChange((v) => {
					s.loadProjectSettings = v;
					save();
				}),
			);
		new Setting(containerEl)
			.setName('Max tool turns per message')
			.setDesc('Stops runaway tool loops.')
			.addSlider((sl) =>
				sl
					.setLimits(1, 40, 1)
					.setValue(s.maxTurns)
					.setDynamicTooltip()
					.onChange((v) => {
						s.maxTurns = v;
						save();
					}),
			);
		if (s.billing === 'api-key') {
			new Setting(containerEl)
				.setName('Spending cap per chat session (USD)')
				.setDesc('Claude stops when a session\'s estimated cost passes this amount. Set it to 0 to turn the cap off.')
				.addText((t) =>
					t.setValue(String(s.maxBudgetUsd)).onChange((v) => {
						const n = Number(v);
						if (Number.isFinite(n) && n >= 0) {
							s.maxBudgetUsd = n;
							save();
						}
					}),
				);
		}

		// Context
		new Setting(containerEl).setName('Context').setHeading();
		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Claude never reads notes in these folders. One per line.')
			.addTextArea((t) =>
				t.setValue(s.excludedFolders.join('\n')).onChange((v) => {
					s.excludedFolders = lines(v);
					save();
				}),
			);
		new Setting(containerEl)
			.setName('Excluded tags')
			.setDesc('Claude never reads notes with these tags. One per line, for example #private.')
			.addTextArea((t) =>
				t.setValue(s.excludedTags.join('\n')).onChange((v) => {
					s.excludedTags = lines(v);
					save();
				}),
			);
		new Setting(containerEl)
			.setName('Per-note opt-out property')
			.setDesc('A note with this property set to false is never sent, for example "llm-context: false".')
			.addText((t) =>
				t.setValue(s.optOutKey).onChange((v) => {
					s.optOutKey = v.trim();
					save();
				}),
			);

		// Chats
		new Setting(containerEl).setName('Chats').setHeading();
		new Setting(containerEl)
			.setName('Chat folder name')
			.setDesc('Created next to each note that has chats. Obsidian Sync skips hidden folders; choose the visible one if you use it. Changing this does not move existing chats.')
			.addDropdown((d) =>
				d
					.addOption('.chat-data', '.chat-data (hidden)')
					.addOption('chat-data', 'chat-data (visible)')
					.setValue(s.chatFolderName)
					.onChange((v) => {
						s.chatFolderName = v;
						save();
					}),
			);
		new Setting(containerEl)
			.setName('Mirror session files into vault')
			.setDesc('Keeps a copy of each Claude Code session next to the chat, so chats survive Claude Code\'s 30-day cleanup and open on your other computers.')
			.addToggle((t) =>
				t.setValue(s.mirrorSessions).onChange((v) => {
					s.mirrorSessions = v;
					save();
				}),
			);
		new Setting(containerEl)
			.setName('Summary delay (minutes)')
			.setDesc('Summaries update this long after the last reply, or when the chat panel closes.')
			.addSlider((sl) =>
				sl
					.setLimits(1, 15, 1)
					.setValue(s.summaryIdleMinutes)
					.setDynamicTooltip()
					.onChange((v) => {
						s.summaryIdleMinutes = v;
						save();
					}),
			);

		// Embeds
		new Setting(containerEl).setName('Embeds').setHeading();
		new Setting(containerEl).setName('Collapsed by default').addToggle((t) =>
			t.setValue(s.embedsCollapsed).onChange((v) => {
				s.embedsCollapsed = v;
				save();
			}),
		);
	}

	private modelSetting(el: HTMLElement, name: string, desc: string, value: string, onChange: (v: string) => void): void {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addDropdown((d) => {
				for (const m of MODEL_CHOICES) d.addOption(m.value, m.label);
				if (!MODEL_CHOICES.some((m) => m.value === value)) d.addOption(value, value);
				d.setValue(value).onChange(onChange);
			})
			.addText((t) =>
				t.setPlaceholder('Custom model ID').onChange((v) => {
					if (v.trim()) onChange(v.trim());
				}),
			);
	}
}

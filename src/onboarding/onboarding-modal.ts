import { Modal, SecretComponent, Setting, type App } from 'obsidian';
import { openTerminal } from '../handoff/terminal-launcher';
import { MODEL_CHOICES, type LlmSessionsSettings } from '../settings/settings';
import { probeAuth, type ProbeResult } from './auth-probe';
import { checkClaude, locateClaude, type ClaudeCheck } from './claude-code-locator';

type Step = 'welcome' | 'locate' | 'billing' | 'defaults' | 'test';
const STEPS: Step[] = ['welcome', 'locate', 'billing', 'defaults', 'test'];

export interface OnboardingHost {
	app: App;
	settings: LlmSessionsSettings;
	vaultBasePath: () => string;
	saveSettings: () => Promise<void>;
	setConnectionStatus: (status: string) => void;
}

/**
 * First-run setup (docs/ARCHITECTURE.md §4). Nothing is sent to Anthropic before the user
 * accepts the disclosure; the plugin never asks for or sees Claude.ai credentials.
 */
export class OnboardingModal extends Modal {
	private step: Step = 'welcome';
	private draft: LlmSessionsSettings;
	private accepted = false;
	private check: ClaudeCheck | null = null;
	private probe: ProbeResult | null = null;
	private probing = false;
	private testReply: ProbeResult | null = null;
	private obsidianSync = false;
	private debugCalls = { render: 0, runCheck: 0 };

	constructor(private host: OnboardingHost) {
		super(host.app);
		this.draft = { ...host.settings };
		this.obsidianSync = this.draft.chatFolderName === 'chat-data';
	}

	onOpen(): void {
		this.modalEl.addClass('llm-onboarding');
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const index = STEPS.indexOf(this.step);
		this.setTitle(`Set up LLM Sessions (${index + 1} of ${STEPS.length})`);
		switch (this.step) {
			case 'welcome':
				this.renderWelcome(el);
				break;
			case 'locate':
				this.renderLocate(el);
				break;
			case 'billing':
				this.renderBilling(el);
				break;
			case 'defaults':
				this.renderDefaults(el);
				break;
			case 'test':
				this.renderTest(el);
				break;
		}
	}

	private nav(el: HTMLElement, canContinue: boolean, label = 'Continue', onNext?: () => void): void {
		const s = new Setting(el).setClass('llm-onboarding-nav');
		const index = STEPS.indexOf(this.step);
		if (index > 0) {
			s.addButton((b) =>
				b.setButtonText('Back').onClick(() => {
					this.step = STEPS[index - 1]!;
					this.render();
				}),
			);
		}
		s.addButton((b) =>
			b
				.setButtonText(label)
				.setCta()
				.setDisabled(!canContinue)
				.onClick(() => {
					if (onNext) return onNext();
					this.step = STEPS[index + 1]!;
					this.render();
				}),
		);
	}

	private renderWelcome(el: HTMLElement): void {
		el.createEl('p', { text: 'LLM Sessions lets you chat with Claude from your notes. Before you start:' });
		const ul = el.createEl('ul', { cls: 'llm-disclosure' });
		for (const line of [
			'It runs Claude Code, which must be installed on this computer.',
			'The note a chat lives in, plus any notes Claude chooses to read, are sent to Anthropic.',
			'Chats count against your Claude subscription limits, or are billed to your API key.',
			'Conversations are stored by Claude Code in your home folder (~/.claude) and copied into hidden chat folders next to your notes. Hidden folders still sync with OneDrive, iCloud, Dropbox or git.',
			'LLM Sessions never asks for, sees or stores your Claude.ai login. You sign in to Claude Code itself.',
		]) {
			ul.createEl('li', { text: line });
		}
		new Setting(el).setName('I understand and want to continue').addToggle((t) =>
			t.setValue(this.accepted).onChange((v) => {
				this.accepted = v;
				this.render();
			}),
		);
		this.nav(el, this.accepted);
	}

	private renderLocate(el: HTMLElement): void {
		el.createEl('p', { text: 'LLM Sessions uses your own installed Claude Code (version 2.1.223 or later).' });
		const status = el.createDiv({ cls: 'llm-status' });
		const showStatus = () => {
			status.empty();
			if (!this.check) status.setText('Looking for Claude Code…');
			else status.createSpan({ cls: this.check.ok ? 'llm-ok' : 'llm-bad', text: this.check.ok ? `Found ${this.check.message} at ${this.check.path}` : this.check.message });
		};
		showStatus();
		new Setting(el)
			.setName('Claude Code path')
			.setDesc('Detected automatically when possible. Paste the full path if it is not found.')
			.addText((t) =>
				t
					.setValue(this.draft.claudePath)
					.setPlaceholder(process.platform === 'win32' ? 'C:\\Users\\you\\.local\\bin\\claude.exe' : '/usr/local/bin/claude')
					.onChange((v) => (this.draft.claudePath = v.trim())),
			)
			.addButton((b) => b.setButtonText('Check').onClick(() => void this.runCheck(false)))
			.addButton((b) => b.setButtonText('Detect').onClick(() => void this.runCheck(true)));
		const help = el.createEl('p', { cls: 'setting-item-description' });
		help.appendText('Not installed? Follow the ');
		help.createEl('a', { text: 'Claude Code setup guide', href: 'https://code.claude.com/docs/en/setup' });
		help.appendText(', then select Detect.');
		this.nav(el, this.check?.ok === true);
		if (!this.check) void this.runCheck(!this.draft.claudePath);
	}

	private async runCheck(detect: boolean): Promise<void> {
		this.check = null;
		if (detect) this.draft.claudePath = (await locateClaude()) ?? this.draft.claudePath;
		this.check = this.draft.claudePath
			? await checkClaude(this.draft.claudePath)
			: { path: '', version: null, ok: false, message: 'Claude Code was not found. Install it, or paste its path.' };
		this.render();
	}

	private renderBilling(el: HTMLElement): void {
		new Setting(el)
			.setName('How should chats be billed?')
			.setDesc('Your Claude Code sign-in is recommended for personal use.')
			.addDropdown((d) =>
				d
					.addOption('subscription', 'Use my Claude Code sign-in (Pro or Max)')
					.addOption('api-key', 'Anthropic API key')
					.setValue(this.draft.billing)
					.onChange((v) => {
						this.draft.billing = v as LlmSessionsSettings['billing'];
						this.probe = null;
						this.render();
					}),
			);
		if (this.draft.billing === 'api-key') {
			new Setting(el)
				.setName('API key')
				.setDesc('Stored in Obsidian\'s secret storage, not in the plugin\'s settings file.')
				.addComponent((c) => new SecretComponent(this.app, c).setValue(this.draft.apiKeySecretId).onChange((id) => (this.draft.apiKeySecretId = id)));
		} else {
			el.createEl('p', {
				cls: 'setting-item-description',
				text: 'LLM Sessions starts Claude Code, which uses the sign-in stored on this computer. API key environment variables are ignored in this mode so they cannot take over.',
			});
		}
		const status = el.createDiv({ cls: 'llm-status' });
		if (this.probing) status.setText('Checking…');
		else if (this.probe?.ok) status.createSpan({ cls: 'llm-ok', text: `Connected: ${this.probe.billing}${this.probe.account ? ` (${this.probe.account})` : ''}` });
		else if (this.probe) status.createSpan({ cls: 'llm-bad', text: this.probe.error });

		const actions = new Setting(el).addButton((b) => b.setButtonText(this.probe ? 'Check again' : 'Check connection').onClick(() => void this.runProbe()));
		if (this.draft.billing === 'subscription' && this.probe && !this.probe.ok) {
			actions.addButton((b) =>
				b.setButtonText('Sign in with Claude Code').onClick(async () => {
					const ok = await openTerminal(this.draft.claudePath, this.host.vaultBasePath());
					status.setText(ok ? 'A terminal opened with Claude Code. Type /login there, finish signing in, then select Check again.' : 'Could not open a terminal. Open one yourself, run "claude", type /login, then select Check again.');
				}),
			);
		}
		this.nav(el, this.probe?.ok === true);
	}

	private apiKey(): string | null {
		return this.draft.billing === 'api-key' && this.draft.apiKeySecretId ? this.app.secretStorage.getSecret(this.draft.apiKeySecretId) : null;
	}

	private async runProbe(): Promise<void> {
		this.probing = true;
		this.probe = null;
		this.render();
		this.probe = await probeAuth(this.draft, this.apiKey(), this.host.vaultBasePath());
		this.probing = false;
		this.render();
	}

	private renderDefaults(el: HTMLElement): void {
		new Setting(el)
			.setName('Default chat model')
			.setDesc('Models marked "latest" follow new releases automatically. You can change the model for each chat.')
			.addDropdown((d) => {
				for (const m of MODEL_CHOICES) d.addOption(m.value, m.label);
				d.setValue(this.draft.defaultModel).onChange((v) => (this.draft.defaultModel = v));
			});
		new Setting(el)
			.setName('Do you sync this vault with Obsidian Sync?')
			.setDesc('Obsidian Sync skips hidden folders, so chats are then kept in a visible "chat-data" folder instead of ".chat-data".')
			.addToggle((t) =>
				t.setValue(this.obsidianSync).onChange((v) => {
					this.obsidianSync = v;
					this.draft.chatFolderName = v ? 'chat-data' : '.chat-data';
				}),
			);
		new Setting(el)
			.setName('Excluded folders')
			.setDesc('Claude never reads notes in these folders. One per line.')
			.addTextArea((t) =>
				t.setValue(this.draft.excludedFolders.join('\n')).onChange((v) => {
					this.draft.excludedFolders = v.split('\n').map((s) => s.trim()).filter(Boolean);
				}),
			);
		this.nav(el, true);
	}

	private renderTest(el: HTMLElement): void {
		el.createEl('p', { text: 'Send one short test message to make sure everything works. It is not saved.' });
		const status = el.createDiv({ cls: 'llm-status' });
		if (this.probing) status.setText('Waiting for Claude…');
		else if (this.testReply?.ok) status.createSpan({ cls: 'llm-ok', text: `Claude replied: ${this.testReply.reply}` });
		else if (this.testReply) status.createSpan({ cls: 'llm-bad', text: this.testReply.error });
		new Setting(el).addButton((b) =>
			b
				.setButtonText('Send test message')
				.setDisabled(this.probing)
				.onClick(async () => {
					this.probing = true;
					this.render();
					this.testReply = await probeAuth(this.draft, this.apiKey(), this.host.vaultBasePath(), 'In one short sentence, say hello and confirm you can chat from Obsidian.');
					this.probing = false;
					this.render();
				}),
		);
		this.nav(el, this.testReply?.ok === true, 'Finish', () => void this.finish());
	}

	private async finish(): Promise<void> {
		Object.assign(this.host.settings, this.draft, { onboardingComplete: true });
		await this.host.saveSettings();
		if (this.probe?.ok) this.host.setConnectionStatus(`Connected: ${this.probe.billing}`);
		this.close();
	}
}

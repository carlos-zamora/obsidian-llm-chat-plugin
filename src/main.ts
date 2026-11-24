import { Notice, Plugin } from 'obsidian';
import { registerCommands, startChatFromActiveNote, type CommandHost } from './commands';
import { ChatFolders } from './core/chat-folders';
import { ChatIndex } from './core/chat-index';
import { ChatService } from './core/chat-service';
import { ChatStore } from './core/chat-store';
import { NoteLifecycle } from './core/note-lifecycle';
import { registerProtocolHandler } from './core/protocol-handler';
import { TranscriptWriter } from './core/transcript-writer';
import { registerEmbedPostProcessor } from './embed/embed-postprocessor';
import { OnboardingModal } from './onboarding/onboarding-modal';
import { ClaudeRuntime } from './runtime/claude/claude-runtime';
import { SessionMirror } from './runtime/claude/session-mirror';
import { migrateData, type LlmSessionsSettings, type PluginData } from './settings/settings';
import { LlmSessionsSettingTab } from './settings/settings-tab';
import { createVaultServer } from './tools/vault-mcp-server';
import { VaultAccess } from './tools/vault-access';
import type { ChatRecord } from './types';
import { ChatView, VIEW_TYPE_CHAT } from './ui/chat-view';
import { choose } from './ui/modals';
import { openChatPanel } from './ui/panel';

export default class LlmSessionsPlugin extends Plugin {
	data!: PluginData;
	service!: ChatService;
	index!: ChatIndex;
	connectionStatus = '';
	/** Until the index is built, an unknown chat ID may just not be loaded yet, so callouts don't say "Chat missing". */
	private indexBuilt = false;

	get settings(): LlmSessionsSettings {
		return this.data.settings;
	}

	async onload(): Promise<void> {
		this.data = migrateData(await this.loadData());
		const settings = () => this.data.settings;

		// Wiring only; every feature lives in its own module.
		const store = new ChatStore(this.app, new ChatFolders(this.app, () => settings().chatFolderName));
		this.index = new ChatIndex(this.app, store, () => settings().chatFolderName, this.data.index, async (cache) => {
			this.data.index = cache;
			await this.saveData(this.data);
		});
		const vault = new VaultAccess(this.app, settings);
		const runtime = new ClaudeRuntime({
			settings,
			apiKey: () => this.apiKey(),
			cwdFor: (chat) => this.service.cwdFor(chat),
			vaultServer: (chat) => createVaultServer(vault, () => chat.homeNote),
		});
		this.service = new ChatService({
			app: this.app,
			settings,
			apiKey: () => this.apiKey(),
			store,
			runtime,
			transcripts: new TranscriptWriter(store),
			mirror: new SessionMirror(this.app, store),
			vault,
			onTranscriptDiverged: (record) => void this.askAboutTranscript(record),
		});
		const lifecycle = new NoteLifecycle(this.app, store);
		const commandHost: CommandHost = { app: this.app, service: this.service, index: this.index, ensureOnboarded: () => this.ensureOnboarded() };

		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) =>
				new ChatView(leaf, {
					service: this.service,
					settings,
					startChatFromActiveNote: () => startChatFromActiveNote(commandHost),
					whenIndexReady: () => this.index.whenReady(),
				}),
		);
		registerCommands(this, commandHost);
		registerEmbedPostProcessor(this, { service: this.service, openChat: (id) => void this.openChat(id), indexReady: () => this.indexBuilt });
		registerProtocolHandler(this, (id, message) => void this.openChat(id, message));
		this.addRibbonIcon('messages-square', 'Open chat panel', () => void openChatPanel(this.app, this.data.lastChatId));
		this.addSettingTab(new LlmSessionsSettingTab(this.app, this, this));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => lifecycle.onRename(file, oldPath)));
		this.registerEvent(this.app.vault.on('delete', (file) => lifecycle.onDelete(file)));
		this.registerInterval(window.setInterval(() => runtime.sweep(), 60 * 1000));
		this.register(store.onChange((record) => this.rememberLastChat(record)));

		// Heavy work waits for the layout, so it doesn't slow Obsidian's startup.
		this.app.workspace.onLayoutReady(() => {
			void this.index.whenReady().then(() => (this.indexBuilt = true));
			if (!this.settings.onboardingComplete) this.runOnboarding();
		});
	}

	onunload(): void {
		this.service?.dispose();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.data);
	}

	apiKey(): string | null {
		const s = this.settings;
		return s.billing === 'api-key' && s.apiKeySecretId ? this.app.secretStorage.getSecret(s.apiKeySecretId) : null;
	}

	vaultBasePath(): string {
		return this.service.vaultBasePath();
	}

	setConnectionStatus(status: string): void {
		this.connectionStatus = status;
	}

	runOnboarding(): void {
		new OnboardingModal(this).open();
	}

	ensureOnboarded(): boolean {
		if (this.settings.onboardingComplete) return true;
		new Notice('Finish setting up LLM Sessions first.');
		this.runOnboarding();
		return false;
	}

	async openChat(chatId: string, message: string | null = null): Promise<void> {
		if (!this.ensureOnboarded()) return;
		await this.index.whenReady();
		if (!this.service.store.get(chatId)) {
			new Notice('This chat could not be found in the vault.');
			return;
		}
		await openChatPanel(this.app, chatId, message);
	}

	private rememberLastChat(record: ChatRecord): void {
		if (this.data.lastChatId === record.id) return;
		this.data.lastChatId = record.id;
		void this.saveData(this.data);
	}

	private async askAboutTranscript(record: ChatRecord): Promise<void> {
		const answer = await choose(
			this.app,
			'Transcript was edited',
			`The transcript file for "${record.title ?? 'this chat'}" changed since LLM Sessions last wrote it. Regenerate it from the conversation, or keep your edits and stop updating it?`,
			[
				{ value: 'keep', label: 'Keep my edits' },
				{ value: 'regenerate', label: 'Regenerate', cta: true },
			],
		);
		if (answer) await this.service.regenerateTranscript(record, answer === 'keep');
	}
}

import { debounce, ItemView, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { ChatService } from '../core/chat-service';
import { DEFAULT_TITLE } from '../embed/callout-format';
import { EFFORT_CHOICES, MODEL_CHOICES, modelLabel, type LlmSessionsSettings } from '../settings/settings';
import type { ChatRecord, Effort } from '../types';
import { noteDisplayName } from '../utils/paths';
import { handleDrop, isFileDrag, renderContextBar, type ContextBarHost } from './context-bar';
import { MessageRenderer, type StreamingReply } from './message-renderer';
import { promptText } from './modals';

export const VIEW_TYPE_CHAT = 'llm-sessions-chat';

let selectIds = 0;

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export const AI_DISCLAIMER = 'Claude is AI and can make mistakes. Check important information.';

export interface ChatViewHost {
	service: ChatService;
	settings: () => LlmSessionsSettings;
	startChatFromActiveNote: () => void;
	/** Resolves once chat records are loaded (a restored panel opens before that). */
	whenIndexReady: () => Promise<void>;
}

interface ChatViewState extends Record<string, unknown> {
	chatId?: string | null;
	message?: string | null;
}

/** Right-sidebar panel bound to one chat (docs/ARCHITECTURE.md §5.2). */
export class ChatView extends ItemView {
	private chatId: string | null = null;
	/** Chat currently drawn in the panel; differs from chatId until the view is open and loaded. */
	private shownChatId: string | null = null;
	private renderer: MessageRenderer;
	private headerEl!: HTMLElement;
	private bannerEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private composerEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private streaming = false;
	private notices: Map<string, string> = new Map();
	private refreshPending = debounce(() => void this.updatePendingHint(), 800, true);

	constructor(
		leaf: WorkspaceLeaf,
		private host: ChatViewHost,
	) {
		super(leaf);
		this.renderer = new MessageRenderer(this.app, this, () => this.record?.homeNote ?? '');
	}

	private get record(): ChatRecord | undefined {
		return this.chatId ? this.host.service.store.get(this.chatId) : undefined;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return this.record?.title ?? 'LLM chat';
	}

	getIcon(): string {
		return 'messages-square';
	}

	getState(): Record<string, unknown> {
		return { chatId: this.chatId };
	}

	async setState(state: ChatViewState, result: ViewStateResult): Promise<void> {
		await this.showChat(state.chatId ?? null, state.message ?? null);
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('llm-chat-view');
		this.headerEl = this.contentEl.createDiv({ cls: 'llm-chat-header' });
		this.bannerEl = this.contentEl.createDiv({ cls: 'llm-chat-banner' });
		this.messagesEl = this.contentEl.createDiv({ cls: 'llm-chat-messages' });
		this.composerEl = this.contentEl.createDiv({ cls: 'llm-chat-composer' });
		this.buildComposer();
		this.contentEl.createDiv({ cls: 'llm-ai-disclaimer', text: AI_DISCLAIMER });
		this.contentEl.createDiv({ cls: 'llm-drop-hint', text: 'Drop to add to the context', attr: { 'aria-hidden': 'true' } });
		this.registerDropTarget();

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				const record = this.record;
				if (record && file instanceof TFile && this.host.service.contextNotePaths(record).includes(file.path)) this.refreshPending();
			}),
		);
		this.register(
			this.host.service.store.onChange((record) => {
				if (record.id === this.chatId && !this.streaming) this.renderHeader();
			}),
		);
		// setState may have arrived before the view was open.
		if (this.chatId) await this.showChat(this.chatId);
		else this.renderEmpty();
	}

	async onClose(): Promise<void> {
		if (this.shownChatId) this.host.service.onPanelClosed(this.shownChatId);
	}

	/**
	 * Shows a chat, optionally scrolled to a message alias (`m7`). Called from setState (Obsidian
	 * restoring or opening the panel) and from openChatPanel; setState can arrive before onOpen,
	 * in which case only chatId is stored and onOpen draws it.
	 */
	async showChat(chatId: string | null, messageAlias: string | null = null): Promise<void> {
		if (chatId !== null && chatId === this.shownChatId) {
			if (messageAlias) this.scrollTo(messageAlias);
			return;
		}
		if (this.shownChatId && this.shownChatId !== chatId) this.host.service.onPanelClosed(this.shownChatId);
		this.chatId = chatId;
		if (!this.messagesEl) return;
		this.shownChatId = chatId;
		this.notices.clear();
		this.bannerEl.empty();
		await this.host.whenIndexReady();
		// After every await: the user may have switched to another chat meanwhile; if so, stop drawing this one.
		if (this.chatId !== chatId) return;
		const record = this.record;
		if (!record) {
			this.renderEmpty(chatId ? 'This chat could not be found.' : undefined);
			return;
		}
		this.renderHeader();
		this.messagesEl.empty();
		this.setComposerEnabled(true);
		try {
			const turns = await this.host.service.loadTurns(record);
			if (this.chatId !== record.id) return;
			if (turns.length === 0) {
				this.messagesEl.createDiv({ cls: 'llm-chat-hint', text: `Ask anything. Claude can see ${noteDisplayName(record.homeNote)} and can read other notes when it needs to.` });
			}
			for (const turn of turns) await this.renderer.renderTurn(this.messagesEl, turn);
			if (messageAlias) this.scrollTo(messageAlias);
			else this.scrollToBottom();
			void this.host.service.warm(record);
			this.host.service.refreshIfOutdated(record.id);
			void this.updatePendingHint();
		} catch (e) {
			this.messagesEl.createDiv({ cls: 'llm-error', text: e instanceof Error ? e.message : String(e) });
		}
	}

	// ── Header ────────────────────────────────────────────────────────────

	private renderHeader(): void {
		const record = this.record;
		const el = this.headerEl;
		el.empty();
		if (!record) return;
		const settings = this.host.settings();

		const titleRow = el.createDiv({ cls: 'llm-chat-title-row' });
		const title = titleRow.createDiv({ cls: 'llm-chat-title', text: record.title ?? DEFAULT_TITLE, attr: { 'aria-label': 'Rename chat' } });
		title.addEventListener('click', () => void this.rename(record));

		const meta = el.createDiv({ cls: 'llm-chat-meta' });
		const modelSelect = this.labeledSelect(meta, 'Model', 'llm-model-select');
		modelSelect.createEl('option', { value: '', text: `${modelLabel(settings.defaultModel)} (default)` });
		const choices = [...MODEL_CHOICES];
		if (record.model && !choices.some((c) => c.value === record.model)) choices.push({ value: record.model, label: record.model });
		for (const c of choices) modelSelect.createEl('option', { value: c.value, text: c.label });
		modelSelect.createEl('option', { value: '__custom', text: 'Custom…' });
		modelSelect.value = record.model ?? '';
		modelSelect.addEventListener('change', () => void this.changeModel(record, modelSelect.value));

		const effortSelect = this.labeledSelect(meta, 'Effort', 'llm-effort-select');
		effortSelect.createEl('option', { value: '', text: `${capitalize(settings.defaultEffort)} (default)` });
		for (const e of EFFORT_CHOICES) effortSelect.createEl('option', { value: e, text: capitalize(e) });
		effortSelect.value = record.effort ?? '';
		effortSelect.addEventListener('change', () => void this.changeEffort(record, (effortSelect.value || undefined) as Effort | undefined));

		meta.createDiv({
			cls: 'llm-chat-billing',
			text: settings.billing === 'api-key' ? 'Billed to your API key' : 'Uses your Claude subscription',
		});

		renderContextBar(el, record, this.contextHost());
	}

	/** A select with a visible label tied to it, so screen readers announce what it sets. */
	private labeledSelect(parent: HTMLElement, label: string, cls: string): HTMLSelectElement {
		const id = `${cls}-${++selectIds}`;
		const field = parent.createDiv({ cls: 'llm-field' });
		field.createEl('label', { cls: 'llm-field-label', text: label, attr: { for: id } });
		return field.createEl('select', { cls: `dropdown ${cls}`, attr: { id } });
	}

	private contextHost(): ContextBarHost {
		return { app: this.app, service: this.host.service, onChanged: () => void this.updatePendingHint() };
	}

	private async rename(record: ChatRecord): Promise<void> {
		const title = await promptText(this.app, 'Rename chat', record.title ?? '', DEFAULT_TITLE);
		if (title === null) return;
		await this.host.service.setTitle(record, title);
	}

	private async changeModel(record: ChatRecord, value: string): Promise<void> {
		let model: string | undefined = value || undefined;
		if (value === '__custom') {
			const custom = await promptText(this.app, 'Custom model ID', record.model ?? '', 'claude-sonnet-5-5');
			if (!custom?.trim()) {
				this.renderHeader();
				return;
			}
			model = custom.trim();
		}
		await this.host.service.setModel(record, model, record.effort);
		if (record.sessionId) {
			this.setNotice('model', 'The first reply after a model change is slower and uses more of your plan\'s limits, because the conversation cache is rebuilt for the new model.');
		}
		this.renderHeader();
	}

	private async changeEffort(record: ChatRecord, effort: Effort | undefined): Promise<void> {
		await this.host.service.setModel(record, record.model, effort);
		this.renderHeader();
	}

	/** Dropping notes or files anywhere on the panel adds them to the context. */
	private registerDropTarget(): void {
		const el = this.contentEl;
		const accepts = (evt: DragEvent) => Boolean(this.record) && isFileDrag(this.app, evt);
		this.registerDomEvent(el, 'dragover', (evt) => {
			if (!accepts(evt)) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
			el.addClass('is-drop-target');
		});
		this.registerDomEvent(el, 'dragleave', (evt) => {
			if (!(evt.relatedTarget instanceof Node) || !el.contains(evt.relatedTarget)) el.removeClass('is-drop-target');
		});
		this.registerDomEvent(el, 'drop', (evt) => {
			el.removeClass('is-drop-target');
			const record = this.record;
			if (!record || !accepts(evt)) return;
			evt.preventDefault();
			void handleDrop(this.contextHost(), record, evt);
		});
	}

	// ── Banner ────────────────────────────────────────────────────────────

	private setNotice(key: string, text: string | null): void {
		if (text) this.notices.set(key, text);
		else this.notices.delete(key);
		this.bannerEl.empty();
		for (const [k, t] of this.notices) {
			const row = this.bannerEl.createDiv({ cls: 'llm-banner-row' });
			row.createSpan({ text: t });
			const x = row.createSpan({ cls: 'llm-banner-close clickable-icon', attr: { 'aria-label': 'Dismiss' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.setNotice(k, null));
		}
	}

	private async updatePendingHint(): Promise<void> {
		const record = this.record;
		if (!record) return;
		const changed = await this.host.service.pendingNoteUpdates(record);
		this.setNotice(
			'pending',
			changed.length ? `${changed.map(noteDisplayName).join(', ')} updated. The new version will be sent with your next message.` : null,
		);
	}

	// ── Composer ──────────────────────────────────────────────────────────

	private buildComposer(): void {
		this.inputEl = this.composerEl.createEl('textarea', {
			cls: 'llm-chat-input',
			attr: { placeholder: 'Message Claude… (Enter to send, Shift+Enter for a new line)', rows: '3' },
		});
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.submit();
			}
		});
		this.sendBtn = this.composerEl.createEl('button', { cls: 'mod-cta llm-chat-send', text: 'Send' });
		this.sendBtn.addEventListener('click', () => {
			if (this.streaming && this.chatId) void this.host.service.interrupt(this.chatId);
			else void this.submit();
		});
	}

	/** Puts the cursor in the message box, if it can take input. */
	focusInput(): void {
		if (this.inputEl && !this.inputEl.disabled) this.inputEl.focus();
	}

	private setComposerEnabled(enabled: boolean): void {
		this.inputEl.disabled = !enabled;
		this.sendBtn.disabled = !enabled;
	}

	/**
	 * Sends the composer text. The user's message and an empty reply are drawn right away;
	 * the reply fills in as events stream from chat-service.
	 */
	private async submit(): Promise<void> {
		const record = this.record;
		const text = this.inputEl.value.trim();
		if (!record || !text || this.streaming) return;
		this.inputEl.value = '';
		this.messagesEl.querySelector('.llm-chat-hint')?.remove();
		this.setNotice('pending', null);
		this.setNotice('model', null);
		this.renderer.renderUserDraft(this.messagesEl, text);
		const reply: StreamingReply = this.renderer.startReply(this.messagesEl);
		this.scrollToBottom();
		this.setStreaming(true);
		let error: string | undefined;
		try {
			await this.host.service.send(record.id, text, (e) => {
				if (e.type === 'text-delta') reply.delta(e.text);
				else if (e.type === 'assistant-text') reply.block(e.text);
				else if (e.type === 'tool-use') reply.tool(e.tool);
				else if (e.type === 'result' && !e.ok) error = e.error ?? 'Something went wrong.';
				this.scrollToBottomIfNear();
			});
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		reply.finish(error);
		this.setStreaming(false);
		this.scrollToBottomIfNear();
	}

	private setStreaming(on: boolean): void {
		this.streaming = on;
		this.inputEl.disabled = on;
		this.sendBtn.setText(on ? 'Stop' : 'Send');
		this.sendBtn.toggleClass('mod-warning', on);
		this.sendBtn.toggleClass('mod-cta', !on);
		if (!on) this.inputEl.focus();
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	private renderEmpty(message?: string): void {
		this.headerEl?.empty();
		this.bannerEl?.empty();
		if (!this.messagesEl) return;
		this.messagesEl.empty();
		const empty = this.messagesEl.createDiv({ cls: 'llm-chat-empty' });
		empty.createEl('p', { text: message ?? 'No chat is open.' });
		const btn = empty.createEl('button', { cls: 'mod-cta', text: 'Start chat from this note' });
		btn.addEventListener('click', () => this.host.startChatFromActiveNote());
		this.setComposerEnabled(false);
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private scrollToBottomIfNear(): void {
		const el = this.messagesEl;
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) this.scrollToBottom();
	}

	private scrollTo(alias: string): void {
		const target = this.messagesEl.querySelector<HTMLElement>(`[data-alias="${alias}"]`);
		if (!target) return;
		target.scrollIntoView({ block: 'start' });
		target.addClass('is-highlighted');
		window.setTimeout(() => target.removeClass('is-highlighted'), 2000);
	}
}

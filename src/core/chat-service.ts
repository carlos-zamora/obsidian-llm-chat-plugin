import { arrayBufferToBase64, FileSystemAdapter, TFile, type App, type Editor } from 'obsidian';
import { join } from 'path';
import type { LlmSessionsSettings } from '../settings/settings';
import type { AgentRuntime } from '../runtime/runtime';
import type { SessionMirror } from '../runtime/claude/session-mirror';
import { summarizeConversation } from '../runtime/claude/summarizer';
import type { VaultAccess } from '../tools/vault-access';
import type { Attachment, ChatRecord, Effort, RuntimeEvent, Turn } from '../types';
import { contextFileProblem, contextKind, mediaType } from '../utils/file-kinds';
import { serializeChatCallout } from '../embed/callout-format';
import { planCalloutInsert } from '../embed/callout-insert';
import { updateEmbeds } from '../embed/embed-updater';
import { hashText } from '../utils/hash';
import { parentFolder } from '../utils/paths';
import type { ChatStore } from './chat-store';
import { changedNotes, prepareTurn, type ContextNote, type PreparedTurn } from './context-builder';
import { conversationForSummary, shortChatSummary } from './summary-input';
import type { TranscriptWriter } from './transcript-writer';

/** Version of the summary rules. Bump it to rewrite existing summaries the next time their callout is shown. */
const SUMMARY_VERSION = 2;

export interface ChatServiceDeps {
	app: App;
	settings: () => LlmSessionsSettings;
	apiKey: () => string | null;
	store: ChatStore;
	runtime: AgentRuntime;
	transcripts: TranscriptWriter;
	mirror: SessionMirror;
	vault: VaultAccess;
	/** Asks the user what to do with a transcript they edited by hand. */
	onTranscriptDiverged: (record: ChatRecord) => void;
}

/** Orchestration: create, send, resume, summarize (docs/ARCHITECTURE.md §11). */
export class ChatService {
	/** Chats whose session was checked (and restored if needed) this session. */
	private restored = new Set<string>();
	private summaryTimers = new Map<string, number>();
	private summarizing = new Set<string>();
	private refreshAttempts = new Set<string>();
	private refreshQueue: Promise<void> = Promise.resolve();
	private busyListeners = new Set<(chatId: string, busy: boolean) => void>();

	constructor(private deps: ChatServiceDeps) {}

	get store(): ChatStore {
		return this.deps.store;
	}

	vaultBasePath(): string {
		const adapter = this.deps.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error('LLM Sessions needs a desktop vault.');
		return adapter.getBasePath();
	}

	/** Absolute folder of the home note: the session's cwd (§7). */
	cwdFor(record: ChatRecord): string {
		return join(this.vaultBasePath(), parentFolder(record.homeNote));
	}

	onBusyChange(listener: (chatId: string, busy: boolean) => void): () => void {
		this.busyListeners.add(listener);
		return () => this.busyListeners.delete(listener);
	}

	isBusy(chatId: string): boolean {
		return this.deps.runtime.isBusy(chatId);
	}

	// ── Creating and embedding ────────────────────────────────────────────

	async createChat(editor: Editor, file: TFile): Promise<ChatRecord> {
		const record = this.store.newRecord(file.path);
		await this.store.save(record);
		this.insertCallout(editor, record);
		return record;
	}

	async embedInNote(record: ChatRecord, editor: Editor, file: TFile): Promise<void> {
		this.insertCallout(editor, record);
		if (!record.hostNotes.includes(file.path)) {
			record.hostNotes.push(file.path);
			await this.store.save(record, false);
		}
	}

	private insertCallout(editor: Editor, record: ChatRecord): void {
		const block = serializeChatCallout({
			chatId: record.id,
			title: record.title,
			summary: record.summary,
			messageCount: record.messageCount,
			fold: this.deps.settings().embedsCollapsed ? '-' : '+',
		});
		// Blank lines around the callout keep later typing out of it (see callout-insert.ts).
		const plan = planCalloutInsert(editor.getValue().split('\n'), editor.getCursor().line, block);
		editor.replaceRange(plan.text, plan.from, plan.to);
		editor.setCursor(plan.cursor);
	}

	// ── Context ───────────────────────────────────────────────────────────

	contextNotePaths(record: ChatRecord): string[] {
		return [...new Set([...record.hostNotes, ...record.extraContextNotes])];
	}

	private async readContextNotes(record: ChatRecord): Promise<ContextNote[]> {
		const notes: ContextNote[] = [];
		for (const path of this.contextNotePaths(record)) {
			const file = this.deps.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const kind = contextKind(file.extension);
			if (!kind) continue;
			if (this.deps.vault.isExcluded(file)) notes.push({ path, content: null });
			else if (kind === 'text') notes.push({ path, content: await this.deps.app.vault.cachedRead(file) });
			// Images and PDFs are read only when they are sent; their fingerprint tracks changes.
			else notes.push({ path, content: '', binary: { kind, fingerprint: `${file.stat.mtime}:${file.stat.size}` } });
		}
		return notes;
	}

	private async readAttachments(attach: PreparedTurn['attach']): Promise<Attachment[]> {
		const out: Attachment[] = [];
		for (const { path, kind } of attach) {
			const file = this.deps.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const problem = contextFileProblem(file.name, file.stat.size);
			if (problem) throw new Error(`${problem} Remove it from the context to keep chatting.`);
			const data = arrayBufferToBase64(await this.deps.app.vault.readBinary(file));
			out.push({ path, kind, mediaType: mediaType(file.extension), data });
		}
		return out;
	}

	/** Context notes and files edited since they were last sent (§8.2 hint in the panel). */
	async pendingNoteUpdates(record: ChatRecord): Promise<string[]> {
		if (!record.sessionId) return [];
		return changedNotes(record.id, await this.readContextNotes(record), record.noteHashesSent, hashText);
	}

	/** Why a vault file can't go into a chat's context, or null when it can. */
	contextFileProblem(file: TFile): string | null {
		if (this.deps.vault.isExcluded(file)) return `${file.name} is excluded from chat context in the plugin settings.`;
		return contextFileProblem(file.name, file.stat.size);
	}

	/** Adds a note or file to the context. Returns false when it was already there. */
	async addContextNote(record: ChatRecord, path: string): Promise<boolean> {
		if (this.contextNotePaths(record).includes(path)) return false;
		record.extraContextNotes.push(path);
		await this.store.save(record, false);
		return true;
	}

	async removeContextNote(record: ChatRecord, path: string): Promise<void> {
		record.extraContextNotes = record.extraContextNotes.filter((p) => p !== path);
		await this.store.save(record, false);
	}

	// ── Conversation ──────────────────────────────────────────────────────

	/** Restores the session from the vault mirror if Claude Code no longer has it. */
	async ensureSession(record: ChatRecord): Promise<void> {
		if (!record.sessionId || this.restored.has(record.id)) return;
		const ok = await this.deps.mirror.ensureLocal(record);
		if (!ok) {
			throw new Error('This chat\'s Claude Code session is missing on this computer, and there is no copy in the vault to restore.');
		}
		this.restored.add(record.id);
	}

	async loadTurns(record: ChatRecord): Promise<Turn[]> {
		if (!record.sessionId) return [];
		await this.ensureSession(record);
		return this.deps.transcripts.turns(record);
	}

	/** Pre-warms the chat's Claude Code process when its panel opens. */
	async warm(record: ChatRecord): Promise<void> {
		try {
			await this.ensureSession(record);
			this.deps.runtime.warm?.(record);
		} catch {
			// Reported when the user sends.
		}
	}

	/**
	 * Sends one user message and streams the reply to `onEvent` (§11.2). Errors from the
	 * runtime arrive as a `result` event, so this only throws for problems found before
	 * sending (missing session, an attachment that is too large).
	 */
	async send(chatId: string, userText: string, onEvent: (e: RuntimeEvent) => void): Promise<void> {
		const record = this.store.get(chatId);
		if (!record) throw new Error('Chat not found.');
		// A new message makes any pending summary out of date; one is scheduled after the reply.
		this.cancelSummary(chatId);
		await this.ensureSession(record);

		// "First turn" means no Claude Code session exists yet. If the first attempt fails
		// before a session starts, the next attempt is a first turn again and resends all context.
		const isFirstTurn = !record.sessionId;
		const prepared = prepareTurn(record.id, userText, await this.readContextNotes(record), record.noteHashesSent, hashText, isFirstTurn);
		const turn = { text: prepared.text, attachments: await this.readAttachments(prepared.attach) };
		const cwd = this.cwdFor(record);
		// The session event can fire mid-stream; its save is awaited after the turn so it can't race afterTurn's save.
		let saving: Promise<void> = Promise.resolve();

		this.emitBusy(chatId, true);
		try {
			await this.deps.runtime.send(record, turn, (e) => {
				// The session ID is known as soon as Claude Code starts; store it right away so a crash
				// mid-reply still leaves a resumable chat, and record which note versions it received.
				if (e.type === 'session' && record.sessionId !== e.sessionId) {
					record.sessionId = e.sessionId;
					record.sessionCwd = cwd;
					record.noteHashesSent = prepared.sentHashes;
					saving = this.store.save(record);
				}
				onEvent(e);
			});
		} catch {
			// The runtime already reported the failure as a result event.
		} finally {
			this.emitBusy(chatId, false);
		}
		await saving;
		// No session means Claude Code never started (for example, not signed in); nothing to record.
		if (record.sessionId) {
			record.noteHashesSent = prepared.sentHashes;
			await this.afterTurn(record);
		}
	}

	async interrupt(chatId: string): Promise<void> {
		await this.deps.runtime.interrupt(chatId);
	}

	/**
	 * Bookkeeping after each reply, in dependency order: the transcript first (it updates the
	 * message count and aliases), then the record, the vault mirror, the callouts, and finally
	 * the title or the idle summary. Failures in the optional steps are logged, not shown.
	 */
	private async afterTurn(record: ChatRecord): Promise<void> {
		try {
			const { result } = await this.deps.transcripts.update(record);
			if (result === 'diverged') this.deps.onTranscriptDiverged(record);
		} catch (e) {
			console.warn('[llm-sessions] Transcript update failed', e);
		}
		await this.store.save(record);
		if (this.deps.settings().mirrorSessions) {
			try {
				await this.deps.mirror.mirror(record);
			} catch (e) {
				console.warn('[llm-sessions] Session mirror failed', e);
			}
		}
		await updateEmbeds(this.deps.app, record);
		if (!record.title && !record.titleEditedByUser) {
			// The title is generated once, right after the first reply.
			void this.summarizeNow(record.id);
		} else {
			this.scheduleSummary(record.id);
		}
	}

	async regenerateTranscript(record: ChatRecord, keepEdits: boolean): Promise<void> {
		if (keepEdits) {
			record.transcriptMode = 'frozen';
		} else {
			await this.deps.transcripts.update(record, true);
		}
		await this.store.save(record, false);
	}

	// ── Titles, models, summaries ─────────────────────────────────────────

	async setTitle(record: ChatRecord, title: string): Promise<void> {
		record.title = title.trim() || null;
		record.titleEditedByUser = record.title !== null;
		await this.store.save(record, false);
		await updateEmbeds(this.deps.app, record);
		if (record.transcriptMode === 'auto' && record.sessionId) {
			await this.deps.transcripts.update(record).catch(() => undefined);
			await this.store.save(record, false);
		}
	}

	async setModel(record: ChatRecord, model: string | undefined, effort: Effort | undefined): Promise<void> {
		record.model = model;
		record.effort = effort;
		await this.store.save(record, false);
	}

	private scheduleSummary(chatId: string): void {
		this.cancelSummary(chatId);
		const ms = Math.max(0.25, this.deps.settings().summaryIdleMinutes) * 60000;
		this.summaryTimers.set(
			chatId,
			window.setTimeout(() => {
				this.summaryTimers.delete(chatId);
				void this.summarizeNow(chatId);
			}, ms),
		);
	}

	private cancelSummary(chatId: string): void {
		const t = this.summaryTimers.get(chatId);
		if (t !== undefined) window.clearTimeout(t);
		this.summaryTimers.delete(chatId);
	}

	/** Runs a pending summary now (when the panel closes). */
	flushSummary(chatId: string): void {
		if (!this.summaryTimers.has(chatId)) return;
		this.cancelSummary(chatId);
		void this.summarizeNow(chatId);
	}

	/**
	 * Rewrites a summary that no longer matches its chat or the current summary rules
	 * (SUMMARY_VERSION). Called when a chat's callout is drawn or the chat opens in the panel,
	 * so old callouts update when the user looks at them. Refreshes run one at a time, and each
	 * chat state is tried once per session, so a failing summary can't retry on every redraw.
	 */
	refreshIfOutdated(chatId: string): void {
		const record = this.store.get(chatId);
		if (!record?.summary || !record.sessionId) return;
		const key = this.sourceKey(record);
		if (record.summarySourceHash === key) return;
		// A pending idle summary or a running reply will produce a fresh summary anyway.
		if (this.summaryTimers.has(chatId) || this.summarizing.has(chatId) || this.isBusy(chatId)) return;
		const attempt = `${chatId}|${key}`;
		if (this.refreshAttempts.has(attempt)) return;
		this.refreshAttempts.add(attempt);
		this.refreshQueue = this.refreshQueue
			.then(() => this.summarizeNow(chatId))
			.catch((e) => console.warn('[llm-sessions] Summary refresh failed', e));
	}

	/** Changes when the conversation or the summary rules change. Bump SUMMARY_VERSION to refresh old summaries. */
	private sourceKey(record: ChatRecord): string {
		return `${SUMMARY_VERSION}:${record.messageCount}:${record.messageAliases[`m${record.messageCount}`] ?? ''}`;
	}

	/**
	 * Writes the chat's summary, and its title if it has none (§9). Skips when the summary already
	 * matches the conversation. On failure the old summary stays and is marked stale.
	 */
	async summarizeNow(chatId: string): Promise<void> {
		const record = this.store.get(chatId);
		if (!record?.sessionId || this.summarizing.has(chatId)) return;
		if (record.summary && record.summarySourceHash === this.sourceKey(record)) return;
		this.summarizing.add(chatId);
		try {
			const turns = await this.deps.transcripts.turns(record);
			const wantTitle = !record.title && !record.titleEditedByUser;
			// A short single reply is shown as-is; a model summary would be longer than the chat.
			const shortReply = shortChatSummary(turns);
			let result: { title?: string; summary?: string } | null = shortReply !== null ? { summary: shortReply } : null;
			if (wantTitle || shortReply === null) {
				const generated = await summarizeConversation(this.deps.settings(), this.deps.apiKey(), this.cwdFor(record), conversationForSummary(turns), {
					title: wantTitle,
					summary: shortReply === null,
				});
				result = generated ? { title: generated.title, summary: shortReply ?? generated.summary } : result;
			}
			if (!result?.summary) {
				record.summaryStale = true;
				await this.store.save(record, false);
				return;
			}
			record.summary = result.summary;
			if (wantTitle && result.title && !record.titleEditedByUser) record.title = result.title;
			record.summarySourceHash = this.sourceKey(record);
			record.summaryStale = false;
			if (record.transcriptMode === 'auto') await this.deps.transcripts.update(record).catch(() => undefined);
			await this.store.save(record, false);
			await updateEmbeds(this.deps.app, record);
		} finally {
			this.summarizing.delete(chatId);
		}
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * The panel stopped showing this chat: it was closed, or switched to another chat.
	 * Clicking back into a note does not count; the panel is still open then.
	 */
	onPanelClosed(chatId: string): void {
		this.flushSummary(chatId);
		this.deps.runtime.release(chatId);
	}

	private emitBusy(chatId: string, busy: boolean): void {
		for (const l of this.busyListeners) l(chatId, busy);
	}

	dispose(): void {
		for (const t of this.summaryTimers.values()) window.clearTimeout(t);
		this.summaryTimers.clear();
		this.deps.runtime.releaseAll();
	}
}

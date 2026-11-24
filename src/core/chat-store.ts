import type { App } from 'obsidian';
import type { ChatId, ChatRecord } from '../types';
import { newChatId } from '../utils/ids';
import { parentFolder } from '../utils/paths';
import type { ChatFolders } from './chat-folders';

/**
 * Reads and writes chat records and transcripts in hidden chat folders.
 * Keeps every record in memory (they are small) so lookups by note are cheap.
 */
export class ChatStore {
	private records = new Map<string, ChatRecord>();
	private listeners = new Set<(record: ChatRecord) => void>();

	constructor(
		private app: App,
		readonly folders: ChatFolders,
	) {}

	all(): ChatRecord[] {
		return [...this.records.values()];
	}

	get(id: string): ChatRecord | undefined {
		return this.records.get(id);
	}

	/** Called whenever a record is saved, so views and embeds can refresh. */
	onChange(listener: (record: ChatRecord) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	newRecord(homeNote: string): ChatRecord {
		const now = new Date().toISOString();
		return {
			id: newChatId(),
			sessionId: null,
			sessionCwd: null,
			runtime: 'claude-agent',
			title: null,
			titleEditedByUser: false,
			summary: null,
			summaryStale: false,
			homeNote,
			hostNotes: [homeNote],
			extraContextNotes: [],
			noteHashesSent: {},
			messageAliases: {},
			responseEmbeds: {},
			messageCount: 0,
			transcriptHash: null,
			transcriptMode: 'auto',
			createdAt: now,
			updatedAt: now,
		};
	}

	recordPath(record: ChatRecord): string {
		return this.folders.recordPath(record.homeNote, record.id);
	}

	transcriptPath(record: ChatRecord): string {
		return this.folders.transcriptPath(record.homeNote, record.id);
	}

	mirrorPath(record: ChatRecord): string {
		return this.folders.mirrorPath(record.homeNote, record.id);
	}

	/**
	 * Writes the record and tells listeners (panel header, index). `touch` updates `updatedAt`,
	 * which orders chats in the picker: pass false for changes that aren't chat activity
	 * (summaries, renames, model changes, note moves).
	 */
	async save(record: ChatRecord, touch = true): Promise<void> {
		if (touch) record.updatedAt = new Date().toISOString();
		await this.folders.ensure(record.homeNote);
		await this.app.vault.adapter.write(this.recordPath(record), JSON.stringify(record, null, '\t'));
		this.records.set(record.id, record);
		for (const l of this.listeners) l(record);
	}

	/**
	 * Loads a record file. A file that does not parse (for example a sync conflict) is
	 * copied to `<id>.conflict.json` and left in place; it is never deleted.
	 */
	async loadFile(path: string): Promise<ChatRecord | null> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) return null;
		const raw = await adapter.read(path);
		try {
			const record = normalize(JSON.parse(raw) as Partial<ChatRecord>);
			if (!record) return null;
			this.records.set(record.id, record);
			return record;
		} catch {
			const conflict = path.replace(/\.json$/, '.conflict.json');
			if (!(await adapter.exists(conflict))) await adapter.write(conflict, raw);
			console.warn(`[llm-sessions] Could not parse chat record ${path}; kept a copy at ${conflict}`);
			return null;
		}
	}

	/** Lists record files in one chat folder. */
	async listFolder(chatFolder: string): Promise<string[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(chatFolder))) return [];
		const listing = await adapter.list(chatFolder);
		return listing.files.filter((f) => /\/c-[a-z0-9]+\.json$/.test(f) || /^c-[a-z0-9]+\.json$/.test(f));
	}

	async readTranscript(record: ChatRecord): Promise<string | null> {
		const path = this.transcriptPath(record);
		const adapter = this.app.vault.adapter;
		return (await adapter.exists(path)) ? adapter.read(path) : null;
	}

	async writeTranscript(record: ChatRecord, markdown: string): Promise<void> {
		await this.folders.ensure(record.homeNote);
		await this.app.vault.adapter.write(this.transcriptPath(record), markdown);
	}

	/** Moves a chat's files when its home note moves to another folder. */
	async moveHome(record: ChatRecord, newHomeNote: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const from = { record: this.recordPath(record), transcript: this.transcriptPath(record), mirror: this.mirrorPath(record) };
		const oldFolder = this.folders.folderFor(record.homeNote);
		const sameFolder = parentFolder(record.homeNote) === parentFolder(newHomeNote);
		record.homeNote = newHomeNote;
		if (!sameFolder) {
			await this.folders.ensure(newHomeNote);
			const to = { record: this.recordPath(record), transcript: this.transcriptPath(record), mirror: this.mirrorPath(record) };
			for (const key of ['record', 'transcript', 'mirror'] as const) {
				// A folder rename moves the hidden folder along with it; only move what is still behind.
				if ((await adapter.exists(from[key])) && !(await adapter.exists(to[key]))) {
					await adapter.rename(from[key], to[key]);
				}
			}
			await this.folders.removeIfEmpty(oldFolder);
		}
		await this.save(record, false);
	}

	forget(id: ChatId): void {
		this.records.delete(id);
	}
}

function normalize(raw: Partial<ChatRecord>): ChatRecord | null {
	if (!raw.id || !raw.homeNote) return null;
	return {
		sessionId: null,
		sessionCwd: null,
		runtime: 'claude-agent',
		title: null,
		titleEditedByUser: false,
		summary: null,
		summaryStale: false,
		hostNotes: [raw.homeNote],
		extraContextNotes: [],
		noteHashesSent: {},
		messageAliases: {},
		responseEmbeds: {},
		messageCount: 0,
		transcriptHash: null,
		transcriptMode: 'auto',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...raw,
	} as ChatRecord;
}

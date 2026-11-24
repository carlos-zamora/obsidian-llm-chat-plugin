import type { App } from 'obsidian';
import { joinVault } from '../utils/paths';
import type { ChatStore } from './chat-store';

/**
 * Plugin-maintained index of chats (hidden folders are not indexed by Obsidian).
 * The cache (chatId → record path) lives in data.json and is checked against disk on load.
 */
export class ChatIndex {
	private ready: Promise<void> | null = null;

	constructor(
		private app: App,
		private store: ChatStore,
		private folderName: () => string,
		private cache: Record<string, string>,
		private persist: (cache: Record<string, string>) => Promise<void>,
	) {
		store.onChange((record) => {
			const path = store.recordPath(record);
			if (this.cache[record.id] !== path) {
				this.cache[record.id] = path;
				void this.persist(this.cache);
			}
		});
	}

	/** Builds the index once; later calls return the same promise. */
	whenReady(): Promise<void> {
		this.ready ??= this.build();
		return this.ready;
	}

	async rebuild(): Promise<void> {
		this.ready = this.build();
		return this.ready;
	}

	private async build(): Promise<void> {
		const found: Record<string, string> = {};
		// Fast path: cached paths that still exist.
		for (const [id, path] of Object.entries(this.cache)) {
			const record = await this.store.loadFile(path);
			if (record && record.id === id) found[id] = path;
		}
		// Full scan: only folders that contain notes, and only record files (never transcripts).
		const name = this.folderName();
		for (const folder of this.app.vault.getAllFolders(true)) {
			const chatFolder = joinVault(folder.isRoot() ? '' : folder.path, name);
			for (const path of await this.store.listFolder(chatFolder)) {
				if (Object.values(found).includes(path)) continue;
				const record = await this.store.loadFile(path);
				if (record) found[record.id] = path;
			}
		}
		this.cache = found;
		await this.persist(found);
	}
}

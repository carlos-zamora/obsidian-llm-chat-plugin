import type { App } from 'obsidian';
import { chatFolderFor, joinVault } from '../utils/paths';

/**
 * Resolves the hidden chat folder next to a note (`<note folder>/.chat-data`).
 * Hidden folders are not indexed by Obsidian, so everything goes through `vault.adapter`.
 */
export class ChatFolders {
	constructor(
		private app: App,
		private folderName: () => string,
	) {}

	folderFor(notePath: string): string {
		return chatFolderFor(notePath, this.folderName());
	}

	recordPath(notePath: string, chatId: string): string {
		return joinVault(this.folderFor(notePath), `${chatId}.json`);
	}

	transcriptPath(notePath: string, chatId: string): string {
		return joinVault(this.folderFor(notePath), `${chatId}.md`);
	}

	mirrorPath(notePath: string, chatId: string): string {
		return joinVault(this.folderFor(notePath), `${chatId}.session.jsonl`);
	}

	async ensure(notePath: string): Promise<string> {
		const folder = this.folderFor(notePath);
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.adapter.mkdir(folder);
		}
		return folder;
	}

	/** Removes a chat folder only when it holds no files at all. */
	async removeIfEmpty(folder: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(folder))) return;
		const listing = await adapter.list(folder);
		if (listing.files.length === 0 && listing.folders.length === 0) {
			await adapter.rmdir(folder, false);
		}
	}
}

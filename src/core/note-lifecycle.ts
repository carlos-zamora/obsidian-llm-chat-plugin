import { TFile, type App, type TAbstractFile } from 'obsidian';
import type { ChatStore } from './chat-store';
import { planDelete, planRename } from './note-moves';

/**
 * Keeps chats attached to their notes when notes are renamed, moved or deleted.
 * Listens to note events only; hidden chat files never produce vault events.
 * Events are handled one at a time so moves never race each other.
 */
export class NoteLifecycle {
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private app: App,
		private store: ChatStore,
	) {}

	onRename(file: TAbstractFile, oldPath: string): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		this.enqueue(() => this.handleRename(oldPath, file.path));
	}

	onDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		this.enqueue(() => this.handleDelete(file.path));
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task).catch((e) => console.error('[llm-sessions] Note lifecycle error', e));
	}

	private async handleRename(oldPath: string, newPath: string): Promise<void> {
		for (const record of this.store.all()) {
			const plan = planRename(record, oldPath, newPath);
			if (!plan.changed) continue;
			record.hostNotes = plan.hostNotes;
			record.extraContextNotes = plan.extraContextNotes;
			if (plan.homeMoved) {
				// Moves record, transcript and mirror when the folder changed; saves the record.
				await this.store.moveHome(record, plan.homeNote);
			} else {
				await this.store.save(record, false);
			}
		}
	}

	private async handleDelete(path: string): Promise<void> {
		for (const record of this.store.all()) {
			const plan = planDelete(record, path);
			if (!plan.changed && !plan.orphaned) continue;
			// Chat data is never deleted automatically; an orphan stays where it is.
			record.hostNotes = plan.hostNotes;
			record.extraContextNotes = plan.extraContextNotes;
			await this.store.save(record, false);
		}
	}

	isOrphan(homeNote: string): boolean {
		return !(this.app.vault.getAbstractFileByPath(homeNote) instanceof TFile);
	}
}

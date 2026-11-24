import { SuggestModal, TFile, type App } from 'obsidian';
import type { ChatRecord } from '../types';
import { DEFAULT_TITLE } from '../embed/callout-format';
import { noteDisplayName, parentFolder } from '../utils/paths';

/** Fuzzy picker over chats: this folder's chats first, then the rest of the vault (§5.3). */
export class ChatPicker extends SuggestModal<ChatRecord> {
	constructor(
		app: App,
		private chats: () => ChatRecord[],
		private activeFolder: string | null,
		private onPick: (chat: ChatRecord) => void,
	) {
		super(app);
		this.setPlaceholder('Search chats by title, summary or note');
		this.emptyStateText = 'No chats yet. Use "Start chat from this note" to create one.';
	}

	getSuggestions(query: string): ChatRecord[] {
		const q = query.trim().toLowerCase();
		const terms = q.split(/\s+/).filter(Boolean);
		return this.chats()
			.filter((c) => {
				if (terms.length === 0) return true;
				const hay = `${c.title ?? ''} ${c.summary ?? ''} ${c.hostNotes.join(' ')}`.toLowerCase();
				return terms.every((t) => hay.includes(t));
			})
			.sort((a, b) => {
				const af = this.inActiveFolder(a) ? 0 : 1;
				const bf = this.inActiveFolder(b) ? 0 : 1;
				return af - bf || b.updatedAt.localeCompare(a.updatedAt);
			});
	}

	private inActiveFolder(c: ChatRecord): boolean {
		return this.activeFolder !== null && parentFolder(c.homeNote) === this.activeFolder;
	}

	renderSuggestion(chat: ChatRecord, el: HTMLElement): void {
		el.addClass('llm-picker-item');
		const top = el.createDiv({ cls: 'llm-picker-title' });
		top.createSpan({ text: chat.title ?? DEFAULT_TITLE });
		if (this.inActiveFolder(chat)) top.createSpan({ cls: 'llm-picker-badge', text: 'This folder' });
		const orphan = !(this.app.vault.getAbstractFileByPath(chat.homeNote) instanceof TFile);
		if (orphan) top.createSpan({ cls: 'llm-picker-badge mod-warning', text: 'Note deleted' });
		if (chat.summary) el.createDiv({ cls: 'llm-picker-summary', text: chat.summary });
		const notes = chat.hostNotes.length ? chat.hostNotes.map(noteDisplayName).join(', ') : noteDisplayName(chat.homeNote);
		el.createDiv({ cls: 'llm-picker-meta', text: `${notes} · ${relativeTime(chat.updatedAt)} · ${chat.messageCount} messages` });
	}

	onChooseSuggestion(chat: ChatRecord): void {
		this.onPick(chat);
	}
}

function relativeTime(iso: string): string {
	const diff = Date.now() - Date.parse(iso);
	const min = Math.round(diff / 60000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min} min ago`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	return d < 30 ? `${d} d ago` : new Date(iso).toLocaleDateString();
}

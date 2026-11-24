import { MarkdownView, Notice, type App, type Editor, type MarkdownFileInfo, type Plugin } from 'obsidian';
import type { ChatService } from '../core/chat-service';
import type { ChatIndex } from '../core/chat-index';
import type { ChatRecord } from '../types';
import { containsChatCallout } from '../embed/callout-format';
import { ChatPicker } from '../ui/chat-picker';
import { choose } from '../ui/modals';
import { activeMarkdownView, focusChatInput, openChatPanel } from '../ui/panel';
import { parentFolder } from '../utils/paths';

export interface CommandHost {
	app: App;
	service: ChatService;
	index: ChatIndex;
	ensureOnboarded: () => boolean;
}

/** Phase 1 commands. IDs are stable and must not be renamed after release. */
export function registerCommands(plugin: Plugin, host: CommandHost): void {
	plugin.addCommand({
		id: 'new-chat',
		name: 'Start chat from this note',
		editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			if (!ctx.file || ctx.file.extension !== 'md') return false;
			if (!checking) void startChat(host, editor, ctx);
			return true;
		},
	});

	plugin.addCommand({
		id: 'open-chat',
		name: 'Open existing chat…',
		callback: () => void pickChat(host),
	});
}

export async function startChat(host: CommandHost, editor: Editor, ctx: MarkdownView | MarkdownFileInfo): Promise<void> {
	if (!host.ensureOnboarded() || !ctx.file) return;
	const record = await host.service.createChat(editor, ctx.file);
	await openChatPanel(host.app, record.id);
}

/** Starts a chat from the note the user was last editing (ribbon and empty panel). */
export function startChatFromActiveNote(host: CommandHost): void {
	const view = activeMarkdownView(host.app);
	if (!view?.file) {
		new Notice('Open a note first, then start a chat from it.');
		return;
	}
	void startChat(host, view.editor, view);
}

async function pickChat(host: CommandHost): Promise<void> {
	await host.index.whenReady();
	const view = activeMarkdownView(host.app);
	const folder = view?.file ? parentFolder(view.file.path) : null;
	new ChatPicker(host.app, () => host.service.store.all(), folder, (chat) => void openPicked(host, chat, view)).open();
}

async function openPicked(host: CommandHost, chat: ChatRecord, view: MarkdownView | null): Promise<void> {
	const file = view?.file;
	const offerEmbed = Boolean(view && file && !chat.hostNotes.includes(file.path) && !containsChatCallout(view.editor.getValue(), chat.id));
	// When the embed question follows, focus the message box after it closes, not behind it.
	await openChatPanel(host.app, chat.id, null, { focusInput: !offerEmbed });
	if (!offerEmbed || !view || !file) return;
	const answer = await choose(host.app, 'Embed this chat?', `Add a callout for this chat to ${file.basename} at the cursor?`, [
		{ value: 'no', label: 'Not now' },
		{ value: 'yes', label: 'Embed', cta: true },
	]);
	if (answer === 'yes') await host.service.embedInNote(chat, view.editor, file);
	focusChatInput(host.app);
}

import { MarkdownView, Notice, type App, type WorkspaceLeaf } from 'obsidian';
import { ChatView, VIEW_TYPE_CHAT } from './chat-view';

export interface OpenChatOptions {
	/** Put the cursor in the message box once the chat is shown. Defaults to true. */
	focusInput?: boolean;
}

/**
 * Opens (or reuses) the chat panel in the right sidebar and shows a chat in it.
 * Every way of opening a chat (new chat, open chat, Continue, links, ribbon) comes through
 * here, so they all leave the cursor in the message box, ready to type.
 */
export async function openChatPanel(
	app: App,
	chatId: string | null,
	messageAlias: string | null = null,
	options: OpenChatOptions = {},
): Promise<void> {
	let leaf: WorkspaceLeaf | null = app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
	if (leaf) {
		await leaf.loadIfDeferred();
		if (leaf.view instanceof ChatView) {
			await leaf.view.showChat(chatId, messageAlias);
		}
	} else {
		leaf = app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice('Could not open the chat panel.');
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true, state: { chatId, message: messageAlias } });
	}
	await app.workspace.revealLeaf(leaf);
	if (options.focusInput ?? true) focusChatInput(app);
}

/** Puts the cursor in the chat panel's message box. */
export function focusChatInput(app: App): void {
	const view = app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0]?.view;
	if (!(view instanceof ChatView)) return;
	// Deferred one tick: revealing the leaf, and a closing palette or modal, can move focus after this runs.
	window.setTimeout(() => view.focusInput(), 0);
}

/** The Markdown editor the user is working in, even when the chat panel has focus. */
export function activeMarkdownView(app: App): MarkdownView | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active) return active;
	const recent = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
	return recent?.view instanceof MarkdownView ? recent.view : null;
}

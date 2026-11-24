import { Notice, setIcon, type Plugin } from 'obsidian';
import type { ChatService } from '../core/chat-service';
import { chatLink } from './callout-format';

export interface EmbedHost {
	service: ChatService;
	openChat: (chatId: string) => void;
	indexReady: () => boolean;
}

const SELECTOR = '.callout[data-callout="llm-chat"]';
const CALLOUT_DISCLAIMER = 'Written by AI. It can contain mistakes.';

/** Adds actions and state to rendered chat callouts (§5.1): Continue, Copy link; streaming, chat missing. */
export function registerEmbedPostProcessor(plugin: Plugin, host: EmbedHost): void {
	plugin.registerMarkdownPostProcessor((el) => {
		const callouts = el.matches(SELECTOR) ? [el] : Array.from(el.querySelectorAll<HTMLElement>(SELECTOR));
		for (const callout of callouts) decorate(callout, host);
	});

	plugin.register(
		host.service.onBusyChange((chatId, busy) => {
			activeDocument.querySelectorAll<HTMLElement>(`${SELECTOR}[data-callout-metadata="${chatId}"]`).forEach((c) => setState(c, busy ? 'streaming' : null));
		}),
	);
}

function decorate(callout: HTMLElement, host: EmbedHost): void {
	const chatId = callout.dataset.calloutMetadata;
	const title = callout.querySelector<HTMLElement>('.callout-title');
	if (!chatId || !title || title.querySelector('.llm-callout-actions')) return;

	const actions = title.createDiv({ cls: 'llm-callout-actions' });
	const button = (icon: string, label: string, onClick: () => void) => {
		const b = actions.createEl('button', { cls: 'clickable-icon llm-callout-action', attr: { 'aria-label': label } });
		setIcon(b, icon);
		b.addEventListener('click', (e) => {
			// Keep the click from folding the callout or moving the cursor into the source.
			e.preventDefault();
			e.stopPropagation();
			onClick();
		});
	};
	button('message-square', 'Continue', () => host.openChat(chatId));
	button('link', 'Copy link', () => {
		void navigator.clipboard.writeText(chatLink(chatId));
		new Notice('Chat link copied.');
	});

	// Drawn by the plugin, not written into the note, so the note's Markdown stays clean.
	// Inside the callout content, it shows only when the callout is expanded, next to the summary.
	callout.querySelector<HTMLElement>('.callout-content')?.createDiv({ cls: 'llm-ai-disclaimer', text: CALLOUT_DISCLAIMER });

	if (host.service.isBusy(chatId)) setState(callout, 'streaming');
	else if (host.indexReady() && !host.service.store.get(chatId)) setState(callout, 'missing');
	// An outdated summary updates when the user sees its callout.
	else host.service.refreshIfOutdated(chatId);
}

function setState(callout: HTMLElement, state: 'streaming' | 'missing' | null): void {
	const title = callout.querySelector<HTMLElement>('.callout-title');
	if (!title) return;
	title.querySelector('.llm-callout-state')?.remove();
	if (!state) return;
	const actions = title.querySelector('.llm-callout-actions');
	const badge = createSpan({ cls: `llm-callout-state is-${state}`, text: state === 'streaming' ? 'Streaming…' : 'Chat missing' });
	if (actions) title.insertBefore(badge, actions);
	else title.appendChild(badge);
}

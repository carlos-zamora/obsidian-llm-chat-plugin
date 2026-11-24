import { MarkdownRenderer, setIcon, type App, type Component } from 'obsidian';
import { collapseContext } from '../core/context-builder';
import { describeTool } from '../tools/vault-mcp-server';
import type { ToolActivity, Turn } from '../types';
import { throttle } from '../utils/throttle';

/** Renders conversation turns, and streams the reply in progress (throttled to ~50 ms). */
export class MessageRenderer {
	constructor(
		private app: App,
		private component: Component,
		private sourcePath: () => string,
	) {}

	async renderTurn(container: HTMLElement, turn: Turn): Promise<HTMLElement> {
		const el = this.shell(container, turn.role, turn.alias);
		const tools = el.createDiv({ cls: 'llm-tools' });
		for (const t of turn.tools) this.addTool(tools, t);
		const body = el.createDiv({ cls: 'llm-message-body' });
		const text = turn.role === 'user' ? collapseContext(turn.text) : turn.text;
		await MarkdownRenderer.render(this.app, text, body, this.sourcePath(), this.component);
		this.addCopy(el, () => text);
		return el;
	}

	renderUserDraft(container: HTMLElement, text: string): HTMLElement {
		const el = this.shell(container, 'user', null);
		void MarkdownRenderer.render(this.app, text, el.createDiv({ cls: 'llm-message-body' }), this.sourcePath(), this.component);
		return el;
	}

	startReply(container: HTMLElement): StreamingReply {
		const el = this.shell(container, 'assistant', null);
		el.addClass('is-streaming');
		return new StreamingReply(this, el);
	}

	addTool(container: HTMLElement, tool: ToolActivity): void {
		const row = container.createDiv({ cls: 'llm-tool' });
		setIcon(row.createSpan({ cls: 'llm-tool-icon' }), 'search');
		row.createSpan({ text: describeTool(tool.name, tool.input) });
	}

	addCopy(el: HTMLElement, text: () => string): void {
		const btn = el.createEl('button', { cls: 'llm-message-copy clickable-icon', attr: { 'aria-label': 'Copy' } });
		setIcon(btn, 'copy');
		btn.addEventListener('click', () => void navigator.clipboard.writeText(text()));
	}

	async renderMarkdown(text: string, el: HTMLElement): Promise<void> {
		await MarkdownRenderer.render(this.app, text, el, this.sourcePath(), this.component);
	}

	private shell(container: HTMLElement, role: Turn['role'], alias: string | null): HTMLElement {
		const el = container.createDiv({ cls: `llm-message llm-message-${role}` });
		if (alias) el.dataset.alias = alias;
		el.createDiv({ cls: 'llm-message-role', text: role === 'user' ? 'You' : 'Claude' });
		return el;
	}
}

export class StreamingReply {
	private committed = '';
	private partial = '';
	private tools: HTMLElement;
	private body: HTMLElement;
	private generation = 0;
	private render = throttle(() => void this.paint(), 50);

	constructor(
		private renderer: MessageRenderer,
		readonly el: HTMLElement,
	) {
		this.tools = el.createDiv({ cls: 'llm-tools' });
		this.body = el.createDiv({ cls: 'llm-message-body' });
		this.body.createSpan({ cls: 'llm-typing', text: 'Thinking…' });
	}

	get text(): string {
		return this.committed + (this.committed && this.partial ? '\n\n' : '') + this.partial;
	}

	delta(text: string): void {
		this.partial += text;
		this.render();
	}

	/** A complete text block: replaces the partial text streamed for it. */
	block(text: string): void {
		this.committed = this.committed ? `${this.committed}\n\n${text}` : text;
		this.partial = '';
		this.render();
	}

	tool(tool: ToolActivity): void {
		this.partial = '';
		this.renderer.addTool(this.tools, tool);
	}

	finish(error?: string): void {
		this.render.cancel();
		void this.paint();
		this.el.removeClass('is-streaming');
		if (error) this.el.createDiv({ cls: 'llm-error', text: error });
		this.renderer.addCopy(this.el, () => this.text);
	}

	/**
	 * Re-renders the whole reply off-screen, then swaps it in. Markdown rendering is async, so a
	 * slower older render could finish after a newer one; the generation number drops stale ones.
	 */
	private async paint(): Promise<void> {
		const gen = ++this.generation;
		const next = createDiv({ cls: 'llm-message-body' });
		await this.renderer.renderMarkdown(this.text, next);
		if (gen !== this.generation) return;
		this.body.replaceWith(next);
		this.body = next;
	}
}

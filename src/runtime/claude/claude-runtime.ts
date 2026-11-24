import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LlmSessionsSettings } from '../../settings/settings';
import type { ChatRecord, RuntimeEvent, UserTurn } from '../../types';
import type { AgentRuntime } from '../runtime';
import { buildChatOptions, effectiveModel } from './claude-options';

/**
 * Message content for a user turn. Attached images and PDFs come first as content blocks,
 * then the text (verified with Claude Code in docs/SPIKES.md).
 */
function messageContent(turn: UserTurn): SDKUserMessage['message']['content'] {
	if (turn.attachments.length === 0) return turn.text;
	return [
		...turn.attachments.map((a) =>
			a.kind === 'image'
				? { type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: a.data } }
				: { type: 'document' as const, title: a.path, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.data } },
		),
		{ type: 'text' as const, text: turn.text },
	];
}

/** Async iterable the SDK reads user messages from (streaming input mode). */
class InputQueue implements AsyncIterable<SDKUserMessage> {
	private items: (SDKUserMessage | null)[] = [];
	private waiters: ((v: SDKUserMessage | null) => void)[] = [];

	push(item: SDKUserMessage | null): void {
		const w = this.waiters.shift();
		if (w) w(item);
		else this.items.push(item);
	}

	async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		while (true) {
			const next = this.items.length > 0 ? this.items.shift()! : await new Promise<SDKUserMessage | null>((r) => this.waiters.push(r));
			if (next === null) return;
			yield next;
		}
	}
}

interface PendingTurn {
	onEvent: (e: RuntimeEvent) => void;
	resolve: () => void;
	reject: (e: Error) => void;
}

/**
 * One warm Claude Code process for one open chat. The SDK query stays open between turns:
 * each `send` pushes a user message into the input queue, and `loop` reads the SDK's messages
 * and routes them to the turn in progress (`pending`). Only one turn runs at a time.
 */
class LiveSession {
	readonly query: Query;
	private input = new InputQueue();
	private pending: PendingTurn | null = null;
	/** Set when the user pressed Stop, so the turn's error result reads as "Stopped." */
	interrupted = false;
	private stderrTail = '';
	dead = false;
	lastUsed = Date.now();

	constructor(
		readonly key: string,
		readonly abort: AbortController,
		options: Options,
	) {
		this.query = query({
			prompt: this.input,
			options: { ...options, stderr: (d) => (this.stderrTail = (this.stderrTail + d).slice(-2000)) },
		});
		void this.loop();
	}

	get busy(): boolean {
		return this.pending !== null;
	}

	send(turn: UserTurn, onEvent: (e: RuntimeEvent) => void): Promise<void> {
		if (this.dead) return Promise.reject(new Error('Claude Code process has ended.'));
		if (this.pending) return Promise.reject(new Error('A reply is still in progress.'));
		this.lastUsed = Date.now();
		return new Promise<void>((resolve, reject) => {
			this.pending = { onEvent, resolve, reject };
			this.interrupted = false;
			this.input.push({ type: 'user', message: { role: 'user', content: messageContent(turn) }, parent_tool_use_id: null, origin: { kind: 'human' } });
		});
	}

	/** Ends the input stream and the process. A turn still running fails with "process ended". */
	close(): void {
		this.input.push(null);
		this.query.close();
		this.dead = true;
	}

	/** Runs for the life of the process. When it ends, for any reason, a pending turn fails. */
	private async loop(): Promise<void> {
		try {
			for await (const m of this.query) this.handle(m);
			// The stream ended without an error: Claude Code exited. Its stderr usually says why.
			this.finish(new Error(this.stderrTail.trim() || 'Claude Code process ended.'));
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.finish(new Error(this.abort.signal.aborted ? 'Stopped.' : `${msg}${this.stderrTail ? `\n${this.stderrTail.trim()}` : ''}`));
		} finally {
			this.dead = true;
		}
	}

	private finish(error: Error): void {
		const p = this.pending;
		this.pending = null;
		if (p) {
			p.onEvent({ type: 'result', ok: false, error: error.message });
			p.reject(error);
		}
	}

	private handle(m: SDKMessage): void {
		const p = this.pending;
		// Messages outside a turn (for example while a pre-warmed process starts) have no one to go to.
		if (!p) return;
		this.lastUsed = Date.now();
		switch (m.type) {
			case 'system':
				if (m.subtype === 'init') p.onEvent({ type: 'session', sessionId: m.session_id, model: m.model });
				break;
			// parent_tool_use_id is set on subagent messages; only the main conversation is shown.
			case 'stream_event':
				if (m.parent_tool_use_id === null && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
					p.onEvent({ type: 'text-delta', text: m.event.delta.text });
				}
				break;
			case 'assistant':
				if (m.parent_tool_use_id !== null) break;
				for (const block of m.message.content) {
					if (block.type === 'text') p.onEvent({ type: 'assistant-text', text: block.text });
					else if (block.type === 'tool_use') {
						p.onEvent({ type: 'tool-use', tool: { name: block.name, input: (block.input ?? {}) as Record<string, unknown> } });
					}
				}
				break;
			// One result ends each turn; the process stays alive for the next one.
			case 'result': {
				this.pending = null;
				if (m.subtype === 'success' && !m.is_error) {
					p.onEvent({ type: 'result', ok: true, costUsd: m.total_cost_usd });
				} else {
					const detail = this.interrupted
						? 'Stopped.'
						: m.subtype === 'success'
							? m.result
							: [describeSubtype(m.subtype), ...m.errors].join(' ');
					p.onEvent({ type: 'result', ok: false, error: detail, costUsd: m.total_cost_usd });
				}
				p.resolve();
				break;
			}
			default:
				break;
		}
	}
}

function describeSubtype(subtype: string): string {
	switch (subtype) {
		case 'error_max_turns':
			return 'Stopped after reaching the tool-turn limit.';
		case 'error_max_budget_usd':
			return 'Stopped after reaching the spending cap.';
		default:
			return 'Claude Code reported an error.';
	}
}

export interface ClaudeRuntimeDeps {
	settings: () => LlmSessionsSettings;
	apiKey: () => string | null;
	cwdFor: (chat: ChatRecord) => string;
	vaultServer: (chat: ChatRecord) => NonNullable<Options['mcpServers']>[string];
}

const IDLE_MS = 10 * 60 * 1000;
const MAX_PROCESSES = 2;

/** Pool of warm streaming-input sessions, one per open chat (§7.2). */
export class ClaudeRuntime implements AgentRuntime {
	readonly id = 'claude-agent';
	private sessions = new Map<string, LiveSession>();

	constructor(private deps: ClaudeRuntimeDeps) {}

	/**
	 * Everything that is fixed when a process starts. When any of it changes (a different model,
	 * new custom instructions…), the next message starts a fresh process that resumes the same
	 * session with the new options.
	 */
	private keyFor(chat: ChatRecord): string {
		const { model, effort } = effectiveModel(chat, this.deps.settings());
		const s = this.deps.settings();
		return [model, effort, s.billing, s.claudePath, s.maxTurns, s.customInstructions, s.loadProjectSettings].join('|');
	}

	/** Starts (pre-warms) the chat's process if it isn't running. */
	warm(chat: ChatRecord): void {
		this.ensure(chat);
	}

	/** The chat's live process, starting one if needed. */
	private ensure(chat: ChatRecord): LiveSession {
		const key = this.keyFor(chat);
		let live = this.sessions.get(chat.id);
		// Replace a dead or outdated process, but never one that is mid-reply: the change applies next time.
		if (live && (live.dead || live.key !== key) && !live.busy) {
			live.close();
			this.sessions.delete(chat.id);
			live = undefined;
		}
		if (live) return live;
		this.evictIfFull();
		const abort = new AbortController();
		const options = buildChatOptions({
			settings: this.deps.settings(),
			chat,
			apiKey: this.deps.apiKey(),
			cwd: this.deps.cwdFor(chat),
			vaultServer: this.deps.vaultServer(chat),
			abortController: abort,
		});
		live = new LiveSession(key, abort, options);
		this.sessions.set(chat.id, live);
		return live;
	}

	/** Closes the least recently used idle process. If every process is busy, the pool briefly goes over the limit. */
	private evictIfFull(): void {
		if (this.sessions.size < MAX_PROCESSES) return;
		const idle = [...this.sessions.entries()].filter(([, s]) => !s.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		const oldest = idle[0];
		if (oldest) this.release(oldest[0]);
	}

	async send(chat: ChatRecord, turn: UserTurn, onEvent: (e: RuntimeEvent) => void): Promise<void> {
		const live = this.ensure(chat);
		await live.send(turn, onEvent);
	}

	async interrupt(chatId: string): Promise<void> {
		const live = this.sessions.get(chatId);
		if (!live?.busy) return;
		live.interrupted = true;
		try {
			// A polite stop: Claude Code ends the turn with a result, and the process stays warm.
			await live.query.interrupt();
		} catch {
			// The process didn't answer the stop request; kill it. The next message resumes the session.
			live.abort.abort();
			this.release(chatId);
		}
	}

	isBusy(chatId: string): boolean {
		return this.sessions.get(chatId)?.busy ?? false;
	}

	release(chatId: string): void {
		const live = this.sessions.get(chatId);
		if (!live) return;
		live.close();
		this.sessions.delete(chatId);
	}

	releaseAll(): void {
		for (const [id, live] of this.sessions) {
			live.abort.abort();
			live.close();
			this.sessions.delete(id);
		}
	}

	/** Closes processes idle for more than 10 minutes. Called on an interval. */
	sweep(): void {
		const now = Date.now();
		for (const [id, live] of this.sessions) {
			if (live.dead || (!live.busy && now - live.lastUsed > IDLE_MS)) this.release(id);
		}
	}
}

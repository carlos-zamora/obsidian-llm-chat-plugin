import type { ChatRecord, RuntimeEvent, UserTurn } from '../types';

/**
 * Provider seam (docs/ARCHITECTURE.md §15). Phase 1 ships only the Claude Agent SDK runtime,
 * but chat-service talks to this interface so other runtimes can slot in later.
 */
export interface AgentRuntime {
	/** Runtime identifier, for example 'claude-agent'. */
	readonly id: string;
	/** Sends one user turn; resolves when the turn ends. Events stream to `onEvent`. */
	send(chat: ChatRecord, turn: UserTurn, onEvent: (e: RuntimeEvent) => void): Promise<void>;
	interrupt(chatId: string): Promise<void>;
	isBusy(chatId: string): boolean;
	/** Optionally starts the chat's process ahead of the first message. */
	warm?(chat: ChatRecord): void;
	/** Ends the chat's live process, if any. */
	release(chatId: string): void;
	releaseAll(): void;
}

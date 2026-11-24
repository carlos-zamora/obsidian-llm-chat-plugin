export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ChatId = `c-${string}`;

/** The plugin's record of one conversation (docs/ARCHITECTURE.md §6.2). */
export interface ChatRecord {
	id: ChatId;
	/** Claude Code session UUID; null until the first turn starts the session. */
	sessionId: string | null;
	/** Absolute cwd the session was created in. */
	sessionCwd: string | null;
	runtime: 'claude-agent';
	/** Per-chat overrides; unset means the settings default. */
	model?: string;
	effort?: Effort;
	title: string | null;
	titleEditedByUser: boolean;
	summary: string | null;
	summaryStale: boolean;
	/** Transcript hash the current summary was made from. */
	summarySourceHash?: string;
	/** Vault path; decides which chat folder holds the files. */
	homeNote: string;
	/** Every note that embeds this chat (vault paths). */
	hostNotes: string[];
	/** Notes the user added to the context besides the host notes. */
	extraContextNotes: string[];
	/** Vault path → hash of the content last sent to the agent. */
	noteHashesSent: Record<string, string>;
	/** 'm7' → SDK message uuid. */
	messageAliases: Record<string, string>;
	responseEmbeds: Record<string, { subtitle: string; summary: string }>;
	messageCount: number;
	external?: { app: 'claude-ai'; url: string };
	inClaudeCode?: { since: string };
	transcriptHash: string | null;
	/** 'frozen' after the user chose to keep manual edits to the transcript. */
	transcriptMode: 'auto' | 'frozen';
	createdAt: string;
	updatedAt: string;
}

/** One visible turn of a conversation, as the panel and transcript show it. */
export interface Turn {
	alias: string;
	role: 'user' | 'assistant';
	/** SDK uuid of the first message in the turn. */
	uuid: string;
	text: string;
	tools: ToolActivity[];
}

export interface ToolActivity {
	name: string;
	input: Record<string, unknown>;
}

/** An image or PDF sent with a user turn. */
export interface Attachment {
	path: string;
	kind: 'image' | 'pdf';
	mediaType: string;
	/** Base64-encoded file content. */
	data: string;
}

/** What the user sends in one turn: text (with any context blocks) and attached files. */
export interface UserTurn {
	text: string;
	attachments: Attachment[];
}

/**
 * Events a runtime streams to the UI while a turn runs. Text arrives twice: `text-delta`
 * pieces for live display, then `assistant-text` with each finished block, which replaces
 * the pieces streamed for it.
 */
export type RuntimeEvent =
	| { type: 'session'; sessionId: string; model: string }
	| { type: 'text-delta'; text: string }
	| { type: 'assistant-text'; text: string }
	| { type: 'tool-use'; tool: ToolActivity }
	| { type: 'result'; ok: boolean; error?: string; costUsd?: number };

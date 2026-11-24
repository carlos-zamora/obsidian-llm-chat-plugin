import type { Turn } from '../types';

/**
 * What the summary model is allowed to see: the visible conversation only. Pure: no Obsidian imports.
 *
 * Note content travels inside user turns (<obsidian-context>, <note>, <note-update> blocks) so the
 * chat model can use it, but a callout summary must describe the chat, not the note. Those blocks
 * are removed entirely here, and tool activity (which can name notes) is left out.
 */

/** Removes every note context block from a user turn, leaving only what the user typed. */
export function stripNoteContext(text: string): string {
	return text
		.replace(/<obsidian-context>[\s\S]*?<\/obsidian-context>/g, '')
		.replace(/<note(?:-update)?\b[^>]*>[\s\S]*?<\/note(?:-update)?>/g, '')
		.replace(/<attachment\b[^>]*\/>/g, '')
		.trim();
}

/** Plain `User:` / `Assistant:` transcript for the summary prompt, newest messages kept when too long. */
export function conversationForSummary(turns: Turn[], maxChars = 40000): string {
	const lines = turns
		.map((t) => {
			const text = t.role === 'user' ? stripNoteContext(t.text) : t.text.trim();
			return text ? `${t.role === 'user' ? 'User' : 'Assistant'}: ${text}` : '';
		})
		.filter(Boolean);
	let out = lines.join('\n\n');
	if (out.length > maxChars) out = `[Earlier messages omitted]\n\n${out.slice(out.length - maxChars)}`;
	return out;
}

/** Longest reply shown as-is instead of a summary. */
export const SHORT_REPLY_MAX_CHARS = 400;
const SHORT_REPLY_MAX_LINES = 8;

/**
 * For a single exchange with a short reply, the reply itself is the best "summary": a model-written
 * summary would be longer than the chat. Returns null when a real summary is needed.
 */
export function shortChatSummary(turns: Turn[]): string | null {
	const replies = turns.filter((t) => t.role === 'assistant' && t.text.trim());
	if (replies.length !== 1) return null;
	const reply = replies[0]!.text.trim();
	if (reply.length > SHORT_REPLY_MAX_CHARS || reply.split('\n').length > SHORT_REPLY_MAX_LINES) return null;
	return reply;
}

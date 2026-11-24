/**
 * Parse and serialize chat callouts (docs/ARCHITECTURE.md §5.1). Pure: no Obsidian imports.
 *
 *   > [!llm-chat|c-01jf8z3k]- Choosing a sleep tracker
 *   > Summary text…
 *   >
 *   > [Open chat](obsidian://llm-chat?id=c-01jf8z3k) · 12 messages
 */

export type CalloutKind = 'chat' | 'response';

export interface ParsedCallout {
	kind: CalloutKind;
	chatId: string;
	/** Message alias for response embeds (`m7`). */
	messageAlias: string | null;
	/** '-' collapsed, '+' expanded, '' not foldable. */
	fold: '' | '+' | '-';
	title: string;
	/** First and last line index of the callout block (inclusive). */
	startLine: number;
	endLine: number;
}

const HEADER = /^>\s*\[!llm-(chat|response)\|(c-[a-z0-9]+)(?:#(m\d+))?\]([+-]?)[ \t]*(.*)$/;

export const DEFAULT_TITLE = 'New chat';

export function chatLink(chatId: string, messageAlias?: string): string {
	const msg = messageAlias ? `&message=${messageAlias}` : '';
	return `obsidian://llm-chat?id=${chatId}${msg}`;
}

export interface ChatCalloutData {
	chatId: string;
	title: string | null;
	summary: string | null;
	messageCount: number;
	fold: '' | '+' | '-';
}

export function serializeChatCallout(data: ChatCalloutData): string {
	const title = oneLine(data.title ?? '') || DEFAULT_TITLE;
	const lines = [`> [!llm-chat|${data.chatId}]${data.fold} ${title}`];
	const summary = (data.summary ?? '').trim();
	if (summary) {
		for (const line of summary.split(/\r?\n/)) lines.push(line ? `> ${line}` : '>');
		lines.push('>');
	}
	const count = data.messageCount > 0 ? ` · ${data.messageCount} ${data.messageCount === 1 ? 'message' : 'messages'}` : '';
	lines.push(`> [Open chat](${chatLink(data.chatId)})${count}`);
	return lines.join('\n');
}

export function findCallouts(text: string): ParsedCallout[] {
	const lines = text.split('\n');
	const found: ParsedCallout[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = HEADER.exec(stripCr(lines[i] ?? ''));
		if (!m) continue;
		let end = i;
		while (end + 1 < lines.length && stripCr(lines[end + 1] ?? '').startsWith('>')) end++;
		found.push({
			kind: m[1] as CalloutKind,
			chatId: m[2] ?? '',
			messageAlias: m[3] ?? null,
			fold: (m[4] ?? '') as '' | '+' | '-',
			title: (m[5] ?? '').trim(),
			startLine: i,
			endLine: end,
		});
		i = end;
	}
	return found;
}

/**
 * Replaces every chat callout for `chatId` (not response embeds) with `render(existing)`.
 * Returns the original text when nothing matched.
 */
export function replaceChatCallouts(
	text: string,
	chatId: string,
	render: (existing: ParsedCallout) => string,
): string {
	const matches = findCallouts(text).filter((c) => c.kind === 'chat' && c.chatId === chatId);
	if (matches.length === 0) return text;
	const lines = text.split('\n');
	const crlf = text.includes('\r\n');
	for (const c of [...matches].reverse()) {
		const block = render(c).split('\n').map((l) => (crlf ? `${l}\r` : l));
		lines.splice(c.startLine, c.endLine - c.startLine + 1, ...block);
	}
	return lines.join('\n');
}

/** Removes this chat's own callouts (chat and response embeds) so a note never contains itself. */
export function stripOwnCallouts(text: string, chatId: string): string {
	const matches = findCallouts(text).filter((c) => c.chatId === chatId);
	if (matches.length === 0) return text;
	const lines = text.split('\n');
	for (const c of [...matches].reverse()) lines.splice(c.startLine, c.endLine - c.startLine + 1);
	return lines.join('\n');
}

export function containsChatCallout(text: string, chatId: string): boolean {
	return findCallouts(text).some((c) => c.kind === 'chat' && c.chatId === chatId);
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function stripCr(s: string): string {
	return s.endsWith('\r') ? s.slice(0, -1) : s;
}

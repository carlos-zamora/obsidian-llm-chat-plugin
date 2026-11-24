import { stripOwnCallouts } from '../embed/callout-format';

/**
 * Builds the context that travels in user turns (docs/ARCHITECTURE.md §8). Context goes in
 * the user turn, not the system prompt, so it is saved in the session and still there
 * when the chat is resumed elsewhere. Pure: no Obsidian imports.
 */

/** A note or file in the chat's context. */
export interface ContextNote {
	path: string;
	/** Raw text (notes and text files), or null when the file is excluded from context. */
	content: string | null;
	/**
	 * Images and PDFs travel as attachments, not text. Their fingerprint (modified time and size)
	 * stands in for the content, so they are read from disk only when they are actually sent.
	 */
	binary?: { kind: 'image' | 'pdf'; fingerprint: string };
}

export interface PreparedTurn {
	text: string;
	/** Hashes to store in noteHashesSent once the turn is sent. */
	sentHashes: Record<string, string>;
	/** Notes and files whose content went with this turn. */
	updatedNotes: string[];
	/** Images and PDFs to attach to this turn; the caller reads their bytes. */
	attach: { path: string; kind: 'image' | 'pdf' }[];
}

/** The chat's own callouts are removed so a note never contains its own chat. */
export function noteForContext(content: string, chatId: string): string {
	return stripOwnCallouts(content, chatId).trim();
}

/** What a context item's hash is computed from. */
function hashInput(note: ContextNote, chatId: string): string {
	if (note.content === null) return '<excluded>';
	if (note.binary) return `<${note.binary.kind}:${note.binary.fingerprint}>`;
	return noteForContext(note.content, chatId);
}

export function prepareTurn(
	chatId: string,
	userText: string,
	notes: ContextNote[],
	sentHashes: Record<string, string>,
	hash: (s: string) => string,
	isFirstTurn: boolean,
): PreparedTurn {
	const nextHashes = { ...sentHashes };
	const blocks: string[] = [];
	const updatedNotes: string[] = [];
	const attach: PreparedTurn['attach'] = [];
	for (const note of notes) {
		const h = hash(hashInput(note, chatId));
		if (!isFirstTurn && sentHashes[note.path] === h) continue;
		nextHashes[note.path] = h;
		updatedNotes.push(note.path);
		const path = escapeAttr(note.path);
		const tag = isFirstTurn || !(note.path in sentHashes) ? 'note' : 'note-update';
		if (note.content === null) {
			blocks.push(`<${tag} path="${path}" excluded="true">The user excluded this note from chat context.</${tag}>`);
		} else if (note.binary) {
			// The file itself travels as an image or document block in the same message.
			blocks.push(`<attachment path="${path}" type="${note.binary.kind}" />`);
			attach.push({ path: note.path, kind: note.binary.kind });
		} else {
			blocks.push(`<${tag} path="${path}">\n${noteForContext(note.content, chatId)}\n</${tag}>`);
		}
	}
	let text = userText;
	if (blocks.length > 0) {
		const joined = blocks.join('\n\n');
		text = isFirstTurn ? `<obsidian-context>\n${joined}\n</obsidian-context>\n\n${userText}` : `${joined}\n\n${userText}`;
	}
	return { text, sentHashes: nextHashes, updatedNotes, attach };
}

/** Which context notes changed since they were last sent (for the "will be sent" hint). */
export function changedNotes(chatId: string, notes: ContextNote[], sentHashes: Record<string, string>, hash: (s: string) => string): string[] {
	return notes
		.filter((n) => n.path in sentHashes)
		.filter((n) => sentHashes[n.path] !== hash(hashInput(n, chatId)))
		.map((n) => n.path);
}

/** Replaces context blocks with a one-line marker, for display. */
export function collapseContext(text: string): string {
	return text
		.replace(/<obsidian-context>[\s\S]*?<\/obsidian-context>\s*/g, (block) => {
			const paths = [...block.matchAll(/<(?:note|attachment) path="([^"]+)"/g)].map((m) => m[1]);
			return paths.length ? `*Context: ${paths.join(', ')}*\n\n` : '';
		})
		.replace(/<note(?:-update)? path="([^"]+)"[^>]*>[\s\S]*?<\/note(?:-update)?>\s*/g, (_m, path: string) => `*Updated note: ${path}*\n\n`)
		.replace(/<attachment path="([^"]+)"[^>]*\/>\s*/g, (_m, path: string) => `*Attached: ${path}*\n\n`)
		.trim();
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

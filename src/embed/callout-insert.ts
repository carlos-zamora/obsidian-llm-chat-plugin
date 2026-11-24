/**
 * Where to put a new callout in the editor. Pure: no Obsidian imports.
 *
 * In Markdown, a line typed directly under a quote block continues the quote ("lazy continuation"),
 * so text the user writes after a callout would join it. A callout therefore always gets a blank
 * line before and after it, and the cursor goes to a line below that blank line.
 */

export interface Pos {
	line: number;
	ch: number;
}

export interface CalloutInsertPlan {
	text: string;
	from: Pos;
	to: Pos;
	cursor: Pos;
}

/** `lines` is the document split on '\n'; `cursorLine` is the line the cursor is on. */
export function planCalloutInsert(lines: string[], cursorLine: number, block: string): CalloutInsertPlan {
	const current = lines[cursorLine] ?? '';
	const prev = cursorLine > 0 ? (lines[cursorLine - 1] ?? '') : null;
	const next = cursorLine + 1 < lines.length ? (lines[cursorLine + 1] ?? '') : null;
	const lineAfterNextExists = cursorLine + 2 < lines.length;
	const isBlank = (s: string) => s.trim() === '';

	let from: Pos;
	let to: Pos;
	let lead: string;
	let blockStart: number;
	if (!isBlank(current)) {
		// Keep the current line; the callout goes below it, after a blank line.
		from = to = { line: cursorLine, ch: current.length };
		lead = '\n\n';
		blockStart = cursorLine + 2;
	} else {
		// Use the empty line; add a blank line above unless one is already there.
		from = { line: cursorLine, ch: 0 };
		to = { line: cursorLine, ch: current.length };
		lead = prev !== null && !isBlank(prev) ? '\n' : '';
		blockStart = cursorLine + (lead ? 1 : 0);
	}

	// Below the callout: one blank line, then a line to type on (an existing one, or a new empty one at the end).
	let trail: string;
	if (next === null) trail = '\n\n';
	else if (isBlank(next)) trail = lineAfterNextExists ? '' : '\n';
	else trail = '\n';

	const blockEnd = blockStart + block.split('\n').length - 1;
	return { text: lead + block + trail, from, to, cursor: { line: blockEnd + 2, ch: 0 } };
}

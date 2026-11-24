import { describe, expect, it } from 'vitest';
import { planCalloutInsert } from '../src/embed/callout-insert';

const BLOCK = '> [!llm-chat|c-x1]- New chat\n> [Open chat](obsidian://llm-chat?id=c-x1)';

/** Applies a plan to a document, the way Editor.replaceRange would. */
function apply(doc: string, cursorLine: number): { lines: string[]; cursorLine: number } {
	const lines = doc.split('\n');
	const plan = planCalloutInsert(lines, cursorLine, BLOCK);
	const offset = (p: { line: number; ch: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
	const out = doc.slice(0, offset(plan.from)) + plan.text + doc.slice(offset(plan.to));
	const outLines = out.split('\n');
	expect(plan.cursor.line).toBeLessThan(outLines.length);
	return { lines: outLines, cursorLine: plan.cursor.line };
}

/** The callout is separated by blank lines, and the cursor line is not directly under it. */
function expectSeparated(lines: string[], cursorLine: number) {
	const start = lines.findIndex((l) => l.startsWith('> [!llm-chat'));
	const end = start + 1;
	if (start > 0) expect(lines[start - 1]).toBe('');
	expect(lines[end + 1]).toBe('');
	expect(cursorLine).toBe(end + 2);
}

describe('planCalloutInsert', () => {
	it('at the end of a note, right after a paragraph (the reported case)', () => {
		const { lines, cursorLine } = apply("# Note\nLet's try it!\n", 2);
		expect(lines).toEqual(['# Note', "Let's try it!", '', ...BLOCK.split('\n'), '', '']);
		expectSeparated(lines, cursorLine);
		expect(lines[cursorLine]).toBe('');
	});

	it('on a line that has text: the callout goes below it', () => {
		const { lines, cursorLine } = apply("# Note\nLet's try it!", 1);
		expect(lines).toEqual(['# Note', "Let's try it!", '', ...BLOCK.split('\n'), '', '']);
		expectSeparated(lines, cursorLine);
	});

	it('in the middle of a note, before more text', () => {
		const { lines, cursorLine } = apply('Before\n\nAfter', 1);
		expect(lines).toEqual(['Before', '', ...BLOCK.split('\n'), '', 'After']);
		expectSeparated(lines, cursorLine);
		expect(lines[cursorLine]).toBe('After');
	});

	it('does not add extra blank lines when they are already there', () => {
		const { lines, cursorLine } = apply('Before\n\n\n\nAfter', 2);
		// The cursor's empty line becomes the callout; the blank lines around it are reused, not added.
		expect(lines).toEqual(['Before', '', ...BLOCK.split('\n'), '', 'After']);
		expectSeparated(lines, cursorLine);
	});

	it('in an empty note', () => {
		const { lines, cursorLine } = apply('', 0);
		expect(lines).toEqual([...BLOCK.split('\n'), '', '']);
		expectSeparated(lines, cursorLine);
	});

	it('right after another callout', () => {
		const { lines, cursorLine } = apply('> [!note] Hi\n> body\n', 2);
		expect(lines).toEqual(['> [!note] Hi', '> body', '', ...BLOCK.split('\n'), '', '']);
		expectSeparated(lines, cursorLine);
	});
});

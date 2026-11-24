import { describe, expect, it } from 'vitest';
import { changedNotes, collapseContext, prepareTurn } from '../src/core/context-builder';
import { toTurns, type RawSessionMessage } from '../src/core/transcript-format';

const hash = (s: string) => `h${s.length}:${s.slice(0, 8)}`;
const OWN = '> [!llm-chat|c-me]- Me\n> [Open chat](obsidian://llm-chat?id=c-me)';

describe('prepareTurn', () => {
	it('wraps notes in obsidian-context on the first turn and strips the own callout', () => {
		const t = prepareTurn('c-me', 'Hello', [{ path: 'A.md', content: `# A\n${OWN}\nbody` }], {}, hash, true);
		expect(t.text).toMatch(/^<obsidian-context>\n<note path="A.md">\n# A\nbody\n<\/note>\n<\/obsidian-context>\n\nHello$/);
		expect(t.updatedNotes).toEqual(['A.md']);
		expect(Object.keys(t.sentHashes)).toEqual(['A.md']);
	});

	it('sends nothing extra when notes are unchanged', () => {
		const first = prepareTurn('c-me', 'Hi', [{ path: 'A.md', content: 'x' }], {}, hash, true);
		const second = prepareTurn('c-me', 'Again', [{ path: 'A.md', content: 'x' }], first.sentHashes, hash, false);
		expect(second.text).toBe('Again');
		expect(second.updatedNotes).toEqual([]);
	});

	it('sends a note-update when a note changed, ignoring changes to the own callout', () => {
		const first = prepareTurn('c-me', 'Hi', [{ path: 'A.md', content: `x\n${OWN}` }], {}, hash, true);
		const onlyCallout = prepareTurn('c-me', 'Q', [{ path: 'A.md', content: `x\n${OWN.replace('Me', 'Renamed')}` }], first.sentHashes, hash, false);
		expect(onlyCallout.text).toBe('Q');
		const edited = prepareTurn('c-me', 'Q', [{ path: 'A.md', content: 'x and more' }], first.sentHashes, hash, false);
		expect(edited.text).toBe('<note-update path="A.md">\nx and more\n</note-update>\n\nQ');
	});

	it('sends a newly added note as a plain note block', () => {
		const t = prepareTurn('c-me', 'Q', [{ path: 'B.md', content: 'b' }], { 'A.md': 'h' }, hash, false);
		expect(t.text).toBe('<note path="B.md">\nb\n</note>\n\nQ');
	});

	it('marks excluded notes without their content', () => {
		const t = prepareTurn('c-me', 'Q', [{ path: 'Secret.md', content: null }], {}, hash, true);
		expect(t.text).toContain('excluded="true"');
	});

	it('changedNotes lists only previously sent notes that changed', () => {
		const sent = prepareTurn('c-me', 'Hi', [{ path: 'A.md', content: 'x' }], {}, hash, true).sentHashes;
		expect(changedNotes('c-me', [{ path: 'A.md', content: 'y' }, { path: 'B.md', content: 'z' }], sent, hash)).toEqual(['A.md']);
	});
});

describe('attachments', () => {
	const pdf = (fingerprint: string) => ({ path: 'Papers/Study.pdf', content: '', binary: { kind: 'pdf' as const, fingerprint } });

	it('attaches images and PDFs instead of inlining them', () => {
		const t = prepareTurn('c-me', 'Read this', [{ path: 'A.md', content: 'a' }, pdf('1:100')], {}, hash, true);
		expect(t.text).toContain('<attachment path="Papers/Study.pdf" type="pdf" />');
		expect(t.text).not.toContain('<note path="Papers/Study.pdf"');
		expect(t.attach).toEqual([{ path: 'Papers/Study.pdf', kind: 'pdf' }]);
	});

	it('re-attaches a file only when its fingerprint changes', () => {
		const first = prepareTurn('c-me', 'Q', [pdf('1:100')], {}, hash, true);
		const same = prepareTurn('c-me', 'Q', [pdf('1:100')], first.sentHashes, hash, false);
		expect(same.attach).toEqual([]);
		expect(same.text).toBe('Q');
		expect(changedNotes('c-me', [pdf('2:120')], first.sentHashes, hash)).toEqual(['Papers/Study.pdf']);
		expect(prepareTurn('c-me', 'Q', [pdf('2:120')], first.sentHashes, hash, false).attach).toHaveLength(1);
	});

	it('does not attach an excluded file', () => {
		const t = prepareTurn('c-me', 'Q', [{ path: 'Private/Scan.png', content: null }], {}, hash, true);
		expect(t.attach).toEqual([]);
		expect(t.text).toContain('excluded="true"');
	});
});

describe('collapseContext', () => {
	it('replaces context blocks with markers', () => {
		const t = prepareTurn('c-me', 'Hello', [{ path: 'A.md', content: 'body' }], {}, hash, true);
		expect(collapseContext(t.text)).toBe('*Context: A.md*\n\nHello');
		expect(collapseContext('<note-update path="A.md">\nnew\n</note-update>\n\nQ')).toBe('*Updated note: A.md*\n\nQ');
	});

	it('lists attachments in the context marker and shows later ones on their own', () => {
		const t = prepareTurn('c-me', 'Hi', [{ path: 'A.md', content: 'a' }, { path: 'B.png', content: '', binary: { kind: 'image', fingerprint: '1' } }], {}, hash, true);
		expect(collapseContext(t.text)).toBe('*Context: A.md, B.png*\n\nHi');
		expect(collapseContext('<attachment path="B.png" type="image" />\n\nQ')).toBe('*Attached: B.png*\n\nQ');
	});
});

describe('toTurns', () => {
	const msg = (type: RawSessionMessage['type'], uuid: string, content: unknown, parent: string | null = null): RawSessionMessage => ({
		type,
		uuid,
		message: { content },
		parent_tool_use_id: parent,
	});

	it('groups assistant blocks and tool results into one turn', () => {
		const turns = toTurns([
			msg('user', 'u1', 'Question'),
			msg('assistant', 'a1', [{ type: 'tool_use', name: 'mcp__vault__read_note', input: { note: 'A' } }]),
			msg('user', 'u2', [{ type: 'tool_result', content: 'x' }]),
			msg('assistant', 'a2', [{ type: 'text', text: 'Answer' }]),
			msg('assistant', 'sub', [{ type: 'text', text: 'subagent' }], 'tool-1'),
			msg('user', 'u3', [{ type: 'text', text: 'Follow-up' }]),
			msg('assistant', 'a3', [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Reply' }]),
		]);
		expect(turns.map((t) => [t.alias, t.role, t.uuid, t.text, t.tools.length])).toEqual([
			['m1', 'user', 'u1', 'Question', 0],
			['m2', 'assistant', 'a1', 'Answer', 1],
			['m3', 'user', 'u3', 'Follow-up', 0],
			['m4', 'assistant', 'a3', 'Reply', 0],
		]);
	});
});

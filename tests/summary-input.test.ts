import { describe, expect, it } from 'vitest';
import { conversationForSummary, shortChatSummary, stripNoteContext } from '../src/core/summary-input';
import type { Turn } from '../src/types';

const turn = (role: Turn['role'], text: string, alias = 'm1'): Turn => ({ alias, role, uuid: alias, text, tools: [] });

const NOTE_BLOCK =
	'<obsidian-context>\n<note path="Test.md">\nThe LLM Chat Plugin now works and I want to try it.\n</note>\n</obsidian-context>\n\n';
const HAIKU = 'Salt breeze off the sea,\nsoft sun on the Gothic stone,\nrain on Eixample.';

describe('stripNoteContext', () => {
	it('removes the first-turn context block', () => {
		expect(stripNoteContext(`${NOTE_BLOCK}Write a haiku about Barcelona weather for me`)).toBe('Write a haiku about Barcelona weather for me');
	});

	it('removes note-update and plain note blocks, including excluded ones', () => {
		const text = '<note-update path="A.md">\nnew body\n</note-update>\n\n<note path="B.md" excluded="true">x</note>\n\nAnd now?';
		expect(stripNoteContext(text)).toBe('And now?');
	});
});

describe('conversationForSummary', () => {
	it('contains the chat and none of the note', () => {
		const out = conversationForSummary([turn('user', `${NOTE_BLOCK}Write a haiku`), turn('assistant', HAIKU, 'm2')]);
		expect(out).toBe(`User: Write a haiku\n\nAssistant: ${HAIKU}`);
		expect(out).not.toContain('Plugin now works');
	});

	it('keeps the newest messages when too long', () => {
		const turns = [turn('user', 'first '.repeat(50)), turn('assistant', 'last reply', 'm2')];
		const out = conversationForSummary(turns, 40);
		expect(out.startsWith('[Earlier messages omitted]')).toBe(true);
		expect(out.endsWith('last reply')).toBe(true);
	});
});

describe('shortChatSummary', () => {
	it('uses a short single reply as-is', () => {
		expect(shortChatSummary([turn('user', `${NOTE_BLOCK}Write a haiku`), turn('assistant', HAIKU, 'm2')])).toBe(HAIKU);
	});

	it('needs a real summary for long replies or several exchanges', () => {
		expect(shortChatSummary([turn('user', 'q'), turn('assistant', 'x'.repeat(401), 'm2')])).toBeNull();
		expect(shortChatSummary([turn('user', 'q'), turn('assistant', 'a', 'm2'), turn('user', 'q2', 'm3'), turn('assistant', 'b', 'm4')])).toBeNull();
		expect(shortChatSummary([turn('user', 'q')])).toBeNull();
	});
});

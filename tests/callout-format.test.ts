import { describe, expect, it } from 'vitest';
import {
	containsChatCallout,
	findCallouts,
	replaceChatCallouts,
	serializeChatCallout,
	stripOwnCallouts,
} from '../src/embed/callout-format';

const NOTE = [
	'# Sleep',
	'',
	'> [!llm-chat|c-abc123]- Choosing a sleep tracker',
	'> Chose Oura.',
	'>',
	'> [Open chat](obsidian://llm-chat?id=c-abc123) · 12 messages',
	'',
	'Some text.',
	'> [!llm-response|c-abc123#m7]- Choosing › Battery',
	'> Oura lasts longer.',
	'',
	'> [!llm-chat|c-other1]+ Other chat',
	'> [Open chat](obsidian://llm-chat?id=c-other1)',
].join('\n');

describe('serializeChatCallout', () => {
	it('renders title, summary and link', () => {
		const out = serializeChatCallout({ chatId: 'c-x1', title: 'T', summary: 'Line one\nLine two', messageCount: 2, fold: '-' });
		expect(out).toBe(
			['> [!llm-chat|c-x1]- T', '> Line one', '> Line two', '>', '> [Open chat](obsidian://llm-chat?id=c-x1) · 2 messages'].join('\n'),
		);
	});

	it('uses the default title and omits an empty summary', () => {
		const out = serializeChatCallout({ chatId: 'c-x1', title: null, summary: null, messageCount: 0, fold: '-' });
		expect(out).toBe('> [!llm-chat|c-x1]- New chat\n> [Open chat](obsidian://llm-chat?id=c-x1)');
	});

	it('round-trips through findCallouts', () => {
		const out = serializeChatCallout({ chatId: 'c-x1', title: 'Hello', summary: 'S', messageCount: 1, fold: '+' });
		const [c] = findCallouts(out);
		expect(c).toMatchObject({ kind: 'chat', chatId: 'c-x1', fold: '+', title: 'Hello', startLine: 0, endLine: 3 });
	});
});

describe('findCallouts', () => {
	it('finds chat and response embeds with their extents', () => {
		const found = findCallouts(NOTE);
		expect(found.map((c) => [c.kind, c.chatId, c.messageAlias, c.startLine, c.endLine])).toEqual([
			['chat', 'c-abc123', null, 2, 5],
			['response', 'c-abc123', 'm7', 8, 9],
			['chat', 'c-other1', null, 11, 12],
		]);
	});

	it('ignores ordinary callouts', () => {
		expect(findCallouts('> [!note] Hi\n> body')).toEqual([]);
	});
});

describe('replaceChatCallouts', () => {
	it('replaces only the matching chat callout and keeps the rest', () => {
		const out = replaceChatCallouts(NOTE, 'c-abc123', (c) =>
			serializeChatCallout({ chatId: 'c-abc123', title: 'New title', summary: 'New summary', messageCount: 14, fold: c.fold }),
		);
		expect(out).toContain('> [!llm-chat|c-abc123]- New title\n> New summary');
		expect(out).toContain('· 14 messages');
		expect(out).not.toContain('Chose Oura.');
		expect(out).toContain('> [!llm-response|c-abc123#m7]');
		expect(out).toContain('> [!llm-chat|c-other1]+ Other chat');
	});

	it('returns the same text when nothing matches', () => {
		expect(replaceChatCallouts(NOTE, 'c-missing', () => 'x')).toBe(NOTE);
	});

	it('preserves CRLF line endings', () => {
		const crlf = NOTE.split('\n').join('\r\n');
		const out = replaceChatCallouts(crlf, 'c-other1', () => '> [!llm-chat|c-other1]- X\n> body');
		expect(out).toContain('> [!llm-chat|c-other1]- X\r\n> body');
		expect(out.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r'))).toBe(true);
	});
});

describe('stripOwnCallouts', () => {
	it('removes chat and response embeds of the chat only', () => {
		const out = stripOwnCallouts(NOTE, 'c-abc123');
		expect(out).not.toContain('c-abc123');
		expect(out).toContain('c-other1');
		expect(out).toContain('Some text.');
	});

	it('containsChatCallout detects presence', () => {
		expect(containsChatCallout(NOTE, 'c-other1')).toBe(true);
		expect(containsChatCallout(NOTE, 'c-nope')).toBe(false);
	});
});

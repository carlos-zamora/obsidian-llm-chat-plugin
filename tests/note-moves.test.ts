import { describe, expect, it } from 'vitest';
import { planDelete, planRename } from '../src/core/note-moves';
import { chatFolderFor, encodeProjectDir, parentFolder } from '../src/utils/paths';
import { compareVersions, parseVersion } from '../src/utils/version';

const chat = { homeNote: 'Health/Sleep.md', hostNotes: ['Health/Sleep.md', 'Daily/2026-11-24.md'], extraContextNotes: ['Health/Oura.md'] };

describe('planRename', () => {
	it('renames the home note in place', () => {
		const p = planRename(chat, 'Health/Sleep.md', 'Health/Sleep notes.md');
		expect(p).toMatchObject({ changed: true, homeMoved: true, homeNote: 'Health/Sleep notes.md' });
		expect(p.hostNotes).toEqual(['Health/Sleep notes.md', 'Daily/2026-11-24.md']);
		expect(parentFolder(p.homeNote)).toBe(parentFolder(chat.homeNote));
	});

	it('moves the home note to another folder', () => {
		const p = planRename(chat, 'Health/Sleep.md', 'Archive/Sleep.md');
		expect(p.homeMoved).toBe(true);
		expect(chatFolderFor(p.homeNote, '.chat-data')).toBe('Archive/.chat-data');
	});

	it('updates only hostNotes for an embedding note', () => {
		const p = planRename(chat, 'Daily/2026-11-24.md', 'Daily/Tue.md');
		expect(p).toMatchObject({ changed: true, homeMoved: false, homeNote: 'Health/Sleep.md' });
		expect(p.hostNotes).toEqual(['Health/Sleep.md', 'Daily/Tue.md']);
	});

	it('updates extra context notes', () => {
		expect(planRename(chat, 'Health/Oura.md', 'Health/Ring.md').extraContextNotes).toEqual(['Health/Ring.md']);
	});

	it('ignores unrelated notes', () => {
		expect(planRename(chat, 'Other.md', 'Else.md').changed).toBe(false);
	});
});

describe('planDelete', () => {
	it('orphans the chat when the home note is deleted, keeping data', () => {
		const p = planDelete(chat, 'Health/Sleep.md');
		expect(p).toMatchObject({ changed: true, orphaned: true, hostNotes: ['Daily/2026-11-24.md'] });
	});

	it('removes an embedding note', () => {
		expect(planDelete(chat, 'Daily/2026-11-24.md')).toMatchObject({ orphaned: false, hostNotes: ['Health/Sleep.md'] });
	});
});

describe('paths and versions', () => {
	it('puts root notes in a root chat folder', () => {
		expect(chatFolderFor('Inbox.md', '.chat-data')).toBe('.chat-data');
	});

	it('encodes project dirs like Claude Code', () => {
		expect(encodeProjectDir('C:\\Users\\carlo\\OneDrive\\Personal Health\\.obsidian')).toBe('C--Users-carlo-OneDrive-Personal-Health--obsidian');
	});

	it('compares versions', () => {
		expect(parseVersion('2.1.331 (Claude Code)')).toBe('2.1.331');
		expect(compareVersions('2.1.331', '2.1.223')).toBe(1);
		expect(compareVersions('2.1.99', '2.1.223')).toBe(-1);
		expect(compareVersions('2.1.223', '2.1.223')).toBe(0);
	});
});

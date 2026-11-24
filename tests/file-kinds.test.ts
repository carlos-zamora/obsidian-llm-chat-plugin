import { describe, expect, it } from 'vitest';
import { stripNoteContext } from '../src/core/summary-input';
import { contextFileProblem, contextKind, extensionOf, mediaType } from '../src/utils/file-kinds';

describe('file kinds', () => {
	it('classifies notes, text files, images and PDFs', () => {
		expect(contextKind('md')).toBe('text');
		expect(contextKind('CSV')).toBe('text');
		expect(contextKind('canvas')).toBe('text');
		expect(contextKind('jpeg')).toBe('image');
		expect(contextKind('pdf')).toBe('pdf');
		expect(contextKind('mp3')).toBeNull();
		expect(contextKind('docx')).toBeNull();
	});

	it('gives media types for attachments', () => {
		expect(mediaType('JPG')).toBe('image/jpeg');
		expect(mediaType('pdf')).toBe('application/pdf');
	});

	it('reads extensions', () => {
		expect(extensionOf('Scan.final.PNG')).toBe('png');
		expect(extensionOf('.hidden')).toBe('');
		expect(extensionOf('README')).toBe('');
	});

	it('explains files that cannot be added', () => {
		expect(contextFileProblem('notes.md', 10)).toBeNull();
		expect(contextFileProblem('song.mp3', 10)).toMatch(/can't be added/);
		expect(contextFileProblem('photo.png', 6 * 1024 * 1024)).toMatch(/too large.*6\.0 MB.*5\.0 MB/);
		expect(contextFileProblem('paper.pdf', 6 * 1024 * 1024)).toBeNull();
	});
});

describe('summary input', () => {
	it('leaves attachment markers out of what the summary model sees', () => {
		expect(stripNoteContext('<attachment path="B.png" type="image" />\n\nWhat is this?')).toBe('What is this?');
	});
});

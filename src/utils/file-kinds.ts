/** Which files can go into a chat's context, and how they travel. Pure: no Obsidian imports. */

export type ContextKind = 'text' | 'image' | 'pdf';

const TEXT_EXTENSIONS = new Set([
	'md', 'txt', 'csv', 'tsv', 'json', 'canvas', 'base', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm',
	'css', 'js', 'ts', 'py', 'sh', 'sql', 'log', 'tex', 'bib', 'org', 'rst',
]);

const IMAGE_MEDIA_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

/** Largest file sent as-is. Images and PDFs are base64-encoded into the message, which adds a third. */
export const MAX_CONTEXT_BYTES: Record<ContextKind, number> = {
	text: 1024 * 1024,
	image: 5 * 1024 * 1024,
	pdf: 20 * 1024 * 1024,
};

export const SUPPORTED_FILES = 'notes, text files, PDFs and images (PNG, JPEG, GIF or WebP)';

export function contextKind(extension: string): ContextKind | null {
	const ext = extension.toLowerCase();
	if (TEXT_EXTENSIONS.has(ext)) return 'text';
	if (ext in IMAGE_MEDIA_TYPES) return 'image';
	if (ext === 'pdf') return 'pdf';
	return null;
}

export function mediaType(extension: string): string {
	const ext = extension.toLowerCase();
	return IMAGE_MEDIA_TYPES[ext] ?? (ext === 'pdf' ? 'application/pdf' : 'text/plain');
}

export function extensionOf(name: string): string {
	const i = name.lastIndexOf('.');
	return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Why a file can't be added to the context, or null when it can. */
export function contextFileProblem(name: string, sizeBytes: number): string | null {
	const kind = contextKind(extensionOf(name));
	if (!kind) return `${name} can't be added. Claude can read ${SUPPORTED_FILES}.`;
	const max = MAX_CONTEXT_BYTES[kind];
	if (sizeBytes > max) return `${name} is too large to add (${formatSize(sizeBytes)}; the limit for this kind of file is ${formatSize(max)}).`;
	return null;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

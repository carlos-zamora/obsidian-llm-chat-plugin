import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { VaultAccess } from './vault-access';

export const VAULT_SERVER = 'vault';
export const READ_ONLY_TOOLS = ['read_note', 'search_notes', 'get_links'].map((t) => `mcp__${VAULT_SERVER}__${t}`);

const MAX_NOTE_CHARS = 60000;

function text(t: string, isError = false) {
	return { content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) };
}

/**
 * In-process MCP server with the agent's only file access. Built per query, because
 * an SDK server instance is bound to one connection.
 */
export function createVaultServer(vault: VaultAccess, sourcePath: () => string) {
	const notFound = (ref: string) => text(`No readable note found for "${ref}". It may not exist or may be excluded.`, true);

	return createSdkMcpServer({
		name: VAULT_SERVER,
		version: '0.1.0',
		instructions: 'Tools for reading the user\'s Obsidian notes. Paths are vault-relative, for example "Health/Sleep.md". Wikilinks such as [[Sleep]] also work.',
		tools: [
			tool(
				'read_note',
				'Read one note from the Obsidian vault, including its frontmatter. Accepts a vault path or a wikilink.',
				{ note: z.string().describe('Vault path ("Health/Sleep.md") or wikilink ("[[Sleep]]")') },
				async ({ note }) => {
					const file = vault.resolve(note, sourcePath());
					if (!file || vault.isExcluded(file)) return notFound(note);
					let content = await vault.read(file);
					if (content.length > MAX_NOTE_CHARS) {
						content = `${content.slice(0, MAX_NOTE_CHARS)}\n\n[Truncated: the note is ${content.length} characters long.]`;
					}
					return text(`<note path="${file.path}">\n${content}\n</note>`);
				},
				{ annotations: { readOnlyHint: true } },
			),
			tool(
				'search_notes',
				'Search the vault for notes containing text (case-insensitive) and/or carrying a tag. Returns paths and short snippets, most recently modified first.',
				{
					text: z.string().describe('Text to look for in note titles and bodies. May be empty when searching by tag.'),
					tag: z.string().optional().describe('Optional tag filter, for example "#sleep"'),
					limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 20)'),
				},
				async ({ text: needle, tag, limit }) => {
					const hits = await vault.search(needle, tag, limit ?? 20);
					if (hits.length === 0) return text('No matching notes.');
					return text(hits.map((h) => (h.snippet ? `- ${h.path}: ${h.snippet}` : `- ${h.path}`)).join('\n'));
				},
				{ annotations: { readOnlyHint: true } },
			),
			tool(
				'get_links',
				'List the outgoing links and backlinks of a note.',
				{ note: z.string().describe('Vault path or wikilink') },
				async ({ note }) => {
					const file = vault.resolve(note, sourcePath());
					if (!file || vault.isExcluded(file)) return notFound(note);
					const { outgoing, backlinks } = vault.links(file);
					const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '(none)');
					return text(`Outgoing links from ${file.path}:\n${list(outgoing)}\n\nBacklinks:\n${list(backlinks)}`);
				},
				{ annotations: { readOnlyHint: true } },
			),
		],
	});
}

/** Compact label for tool activity in the panel (§5.2). */
export function describeTool(name: string, input: Record<string, unknown>): string {
	const short = name.replace(`mcp__${VAULT_SERVER}__`, '');
	const arg = (k: string) => {
		const v = input[k];
		return typeof v === 'string' ? v : '';
	};
	switch (short) {
		case 'read_note':
			return `Read "${arg('note').replace(/^\[\[|\]\]$/g, '').replace(/\.md$/, '')}"`;
		case 'search_notes':
			return `Searched notes for "${arg('text') || arg('tag')}"`;
		case 'get_links':
			return `Listed links of "${arg('note').replace(/^\[\[|\]\]$/g, '').replace(/\.md$/, '')}"`;
		case 'StructuredOutput':
			return 'Prepared structured output';
		default:
			return `Used ${short}`;
	}
}

import type { ToolActivity, Turn } from '../types';
import { collapseContext } from './context-builder';

/**
 * Turns SDK session messages into visible turns and a readable transcript.
 * Pure: takes the `getSessionMessages` result shape without importing the SDK.
 */

export interface RawSessionMessage {
	type: 'user' | 'assistant' | 'system';
	uuid: string;
	message: unknown;
	parent_tool_use_id: string | null;
}

interface Block {
	type?: string;
	text?: string;
	name?: string;
	input?: unknown;
}

function blocksOf(message: unknown): Block[] {
	const content = (message as { content?: unknown } | null)?.content;
	if (typeof content === 'string') return [{ type: 'text', text: content }];
	return Array.isArray(content) ? (content as Block[]) : [];
}

export function toTurns(messages: RawSessionMessage[]): Turn[] {
	const turns: Turn[] = [];
	let current: Turn | null = null;
	const push = (t: Turn) => {
		turns.push(t);
		t.alias = `m${turns.length}`;
	};
	for (const m of messages) {
		if (m.parent_tool_use_id !== null || m.type === 'system') continue;
		const blocks = blocksOf(m.message);
		if (m.type === 'user') {
			const text = blocks
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text!)
				.join('\n')
				.trim();
			// Tool results come back as user messages; they belong to the assistant turn.
			if (!text) continue;
			current = null;
			push({ alias: '', role: 'user', uuid: m.uuid, text, tools: [] });
			continue;
		}
		if (!current || current.role !== 'assistant') {
			current = { alias: '', role: 'assistant', uuid: m.uuid, text: '', tools: [] };
			push(current);
		}
		for (const b of blocks) {
			if (b.type === 'text' && b.text) current.text = current.text ? `${current.text}\n\n${b.text}` : b.text;
			else if (b.type === 'tool_use' && b.name) {
				current.tools.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
			}
		}
	}
	return turns.filter((t) => t.role === 'user' || t.text || t.tools.length > 0);
}

export function renderTranscript(
	chatId: string,
	title: string,
	turns: Turn[],
	describe: (tool: ToolActivity) => string,
): string {
	const out = [
		`# ${title}`,
		'',
		`<!-- LLM Sessions transcript for ${chatId}. Generated from the Claude Code session; editing this file stops automatic updates. -->`,
		'',
	];
	for (const t of turns) {
		out.push(`## ${t.alias} · ${t.role === 'user' ? 'You' : 'Claude'}`, '');
		if (t.tools.length > 0) {
			out.push(...t.tools.map((tool) => `*${describe(tool)}*`), '');
		}
		const body = t.role === 'user' ? collapseContext(t.text) : t.text;
		if (body) out.push(body, '');
	}
	return out.join('\n');
}

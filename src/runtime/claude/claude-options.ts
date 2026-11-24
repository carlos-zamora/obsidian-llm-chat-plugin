import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk';
import type { LlmSessionsSettings } from '../../settings/settings';
import type { ChatRecord, Effort } from '../../types';
import { READ_ONLY_TOOLS, VAULT_SERVER } from '../../tools/vault-mcp-server';
import { baseOptions } from './claude-env';

const SYSTEM_PROMPT = `You are chatting inside the user's personal notes in Obsidian. Their notes record their thinking, plans and decisions, so treat what the notes say as the user's own considered position unless they tell you otherwise.

Context:
- The first user message carries an <obsidian-context> block with the note (or notes) this chat lives in. Later messages may start with <note-update path="…"> blocks: the user edited that note, and the block holds its full new content. Prefer the newest version.
- Chat callouts (lines starting with "> [!llm-chat|…]") are summaries of other conversations the user had. Use them as background.

Tools:
- read_note reads any note by vault path or wikilink. Use it when the user refers to another note, or when a link in the current note is clearly relevant. Do not read notes speculatively.
- search_notes finds notes by text or tag. get_links lists a note's links and backlinks.
- You CANNOT edit notes. If the user asks for a change, write the text they can paste.

Style:
- Answer in Markdown that renders well in Obsidian. Use [[wikilinks]] when you mention a note by name.
- Be direct and concise. Refer to what the user already decided instead of re-deciding it.`;

export function systemPrompt(settings: LlmSessionsSettings): string {
	const custom = settings.customInstructions.trim();
	return custom ? `${SYSTEM_PROMPT}\n\nThe user's instructions:\n${custom}` : SYSTEM_PROMPT;
}

export function effectiveModel(chat: ChatRecord, settings: LlmSessionsSettings): { model: string; effort: Effort } {
	return { model: chat.model ?? settings.defaultModel, effort: chat.effort ?? settings.defaultEffort };
}

/** Any tool outside the read-only vault tools is refused (note editing arrives in Phase 3). */
const denyOthers: CanUseTool = async (toolName) => ({
	behavior: 'deny',
	message: `The tool ${toolName} is not available in Obsidian chats.`,
});

export interface ChatOptionsInput {
	settings: LlmSessionsSettings;
	chat: ChatRecord;
	apiKey: string | null;
	cwd: string;
	vaultServer: NonNullable<Options['mcpServers']>[string];
	abortController: AbortController;
	stderr?: (data: string) => void;
}

/** Options for a chat's streaming query (docs/ARCHITECTURE.md §7). */
export function buildChatOptions(input: ChatOptionsInput): Options {
	const { settings, chat } = input;
	const { model, effort } = effectiveModel(chat, settings);
	return {
		...baseOptions(settings, input.apiKey, input.cwd),
		resume: chat.sessionId ?? undefined,
		systemPrompt: systemPrompt(settings),
		tools: [],
		mcpServers: { [VAULT_SERVER]: input.vaultServer },
		allowedTools: READ_ONLY_TOOLS,
		canUseTool: denyOthers,
		includePartialMessages: true,
		model,
		effort,
		maxTurns: settings.maxTurns,
		maxBudgetUsd: settings.billing === 'api-key' && settings.maxBudgetUsd > 0 ? settings.maxBudgetUsd : undefined,
		abortController: input.abortController,
		stderr: input.stderr,
	};
}

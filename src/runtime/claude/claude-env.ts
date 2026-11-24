import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { LlmSessionsSettings } from '../../settings/settings';

export const CLIENT_APP = 'llm-sessions/0.1.0';

/**
 * Environment for the Claude Code subprocess. The SDK replaces the environment
 * entirely when `env` is set, so start from process.env.
 *
 * Subscription mode removes API credentials: a key set system-wide would
 * otherwise silently take precedence over the user's Claude Code sign-in.
 */
export function buildEnv(settings: LlmSessionsSettings, apiKey: string | null): NonNullable<Options['env']> {
	const env: NonNullable<Options['env']> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP };
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	if (settings.billing === 'api-key' && apiKey) env.ANTHROPIC_API_KEY = apiKey;
	return env;
}

/**
 * Options every query shares: the user's own binary, no filesystem settings
 * (keeps coding hooks, MCP servers and CLAUDE.md out), and no claude.ai
 * connectors (Phase 0 spike: without this, connectors such as Gmail attach
 * from the second turn on).
 */
export function baseOptions(settings: LlmSessionsSettings, apiKey: string | null, cwd: string): Options {
	return {
		pathToClaudeCodeExecutable: settings.claudePath,
		cwd,
		env: buildEnv(settings, apiKey),
		settingSources: settings.loadProjectSettings ? ['project'] : [],
		strictMcpConfig: true,
		settings: { disableClaudeAiConnectors: true },
		mcpServersDelivery: 'argv',
		permissionMode: 'default',
		verbatimPrompts: true,
	};
}

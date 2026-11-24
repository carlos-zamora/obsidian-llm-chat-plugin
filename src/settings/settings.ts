import type { Effort } from '../types';

export type BillingMode = 'subscription' | 'api-key';

export interface LlmSessionsSettings {
	onboardingComplete: boolean;
	// Connection
	claudePath: string;
	billing: BillingMode;
	/** SecretStorage ID of the Anthropic API key (API-key mode only). */
	apiKeySecretId: string;
	// Model
	defaultModel: string;
	defaultEffort: Effort;
	summaryModel: string;
	customInstructions: string;
	// Agent
	loadProjectSettings: boolean;
	maxTurns: number;
	maxBudgetUsd: number;
	// Context
	excludedFolders: string[];
	excludedTags: string[];
	optOutKey: string;
	// Chats
	chatFolderName: string;
	mirrorSessions: boolean;
	summaryIdleMinutes: number;
	// Embeds
	embedsCollapsed: boolean;
}

export const DEFAULT_SETTINGS: LlmSessionsSettings = {
	onboardingComplete: false,
	claudePath: '',
	billing: 'subscription',
	apiKeySecretId: '',
	defaultModel: 'sonnet',
	defaultEffort: 'medium',
	summaryModel: 'haiku',
	customInstructions: '',
	loadProjectSettings: false,
	maxTurns: 15,
	maxBudgetUsd: 0.5,
	excludedFolders: [],
	excludedTags: [],
	optOutKey: 'llm-context',
	chatFolderName: '.chat-data',
	mirrorSessions: true,
	summaryIdleMinutes: 2,
	embedsCollapsed: true,
};

export const SETTINGS_VERSION = 1;

/** Everything the plugin keeps in data.json. Never holds credentials or note content. */
export interface PluginData {
	version: number;
	settings: LlmSessionsSettings;
	/** chatId → vault path of its record. A cache; rebuilt from disk when stale. */
	index: Record<string, string>;
	lastChatId: string | null;
}

export function migrateData(raw: unknown): PluginData {
	const data = (raw ?? {}) as Partial<PluginData>;
	return {
		version: SETTINGS_VERSION,
		settings: Object.assign({}, DEFAULT_SETTINGS, data.settings ?? {}),
		index: data.index ?? {},
		lastChatId: data.lastChatId ?? null,
	};
}

export const MODEL_CHOICES: { value: string; label: string }[] = [
	{ value: 'sonnet', label: 'Sonnet (latest)' },
	{ value: 'opus', label: 'Opus (latest)' },
	{ value: 'haiku', label: 'Haiku (latest)' },
	{ value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (pinned)' },
	{ value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (pinned)' },
	{ value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (pinned)' },
];

export const EFFORT_CHOICES: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function modelLabel(model: string): string {
	return MODEL_CHOICES.find((m) => m.value === model)?.label.replace(/ \(.*\)$/, '') ?? model;
}

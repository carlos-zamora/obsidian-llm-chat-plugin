import { TFile, type App } from 'obsidian';
import type { ChatRecord } from '../types';
import { replaceChatCallouts, serializeChatCallout } from './callout-format';

/**
 * Rewrites a chat's callouts in every note that embeds it. Only callouts whose metadata
 * names this chat are touched, and each keeps its own fold state.
 */
export async function updateEmbeds(app: App, record: ChatRecord): Promise<void> {
	for (const path of record.hostNotes) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;
		await app.vault.process(file, (text) =>
			replaceChatCallouts(text, record.id, (existing) =>
				serializeChatCallout({
					chatId: record.id,
					title: record.title,
					summary: record.summary,
					messageCount: record.messageCount,
					fold: existing.fold,
				}),
			),
		);
	}
}

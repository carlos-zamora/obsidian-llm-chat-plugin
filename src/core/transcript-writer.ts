import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { ChatRecord, Turn } from '../types';
import { DEFAULT_TITLE } from '../embed/callout-format';
import { describeTool } from '../tools/vault-mcp-server';
import { hashText } from '../utils/hash';
import type { ChatStore } from './chat-store';
import { renderTranscript, toTurns, type RawSessionMessage } from './transcript-format';

export type TranscriptWriteResult = 'written' | 'diverged' | 'frozen' | 'empty';

/**
 * Regenerates the readable transcript from the session (never parses the session file).
 * A transcript the user edited is not overwritten; the caller offers Regenerate or Keep my edits.
 */
export class TranscriptWriter {
	constructor(private store: ChatStore) {}

	async turns(record: ChatRecord): Promise<Turn[]> {
		if (!record.sessionId) return [];
		const messages = (await getSessionMessages(record.sessionId)) as RawSessionMessage[];
		return toTurns(messages);
	}

	/** Updates aliases and message count, then writes the transcript unless the user edited it. */
	async update(record: ChatRecord, force = false): Promise<{ result: TranscriptWriteResult; turns: Turn[] }> {
		const turns = await this.turns(record);
		if (turns.length === 0) return { result: 'empty', turns };
		record.messageCount = turns.length;
		record.messageAliases = Object.fromEntries(turns.map((t) => [t.alias, t.uuid]));
		if (record.transcriptMode === 'frozen' && !force) return { result: 'frozen', turns };

		const existing = await this.store.readTranscript(record);
		if (!force && existing !== null && record.transcriptHash && hashText(existing) !== record.transcriptHash) {
			return { result: 'diverged', turns };
		}
		const markdown = renderTranscript(record.id, record.title ?? DEFAULT_TITLE, turns, (t) => describeTool(t.name, t.input));
		await this.store.writeTranscript(record, markdown);
		record.transcriptHash = hashText(markdown);
		if (force) record.transcriptMode = 'auto';
		return { result: 'written', turns };
	}
}

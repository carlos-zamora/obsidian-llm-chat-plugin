import { Notice, type ObsidianProtocolData, type Plugin } from 'obsidian';
import { isChatId } from '../utils/ids';

/** Handles `obsidian://llm-chat?id=c-…&message=m7`: opens the chat panel at that message. */
export function registerProtocolHandler(plugin: Plugin, open: (chatId: string, message: string | null) => void): void {
	plugin.registerObsidianProtocolHandler('llm-chat', (params: ObsidianProtocolData) => {
		const id = params.id;
		if (!id || !isChatId(id)) {
			new Notice('This chat link is not valid.');
			return;
		}
		const message = params.message && /^m\d+$/.test(params.message) ? params.message : null;
		open(id, message);
	});
}

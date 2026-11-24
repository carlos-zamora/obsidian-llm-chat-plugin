import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { App } from 'obsidian';
import type { ChatRecord } from '../../types';
import { encodeProjectDir } from '../../utils/paths';
import type { ChatStore } from '../../core/chat-store';

/**
 * Keeps an opaque copy of each Claude Code session file in the vault (§6.4), because Claude
 * Code deletes sessions after 30 days and keeps them on one machine. The file is copied byte
 * for byte and never parsed. This and restore are the only places the plugin touches ~/.claude.
 */
export class SessionMirror {
	private located = new Map<string, string>();

	constructor(
		private app: App,
		private store: ChatStore,
	) {}

	private projectsDir(): string {
		return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
	}

	/** Finds `<projects>/<any dir>/<sessionId>.jsonl` without assuming how cwd is encoded. */
	private async locate(record: ChatRecord): Promise<string | null> {
		const id = record.sessionId;
		if (!id) return null;
		const cached = this.located.get(id);
		if (cached && (await exists(cached))) return cached;
		const root = this.projectsDir();
		const candidates = record.sessionCwd ? [encodeProjectDir(record.sessionCwd)] : [];
		let dirs: string[] = [];
		try {
			dirs = await fs.readdir(root);
		} catch {
			return null;
		}
		for (const dir of [...candidates, ...dirs]) {
			const file = join(root, dir, `${id}.jsonl`);
			if (await exists(file)) {
				this.located.set(id, file);
				return file;
			}
		}
		return null;
	}

	async mirror(record: ChatRecord): Promise<void> {
		const source = await this.locate(record);
		if (!source) return;
		const bytes = await fs.readFile(source);
		await this.store.folders.ensure(record.homeNote);
		const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		await this.app.vault.adapter.writeBinary(this.store.mirrorPath(record), data);
	}

	/**
	 * Makes sure the session exists locally before resuming. If Claude Code has no copy
	 * (cleaned up, or another computer), copies the vault mirror back. Returns false when
	 * neither exists.
	 */
	async ensureLocal(record: ChatRecord): Promise<boolean> {
		if (!record.sessionId) return true;
		// A local file always wins: it may hold turns added in the terminal after the last mirror.
		if (await this.locate(record)) return true;
		if (await getSessionInfo(record.sessionId)) return true;
		const mirrorPath = this.store.mirrorPath(record);
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(mirrorPath))) return false;
		const cwd = record.sessionCwd ?? 'restored';
		const dir = join(this.projectsDir(), encodeProjectDir(cwd));
		await fs.mkdir(dir, { recursive: true });
		const target = join(dir, `${record.sessionId}.jsonl`);
		await fs.writeFile(target, Buffer.from(await adapter.readBinary(mirrorPath)));
		this.located.set(record.sessionId, target);
		return true;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

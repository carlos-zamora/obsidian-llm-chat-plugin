import { getAllTags, normalizePath, TFile, type App } from 'obsidian';
import type { LlmSessionsSettings } from '../settings/settings';

export interface SearchHit {
	path: string;
	snippet: string;
}

/**
 * The only way the agent reaches notes. Enforces the vault boundary (vault paths
 * only, Markdown only) and the user's exclusions before anything reaches the model.
 */
export class VaultAccess {
	constructor(
		private app: App,
		private settings: () => LlmSessionsSettings,
	) {}

	/** Resolves a vault path or wikilink (`[[Note]]`, `Note`, `Folder/Note.md`) to a note. */
	resolve(ref: string, sourcePath = ''): TFile | null {
		const cleaned = ref
			.trim()
			.replace(/^!?\[\[/, '')
			.replace(/\]\]$/, '')
			.split('|')[0]!
			.split('#')[0]!
			.trim();
		if (!cleaned || cleaned.includes('..')) return null;
		const direct = this.app.vault.getAbstractFileByPath(normalizePath(cleaned));
		const file =
			direct instanceof TFile
				? direct
				: this.app.vault.getAbstractFileByPath(normalizePath(`${cleaned}.md`)) ??
					this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
		return file instanceof TFile && file.extension === 'md' ? file : null;
	}

	isExcluded(file: TFile): boolean {
		const s = this.settings();
		const folders = s.excludedFolders.map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean);
		if (folders.some((f) => file.path === f || file.path.startsWith(`${f}/`))) return true;
		// Never expose hidden folders (Obsidian's config, chat data) or a visible chat-data folder.
		if (file.path.split('/').some((part) => part.startsWith('.') || part === s.chatFolderName)) return true;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache) {
			const optOut: unknown = s.optOutKey ? cache.frontmatter?.[s.optOutKey] : undefined;
			if (optOut === false || optOut === 'false') return true;
			const excludedTags = s.excludedTags.map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean);
			if (excludedTags.length > 0) {
				const tags = (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, '').toLowerCase());
				if (tags.some((t) => excludedTags.some((x) => t === x || t.startsWith(`${x}/`)))) return true;
			}
		}
		return false;
	}

	async read(file: TFile): Promise<string> {
		return this.app.vault.cachedRead(file);
	}

	async search(text: string, tag: string | undefined, limit: number): Promise<SearchHit[]> {
		const needle = text.trim().toLowerCase();
		const wantTag = tag?.replace(/^#/, '').toLowerCase();
		const hits: SearchHit[] = [];
		const files = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
		for (const file of files) {
			if (hits.length >= limit) break;
			if (this.isExcluded(file)) continue;
			if (wantTag) {
				const cache = this.app.metadataCache.getFileCache(file);
				const tags = cache ? (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, '').toLowerCase()) : [];
				if (!tags.some((t) => t === wantTag || t.startsWith(`${wantTag}/`))) continue;
			}
			if (!needle) {
				hits.push({ path: file.path, snippet: '' });
				continue;
			}
			if (file.basename.toLowerCase().includes(needle)) {
				hits.push({ path: file.path, snippet: '(title match)' });
				continue;
			}
			const content = await this.read(file);
			const i = content.toLowerCase().indexOf(needle);
			if (i !== -1) {
				const start = Math.max(0, i - 80);
				const snippet = content.slice(start, i + needle.length + 80).replace(/\s+/g, ' ').trim();
				hits.push({ path: file.path, snippet });
			}
		}
		return hits;
	}

	links(file: TFile): { outgoing: string[]; backlinks: string[] } {
		const resolved = this.app.metadataCache.resolvedLinks;
		const allowed = (path: string) => {
			const f = this.app.vault.getAbstractFileByPath(path);
			return f instanceof TFile && f.extension === 'md' && !this.isExcluded(f);
		};
		const outgoing = Object.keys(resolved[file.path] ?? {}).filter(allowed);
		const backlinks = Object.entries(resolved)
			.filter(([, targets]) => file.path in targets)
			.map(([source]) => source)
			.filter(allowed);
		return { outgoing, backlinks };
	}
}

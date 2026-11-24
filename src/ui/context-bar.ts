import { FuzzySuggestModal, Menu, Notice, setIcon, TFile, type App } from 'obsidian';
import { isAbsolute, relative } from 'path';
import type { ChatService } from '../core/chat-service';
import type { ChatRecord } from '../types';
import { contextFileProblem, contextKind, SUPPORTED_FILES } from '../utils/file-kinds';
import { noteDisplayName } from '../utils/paths';

/*
 * The chat panel's context row: which notes and files Claude gets with every message,
 * and the ways to add more (the + menu, a vault file picker, a file from the computer,
 * or dropping files on the panel).
 */

export interface ContextBarHost {
	app: App;
	service: ChatService;
	/** Called after the context changed, so the panel can refresh its hints. */
	onChanged: () => void;
}

let fieldIds = 0;

export function renderContextBar(container: HTMLElement, record: ChatRecord, host: ContextBarHost): void {
	const row = container.createDiv({ cls: 'llm-chat-context' });
	const labelId = `llm-context-label-${++fieldIds}`;
	row.createSpan({ cls: 'llm-field-label', text: 'Context', attr: { id: labelId } });
	const list = row.createEl('ul', { cls: 'llm-chat-chips', attr: { 'aria-labelledby': labelId } });

	for (const path of host.service.contextNotePaths(record)) {
		const pinned = record.hostNotes.includes(path);
		const name = noteDisplayName(path);
		const chip = list.createEl('li', { cls: `llm-chip${pinned ? ' is-pinned' : ''}` });
		const open = chip.createEl('button', {
			cls: 'llm-chip-open',
			attr: {
				'aria-label': pinned ? `${name}: this chat's note, always included. Select to open.` : `${name}. Select to open.`,
				title: path,
			},
		});
		setIcon(open.createSpan({ cls: 'llm-chip-icon', attr: { 'aria-hidden': 'true' } }), pinned ? 'pin' : iconFor(path));
		open.createSpan({ text: name });
		open.addEventListener('click', () => void host.app.workspace.openLinkText(path, '', false));
		if (!pinned) {
			const remove = chip.createEl('button', { cls: 'llm-chip-remove clickable-icon', attr: { 'aria-label': `Remove ${name} from the context` } });
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				void host.service.removeContextNote(record, path).then(host.onChanged);
			});
		}
	}

	const add = row.createEl('button', {
		cls: 'llm-chip-add clickable-icon',
		attr: { 'aria-label': 'Add notes or files to the context', 'aria-haspopup': 'menu' },
	});
	setIcon(add, 'plus');
	add.addEventListener('click', (evt) => showAddMenu(evt, add, record, host));
}

function iconFor(path: string): string {
	switch (contextKind(path.slice(path.lastIndexOf('.') + 1))) {
		case 'image':
			return 'image';
		case 'pdf':
			return 'file-text';
		default:
			return path.endsWith('.md') ? 'file-text' : 'file-code';
	}
}

function showAddMenu(evt: MouseEvent, button: HTMLElement, record: ChatRecord, host: ContextBarHost): void {
	const menu = new Menu();
	const active = host.app.workspace.getActiveFile();
	if (active && !host.service.contextNotePaths(record).includes(active.path) && contextKind(active.extension)) {
		menu.addItem((item) =>
			item
				.setTitle(`Add "${noteDisplayName(active.path)}"`)
				.setIcon('file-plus')
				.onClick(() => void addFiles(host, record, [active])),
		);
	}
	menu.addItem((item) =>
		item
			.setTitle('Add a note or file from the vault…')
			.setIcon('search')
			.onClick(() => new VaultFilePicker(host, record).open()),
	);
	menu.addItem((item) =>
		item
			.setTitle('Add a file from this computer…')
			.setIcon('upload')
			.onClick(() => pickComputerFiles(host, record)),
	);
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('Tip: you can also drop files on the chat panel.').setIcon('info').setDisabled(true));
	if (evt.detail === 0) {
		// Opened from the keyboard: place the menu under the button.
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	} else {
		menu.showAtMouseEvent(evt);
	}
}

/** Adds vault files to the context, explaining any that can't be added. */
export async function addFiles(host: ContextBarHost, record: ChatRecord, files: TFile[]): Promise<void> {
	const added: string[] = [];
	for (const file of files) {
		const problem = host.service.contextFileProblem(file);
		if (problem) {
			new Notice(problem);
			continue;
		}
		if (await host.service.addContextNote(record, file.path)) added.push(noteDisplayName(file.path));
		else new Notice(`${noteDisplayName(file.path)} is already in the context.`);
	}
	if (added.length > 0) host.onChanged();
}

class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		private host: ContextBarHost,
		private record: ChatRecord,
	) {
		super(host.app);
		this.setPlaceholder(`Find a note or file to add to the context. Claude can read ${SUPPORTED_FILES}.`);
	}

	getItems(): TFile[] {
		const inContext = new Set(this.host.service.contextNotePaths(this.record));
		return this.app.vault
			.getFiles()
			.filter((f) => !inContext.has(f.path) && contextKind(f.extension) && !this.host.service.contextFileProblem(f))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void addFiles(this.host, this.record, [file]);
	}
}

function pickComputerFiles(host: ContextBarHost, record: ChatRecord): void {
	const input = createEl('input', { attr: { type: 'file', multiple: '' } });
	input.addEventListener('change', () => {
		const files = Array.from(input.files ?? []);
		if (files.length > 0) void addComputerFiles(host, record, files);
	});
	input.click();
}

/**
 * Adds files from outside Obsidian. Claude only reads files in the vault, so a file that
 * isn't already in it is copied into the attachment folder first, as dropping it in a note would.
 */
export async function addComputerFiles(host: ContextBarHost, record: ChatRecord, files: File[]): Promise<void> {
	const vaultFiles: TFile[] = [];
	for (const file of files) {
		const problem = contextFileProblem(file.name, file.size);
		if (problem) {
			new Notice(problem);
			continue;
		}
		const existing = vaultFileFor(host, file);
		if (existing) {
			vaultFiles.push(existing);
			continue;
		}
		try {
			const path = await host.app.fileManager.getAvailablePathForAttachment(file.name, record.homeNote);
			vaultFiles.push(await host.app.vault.createBinary(path, await file.arrayBuffer()));
			new Notice(`Saved ${file.name} to ${path} so Claude can read it.`);
		} catch (e) {
			new Notice(`Could not add ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	await addFiles(host, record, vaultFiles);
}

/** The vault file a dropped computer file already is, if it lives inside the vault. */
function vaultFileFor(host: ContextBarHost, file: File): TFile | null {
	const abs = filePath(file);
	if (!abs) return null;
	const rel = relative(host.service.vaultBasePath(), abs);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
	const found = host.app.vault.getAbstractFileByPath(rel.split('\\').join('/'));
	return found instanceof TFile ? found : null;
}

/** Absolute path of a dropped file. Electron exposes it through webUtils (newer) or File.path (older). */
function filePath(file: File): string | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is only reachable through require in plugins.
		const electron = require('electron') as { webUtils?: { getPathForFile(f: File): string } };
		const p = electron.webUtils?.getPathForFile(file);
		if (p) return p;
	} catch {
		// Not available; fall back below.
	}
	const legacy = (file as File & { path?: unknown }).path;
	return typeof legacy === 'string' && legacy ? legacy : null;
}

// ── Drag and drop ─────────────────────────────────────────────────────────

interface ObsidianDraggable {
	type?: string;
	file?: unknown;
	files?: unknown[];
	linktext?: string;
	sourcePath?: string;
}

/** Obsidian's in-app drag (file explorer, links). Not public API, so every field is checked. */
function obsidianDraggable(app: App): ObsidianDraggable | null {
	const manager = (app as App & { dragManager?: { draggable?: unknown } }).dragManager;
	const d = manager?.draggable;
	return d && typeof d === 'object' ? d : null;
}

/** True when a drag carries files: from Obsidian's file explorer or from the computer. */
export function isFileDrag(app: App, evt: DragEvent): boolean {
	const d = obsidianDraggable(app);
	if (d && (d.type === 'file' || d.type === 'files' || d.type === 'link')) return true;
	return Array.from(evt.dataTransfer?.types ?? []).includes('Files');
}

/** Vault files named by a drop: Obsidian drags, obsidian:// URLs or [[links]] in the dropped text. */
function droppedVaultFiles(app: App, evt: DragEvent, sourcePath: string): TFile[] {
	const out: TFile[] = [];
	const d = obsidianDraggable(app);
	if (d?.file instanceof TFile) out.push(d.file);
	for (const f of d?.files ?? []) if (f instanceof TFile) out.push(f);
	if (d?.type === 'link' && d.linktext) {
		const f = app.metadataCache.getFirstLinkpathDest(d.linktext, d.sourcePath ?? sourcePath);
		if (f) out.push(f);
	}
	if (out.length > 0) return out;

	const text = `${evt.dataTransfer?.getData('text/uri-list') ?? ''}\n${evt.dataTransfer?.getData('text/plain') ?? ''}`;
	for (const line of text.split(/\r?\n/)) {
		const ref = linkTarget(line.trim());
		if (!ref) continue;
		const byPath = app.vault.getAbstractFileByPath(ref);
		const f = byPath instanceof TFile ? byPath : app.metadataCache.getFirstLinkpathDest(ref, sourcePath);
		if (f && !out.includes(f)) out.push(f);
	}
	return out;
}

function linkTarget(line: string): string | null {
	if (line.startsWith('obsidian://')) {
		try {
			return new URL(line).searchParams.get('file');
		} catch {
			return null;
		}
	}
	const wiki = /^!?\[\[([^\]|#]+)/.exec(line);
	return wiki?.[1]?.trim() ?? null;
}

/** Handles a drop on the chat panel. Returns true when it added (or tried to add) files. */
export async function handleDrop(host: ContextBarHost, record: ChatRecord, evt: DragEvent): Promise<boolean> {
	const vaultFiles = droppedVaultFiles(host.app, evt, record.homeNote);
	if (vaultFiles.length > 0) {
		await addFiles(host, record, vaultFiles);
		return true;
	}
	const computerFiles = Array.from(evt.dataTransfer?.files ?? []);
	if (computerFiles.length > 0) {
		await addComputerFiles(host, record, computerFiles);
		return true;
	}
	return false;
}

/** Pure path math for note renames, moves and deletes (docs/ARCHITECTURE.md §11.6). */

export interface ChatPaths {
	homeNote: string;
	hostNotes: string[];
	extraContextNotes: string[];
}

export interface RenamePlan {
	changed: boolean;
	homeNote: string;
	hostNotes: string[];
	extraContextNotes: string[];
	/** True when the home note moved, so the chat's files must follow it. */
	homeMoved: boolean;
}

export function planRename(chat: ChatPaths, oldPath: string, newPath: string): RenamePlan {
	const swap = (p: string) => (p === oldPath ? newPath : p);
	const hostNotes = [...new Set(chat.hostNotes.map(swap))];
	const extraContextNotes = [...new Set(chat.extraContextNotes.map(swap))];
	const homeMoved = chat.homeNote === oldPath;
	const changed = homeMoved || chat.hostNotes.includes(oldPath) || chat.extraContextNotes.includes(oldPath);
	return { changed, homeNote: swap(chat.homeNote), hostNotes, extraContextNotes, homeMoved };
}

export interface DeletePlan {
	changed: boolean;
	hostNotes: string[];
	extraContextNotes: string[];
	/** The home note is gone; the chat stays where it is as an orphan. */
	orphaned: boolean;
}

export function planDelete(chat: ChatPaths, deletedPath: string): DeletePlan {
	const hostNotes = chat.hostNotes.filter((p) => p !== deletedPath);
	const extraContextNotes = chat.extraContextNotes.filter((p) => p !== deletedPath);
	return {
		changed: hostNotes.length !== chat.hostNotes.length || extraContextNotes.length !== chat.extraContextNotes.length,
		hostNotes,
		extraContextNotes,
		orphaned: chat.homeNote === deletedPath,
	};
}

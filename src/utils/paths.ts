/** Vault-relative path helpers. Vault paths use `/` and have no leading slash. */

export function parentFolder(vaultPath: string): string {
	const i = vaultPath.lastIndexOf('/');
	return i === -1 ? '' : vaultPath.slice(0, i);
}

export function joinVault(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join('/');
}

export function baseName(vaultPath: string): string {
	const i = vaultPath.lastIndexOf('/');
	return i === -1 ? vaultPath : vaultPath.slice(i + 1);
}

export function noteDisplayName(vaultPath: string): string {
	return baseName(vaultPath).replace(/\.md$/i, '');
}

/** Chat folder that holds chats whose home note is `notePath`. */
export function chatFolderFor(notePath: string, chatFolderName: string): string {
	return joinVault(parentFolder(notePath), chatFolderName);
}

/**
 * Claude Code's project directory name for a cwd: every character that is not
 * a letter or digit becomes `-`. Used only to place a restored session file;
 * resume finds sessions by ID in any project directory.
 */
export function encodeProjectDir(absCwd: string): string {
	return absCwd.replace(/[^a-zA-Z0-9]/g, '-');
}

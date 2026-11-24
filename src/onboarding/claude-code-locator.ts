import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { compareVersions, MIN_CLAUDE_VERSION, parseVersion } from '../utils/version';

export interface ClaudeCheck {
	path: string;
	version: string | null;
	ok: boolean;
	message: string;
}

function run(cmd: string, args: string[], timeoutMs = 10000): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
			resolve(err ? null : String(stdout));
		});
	});
}

function knownLocations(): string[] {
	const home = homedir();
	if (process.platform === 'win32') {
		const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
		return [
			join(home, '.local', 'bin', 'claude.exe'),
			join(appData, 'npm', 'claude.cmd'),
		];
	}
	return [
		join(home, '.local', 'bin', 'claude'),
		join(home, '.claude', 'local', 'claude'),
		'/opt/homebrew/bin/claude',
		'/usr/local/bin/claude',
		join(home, '.npm-global', 'bin', 'claude'),
	];
}

/**
 * Finds the user's Claude Code. Apps started from the desktop often have a shorter
 * PATH than a terminal, so known install locations are checked as well.
 */
export async function locateClaude(): Promise<string | null> {
	const finder = process.platform === 'win32' ? 'where' : 'which';
	const out = await run(finder, ['claude']);
	const fromPath = out
		?.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		// Prefer the native .exe over npm shims on Windows.
		.sort((a, b) => Number(b.endsWith('.exe')) - Number(a.endsWith('.exe')))[0];
	if (fromPath && existsSync(fromPath)) return fromPath;
	return knownLocations().find((p) => existsSync(p)) ?? null;
}

export async function checkClaude(path: string): Promise<ClaudeCheck> {
	if (!path || !existsSync(path)) {
		return { path, version: null, ok: false, message: 'Claude Code was not found at this path.' };
	}
	const out = await run(path, ['--version']);
	const version = out ? parseVersion(out) : null;
	if (!version) {
		return { path, version: null, ok: false, message: 'Could not run Claude Code to read its version.' };
	}
	if (compareVersions(version, MIN_CLAUDE_VERSION) < 0) {
		return {
			path,
			version,
			ok: false,
			message: `Claude Code ${version} is too old. Update to ${MIN_CLAUDE_VERSION} or later (run "claude update").`,
		};
	}
	return { path, version, ok: true, message: `Claude Code ${version}` };
}

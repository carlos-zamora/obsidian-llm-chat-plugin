import { spawn } from 'child_process';

/**
 * Opens the user's terminal in `cwd` running Claude Code with `args`.
 * Phase 1 uses it for "Sign in with Claude Code"; Phase 2 reuses it for handoff.
 */
export async function openTerminal(claudePath: string, cwd: string, args: string[] = []): Promise<boolean> {
	if (process.platform === 'win32') {
		if (await launch('wt.exe', ['-d', cwd, claudePath, ...args], cwd)) return true;
		const cmd = [claudePath, ...args].map(psQuote).join(' ');
		return launch('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-Command', `& ${cmd}`], cwd);
	}
	if (process.platform === 'darwin') {
		const shell = `cd ${shQuote(cwd)} && ${[claudePath, ...args].map(shQuote).join(' ')}`;
		return launch(
			'osascript',
			['-e', `tell application "Terminal" to do script ${JSON.stringify(shell)}`, '-e', 'tell application "Terminal" to activate'],
			cwd,
		);
	}
	const term = process.env.TERMINAL ?? 'x-terminal-emulator';
	return launch(term, ['-e', claudePath, ...args], cwd);
}

/** Resolves true once the process has started, false if it could not be started. */
function launch(cmd: string, args: string[], cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
			child.once('spawn', () => {
				child.unref();
				resolve(true);
			});
			child.once('error', () => resolve(false));
		} catch {
			resolve(false);
		}
	});
}

function psQuote(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}

function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

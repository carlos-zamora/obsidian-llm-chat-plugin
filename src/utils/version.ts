export const MIN_CLAUDE_VERSION = '2.1.223';

/** Extracts the first `x.y.z` from text such as `2.1.331 (Claude Code)`. */
export function parseVersion(text: string): string | null {
	const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
	return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d > 0 ? 1 : -1;
	}
	return 0;
}

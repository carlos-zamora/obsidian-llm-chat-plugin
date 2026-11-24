import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LlmSessionsSettings } from '../settings/settings';
import { baseOptions } from '../runtime/claude/claude-env';

export type ProbeResult =
	| { ok: true; billing: string; account: string | null; model: string; reply: string }
	| { ok: false; error: string };

/**
 * Sends one tiny, unsaved query with no tools. In subscription mode the API key
 * variables are removed first, so success means Claude Code's own sign-in works.
 */
export async function probeAuth(
	settings: LlmSessionsSettings,
	apiKey: string | null,
	cwd: string,
	prompt = 'Reply with the single word OK.',
): Promise<ProbeResult> {
	const abort = new AbortController();
	const timer = window.setTimeout(() => abort.abort(), 90000);
	let billing = '';
	let account: string | null = null;
	let model = '';
	let stderr = '';
	try {
		const q = query({
			prompt,
			options: {
				...baseOptions(settings, apiKey, cwd),
				tools: [],
				maxTurns: 1,
				persistSession: false,
				model: settings.defaultModel,
				effort: 'low',
				abortController: abort,
				stderr: (d) => (stderr += d),
			},
		});
		for await (const m of q) {
			if (m.type === 'system' && m.subtype === 'init') {
				model = m.model;
				billing = m.apiKeySource === 'ANTHROPIC_API_KEY' ? 'API key' : 'Claude Code sign-in';
				try {
					const info = await q.accountInfo();
					if (info.subscriptionType) billing = info.subscriptionType;
					account = info.email ?? null;
				} catch {
					// Account details are optional.
				}
			}
			if (m.type === 'result') {
				if (m.subtype === 'success' && !m.is_error) return { ok: true, billing, account, model, reply: m.result };
				const detail = m.subtype === 'success' ? m.result : m.errors.join(' ') || m.subtype;
				return { ok: false, error: explain(detail) };
			}
		}
		return { ok: false, error: explain(stderr || 'Claude Code exited without a reply.') };
	} catch (e) {
		return { ok: false, error: explain(stderr || (e instanceof Error ? e.message : String(e))) };
	} finally {
		window.clearTimeout(timer);
	}
}

function explain(raw: string): string {
	const text = raw.trim();
	if (/log ?in|not (logged|signed) in|authenticat|invalid api key|401/i.test(text)) {
		return `Not signed in. ${text}`;
	}
	return text || 'Unknown error.';
}

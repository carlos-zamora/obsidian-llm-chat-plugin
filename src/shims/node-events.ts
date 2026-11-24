/**
 * Stand-in for Node's `events` module inside the bundle (wired up by the `alias` in
 * esbuild.config.mjs).
 *
 * Obsidian runs plugins in Electron's renderer, where the global AbortController is
 * Chromium's, not Node's. The Agent SDK creates its own controllers and calls
 * `setMaxListeners(50, controller.signal)`. Node accepts only its own EventTarget there, so
 * the call throws "The eventTargets argument must be an instance of EventEmitter or
 * EventTarget" and every query fails before Claude Code starts.
 *
 * Chromium's EventTarget has no listener limit or leak warning, so there is nothing to set:
 * targets Node rejects are skipped. Everything else is Node's own module.
 */
import * as events from 'node:events';

// Bundled dependencies import only `once` and `setMaxListeners` today; the rest keeps the
// shim a drop-in replacement if that changes.
export { EventEmitter, once, on, getEventListeners, getMaxListeners, addAbortListener, errorMonitor, captureRejectionSymbol } from 'node:events';
export default events.EventEmitter;

export function setMaxListeners(n?: number, ...eventTargets: Parameters<typeof events.setMaxListeners>[1][]): void {
	if (eventTargets.length === 0) {
		events.setMaxListeners(n);
		return;
	}
	for (const target of eventTargets) {
		try {
			events.setMaxListeners(n, target);
		} catch (e) {
			if ((e as { code?: string }).code !== 'ERR_INVALID_ARG_TYPE') throw e;
		}
	}
}

/**
 * Node's timers for bundled code (injected by esbuild.config.mjs: every bare `setTimeout`,
 * `setInterval` and their `clear*` in the bundle resolve here).
 *
 * Obsidian runs plugins in Electron's renderer, where the global timers are the browser's and
 * return numbers. The Agent SDK calls `setTimeout(...).unref()`, which only Node's timer
 * objects have, so cleaning up after a query threw "setTimeout(...).unref is not a function".
 *
 * Plugin code that wants browser timers uses `window.setTimeout`, which this does not touch.
 */
export { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';

/** Calls `fn` at most once per `ms`, always running the latest call last. */
export function throttle(fn: () => void, ms: number): { (): void; flush(): void; cancel(): void } {
	let timer: number | null = null;
	let last = 0;
	const run = () => {
		timer = null;
		last = Date.now();
		fn();
	};
	const throttled = () => {
		if (timer !== null) return;
		const wait = Math.max(0, ms - (Date.now() - last));
		timer = window.setTimeout(run, wait);
	};
	throttled.flush = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			run();
		}
	};
	throttled.cancel = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
	};
	return throttled;
}

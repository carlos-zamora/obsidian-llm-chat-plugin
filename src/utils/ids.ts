import type { ChatId } from '../types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, time-ordered, lowercase ID such as `c-mfz2k1q8x3a`. */
export function newChatId(now: number = Date.now()): ChatId {
	let rand = '';
	for (let i = 0; i < 3; i++) {
		rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return `c-${now.toString(36)}${rand}`;
}

export function isChatId(value: string): value is ChatId {
	return /^c-[a-z0-9]+$/.test(value);
}

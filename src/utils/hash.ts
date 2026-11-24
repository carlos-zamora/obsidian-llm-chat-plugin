import { createHash } from 'crypto';

export function hashText(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

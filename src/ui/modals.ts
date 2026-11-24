import { Modal, Setting, type App } from 'obsidian';

/** Asks for one line of text. Resolves null when cancelled. */
export function promptText(app: App, title: string, initial = '', placeholder = ''): Promise<string | null> {
	return new Promise((resolve) => {
		let value = initial;
		let done = false;
		const modal = new (class extends Modal {
			onOpen() {
				this.setTitle(title);
				new Setting(this.contentEl).addText((t) => {
					t.setValue(initial).setPlaceholder(placeholder).onChange((v) => (value = v));
					t.inputEl.addClass('llm-wide-input');
					t.inputEl.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							finish(value);
						}
					});
					window.setTimeout(() => t.inputEl.select(), 0);
				});
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText('Cancel').onClick(() => finish(null)))
					.addButton((b) => b.setButtonText('Save').setCta().onClick(() => finish(value)));
			}
			onClose() {
				if (!done) resolve(null);
			}
		})(app);
		const finish = (v: string | null) => {
			done = true;
			resolve(v);
			modal.close();
		};
		modal.open();
	});
}

export interface Choice<T extends string> {
	value: T;
	label: string;
	cta?: boolean;
}

/** Shows a message with buttons. Resolves the chosen value, or null when dismissed. */
export function choose<T extends string>(app: App, title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
	return new Promise((resolve) => {
		let done = false;
		const modal = new (class extends Modal {
			onOpen() {
				this.setTitle(title);
				this.contentEl.createEl('p', { text: message });
				const s = new Setting(this.contentEl);
				for (const c of choices) {
					s.addButton((b) => {
						b.setButtonText(c.label).onClick(() => {
							done = true;
							resolve(c.value);
							this.close();
						});
						if (c.cta) b.setCta();
					});
				}
			}
			onClose() {
				if (!done) resolve(null);
			}
		})(app);
		modal.open();
	});
}

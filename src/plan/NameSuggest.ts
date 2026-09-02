import { AbstractInputSuggest, App } from "obsidian";

/**
 * 担当者名などの入力欄に、既存の名前を部分一致でサジェストする。
 * 候補にない名前も自由に入力できる(表記ゆれを減らすための補助)
 */
export class NameSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private textInputEl: HTMLInputElement,
		private names: () => string[],
		private onPick?: (name: string) => void
	) {
		super(app, textInputEl);
	}

	getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		const seen = new Set<string>();
		return this.names().filter((name) => {
			if (name === "" || seen.has(name)) return false;
			seen.add(name);
			return q === "" || name.toLowerCase().includes(q);
		});
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	selectSuggestion(name: string): void {
		this.textInputEl.value = name;
		this.textInputEl.dispatchEvent(new Event("input"));
		this.onPick?.(name);
		this.close();
	}
}

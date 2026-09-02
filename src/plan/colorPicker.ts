import { Menu } from "obsidian";
import { PLAN_COLORS } from "./plans";

let customInput: HTMLInputElement | null = null;

/** OSのカラーピッカーを開く(input[type=color] を一時的に生成してクリック) */
export function pickCustomColor(current: string, onPick: (color: string) => void): void {
	customInput?.remove();
	const input = document.body.createEl("input", { type: "color", cls: "rg-plan-color-input" });
	customInput = input;
	input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : "#808080";
	input.addEventListener("change", () => {
		onPick(input.value);
		input.remove();
		if (customInput === input) customInput = null;
	});
	input.click();
}

/** メニュー項目用: 色の丸+名前(選択中は ✓) */
function colorTitle(hex: string, label: string, checked: boolean): DocumentFragment {
	const frag = document.createDocumentFragment();
	const dot = frag.createSpan({ cls: "rg-menu-dot" });
	dot.style.backgroundColor = hex;
	frag.createSpan({ text: checked ? `${label} ✓` : label });
	return frag;
}

export interface ColorMenuOptions {
	/** 先頭に「既定に戻す」系の項目を出す。ラベルと処理 */
	reset?: { label: string; disabled?: boolean; onReset: () => void };
	/** 末尾に追加する項目 */
	extra?: (menu: Menu) => void;
}

/** プリセット色+カスタム色を選ぶ Obsidian メニュー */
export function buildColorMenu(
	current: string,
	onPick: (color: string) => void,
	options: ColorMenuOptions = {}
): Menu {
	const menu = new Menu();
	if (options.reset) {
		const reset = options.reset;
		menu.addItem((item) =>
			item
				.setTitle(reset.label)
				.setIcon("rotate-ccw")
				.setDisabled(reset.disabled ?? false)
				.onClick(() => reset.onReset())
		);
		menu.addSeparator();
	}
	const cur = current.toLowerCase();
	for (const color of PLAN_COLORS) {
		menu.addItem((item) =>
			item.setTitle(colorTitle(color.hex, color.label, color.hex === cur)).onClick(() => onPick(color.hex))
		);
	}
	menu.addItem((item) =>
		item
			.setTitle("カスタム…")
			.setIcon("palette")
			.onClick(() => pickCustomColor(current, onPick))
	);
	options.extra?.(menu);
	return menu;
}

export interface SwatchOptions {
	/** 「グループ色」(上書きなし=空文字)の選択肢を先頭に出す */
	groupColor?: string;
	/** カスタム色ボタンを出す */
	custom?: boolean;
}

/**
 * ポップオーバー用の色スウォッチ列。戻り値の関数で選択中の色を更新できる
 */
export function buildSwatches(
	container: HTMLElement,
	current: string,
	onPick: (color: string) => void,
	options: SwatchOptions = {}
): (color: string) => void {
	const row = container.createDiv({ cls: "rg-plan-swatches" });
	const buttons: { color: string; el: HTMLButtonElement }[] = [];
	const select = (color: string) => {
		for (const b of buttons) b.el.toggleClass("is-selected", b.color === color.toLowerCase());
	};
	if (options.groupColor !== undefined) {
		const chip = row.createEl("button", { cls: "rg-plan-swatch rg-plan-swatch-group", text: "グループ色" });
		chip.setAttr("aria-label", "グループの色を使う");
		chip.addEventListener("click", (e) => {
			e.preventDefault();
			onPick("");
			select("");
		});
		buttons.push({ color: "", el: chip });
	}
	for (const color of PLAN_COLORS) {
		const swatch = row.createEl("button", { cls: "rg-plan-swatch" });
		swatch.style.backgroundColor = color.hex;
		swatch.setAttr("aria-label", `色: ${color.label}`);
		swatch.setAttr("title", color.label);
		swatch.addEventListener("click", (e) => {
			e.preventDefault();
			onPick(color.hex);
			select(color.hex);
		});
		buttons.push({ color: color.hex, el: swatch });
	}
	if (options.custom) {
		const custom = row.createEl("button", { cls: "rg-plan-swatch rg-plan-swatch-custom", text: "…" });
		custom.setAttr("aria-label", "カスタム色");
		custom.setAttr("title", "カスタム色");
		custom.addEventListener("click", (e) => {
			e.preventDefault();
			pickCustomColor(current, (color) => {
				onPick(color);
				select(color);
			});
		});
	}
	select(current);
	return select;
}

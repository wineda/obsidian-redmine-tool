import { App } from "obsidian";
import type { PlanGroup, PlanKind } from "../settings";
import { buildSwatches } from "./colorPicker";
import { NameSuggest } from "./NameSuggest";
import { groupNoun, planKindLabel } from "./plans";

let active: FloatingPanel | null = null;

/** 開いているポップオーバーを閉じる(スクロール・再描画の前に呼ぶ) */
export function closePlanPopover(): void {
	active?.dismiss();
}

/**
 * ガントの上に重ねて出す小さな入力パネル。
 * 外側クリック・Escで取り消し、Enterで確定する
 */
abstract class FloatingPanel {
	protected el: HTMLElement;
	private closed = false;
	private listening = false;

	private onDocMouseDown = (e: MouseEvent): void => {
		if (!this.el.contains(e.target as Node)) this.dismiss();
	};
	private onDocKeyDown = (e: KeyboardEvent): void => {
		if (e.key === "Escape") {
			e.preventDefault();
			this.dismiss();
		}
	};

	constructor(
		private host: HTMLElement,
		private anchor: DOMRect,
		private onCancel?: () => void
	) {
		active?.dismiss();
		active = this;
		this.el = host.createDiv({ cls: "rg-plan-popover" });
		this.el.addEventListener("keydown", (e) => {
			const tag = (e.target as HTMLElement).tagName;
			if (e.key === "Enter" && tag !== "BUTTON" && tag !== "SELECT") {
				e.preventDefault();
				this.submit();
			}
		});
		// 開くきっかけになったマウス操作(mouseup/click)を外側クリックと誤認しないよう、次のティックで登録する
		window.setTimeout(() => {
			if (this.closed) return;
			document.addEventListener("mousedown", this.onDocMouseDown);
			document.addEventListener("keydown", this.onDocKeyDown);
			this.listening = true;
		}, 0);
	}

	/** 内容を組み立てたあとに呼び、アンカーの下(収まらなければ上)に配置する */
	protected place(): void {
		const hostRect = this.host.getBoundingClientRect();
		const w = this.el.offsetWidth;
		const h = this.el.offsetHeight;
		let left = this.anchor.left - hostRect.left;
		let top = this.anchor.bottom - hostRect.top + 4;
		left = Math.max(8, Math.min(left, hostRect.width - w - 8));
		if (top + h > hostRect.height - 8) {
			top = Math.max(8, this.anchor.top - hostRect.top - h - 4);
		}
		this.el.style.left = `${left}px`;
		this.el.style.top = `${top}px`;
	}

	protected abstract submit(): void;

	/** 取り消して閉じる(Esc・外側クリック・キャンセルボタン) */
	dismiss(): void {
		if (this.closed) return;
		this.close();
		this.onCancel?.();
	}

	/** 確定後などに閉じる(取り消し処理は呼ばない) */
	protected close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.listening) {
			document.removeEventListener("mousedown", this.onDocMouseDown);
			document.removeEventListener("keydown", this.onDocKeyDown);
		}
		this.el.remove();
		if (active === this) active = null;
	}

	protected field(label: string): HTMLElement {
		const row = this.el.createDiv({ cls: "rg-pop-field" });
		row.createSpan({ cls: "rg-pop-label", text: label });
		return row.createDiv({ cls: "rg-pop-control" });
	}

	protected actions(): HTMLElement {
		return this.el.createDiv({ cls: "rg-pop-actions" });
	}
}

export interface PlanFormValue {
	name: string;
	groupId: string;
	/** "YYYY-MM-DD"。空文字は未定 */
	start: string;
	end: string;
	/** 上書き色。空文字はグループ色 */
	color: string;
}

export interface PlanPopoverOptions {
	/** 絶対配置の基準になる要素(ガントビューのコンテナ) */
	host: HTMLElement;
	/** 表示位置の基準(バー・ドラッグ範囲などの画面座標) */
	anchor: DOMRect;
	mode: "create" | "edit";
	kind: PlanKind;
	/** 選択肢に出すグループ(同じ種別) */
	groups: PlanGroup[];
	value: PlanFormValue;
	onSubmit: (value: PlanFormValue) => void;
	onDelete?: () => void;
	onCancel?: () => void;
}

/** 予定1件の追加・編集ポップオーバー */
export class PlanPopover extends FloatingPanel {
	private nameInput: HTMLInputElement;
	private groupSelect: HTMLSelectElement;
	private startInput: HTMLInputElement;
	private endInput: HTMLInputElement;
	private color: string;
	private opts: PlanPopoverOptions;

	constructor(opts: PlanPopoverOptions) {
		super(opts.host, opts.anchor, opts.onCancel);
		this.opts = opts;
		this.color = opts.value.color;
		const group = opts.groups.find((g) => g.id === opts.value.groupId);

		const head = this.el.createDiv({ cls: "rg-pop-head" });
		const dot = head.createSpan({ cls: "rg-pop-dot" });
		dot.style.backgroundColor = group?.color ?? "";
		head.createSpan({ cls: "rg-pop-title", text: opts.mode === "create" ? "予定を追加" : "予定を編集" });
		head.createSpan({ cls: "rg-pop-kind", text: planKindLabel(opts.kind) });

		this.nameInput = this.field("予定名").createEl("input", { type: "text", placeholder: "予定名" });
		this.nameInput.value = opts.value.name;

		this.groupSelect = this.field(groupNoun(opts.kind)).createEl("select", { cls: "dropdown" });
		for (const g of opts.groups) {
			const option = this.groupSelect.createEl("option", { text: g.name || "(無題)" });
			option.value = g.id;
		}
		this.groupSelect.value = opts.value.groupId;
		this.groupSelect.addEventListener("change", () => {
			const selected = opts.groups.find((g) => g.id === this.groupSelect.value);
			dot.style.backgroundColor = selected?.color ?? "";
		});

		const dates = this.field("期間").createDiv({ cls: "rg-pop-dates" });
		this.startInput = dates.createEl("input", { type: "date" });
		this.startInput.value = opts.value.start;
		dates.createSpan({ cls: "rg-pop-tilde", text: "〜" });
		this.endInput = dates.createEl("input", { type: "date" });
		this.endInput.value = opts.value.end;
		// 開始日だけ入れたときは同じ日の1日予定にする
		this.startInput.addEventListener("change", () => {
			if (this.endInput.value === "" || this.endInput.value < this.startInput.value) {
				this.endInput.value = this.startInput.value;
			}
		});

		buildSwatches(
			this.field("色"),
			this.color,
			(color) => {
				this.color = color;
			},
			{ groupColor: group?.color ?? "" }
		);

		const actions = this.actions();
		if (opts.mode === "edit" && opts.onDelete) {
			const del = actions.createEl("button", { cls: "rg-pop-danger", text: "削除" });
			del.addEventListener("click", () => {
				this.close();
				opts.onDelete?.();
			});
		}
		actions.createSpan({ cls: "rg-pop-spacer" });
		const cancel = actions.createEl("button", { text: "キャンセル" });
		cancel.addEventListener("click", () => this.dismiss());
		const ok = actions.createEl("button", { cls: "mod-cta", text: opts.mode === "create" ? "追加" : "保存" });
		ok.addEventListener("click", () => this.submit());
		this.el.createDiv({
			cls: "rg-pop-hint",
			text: "Enter で確定、Esc で取り消し",
		});

		this.place();
		this.nameInput.focus();
		if (opts.mode === "edit") this.nameInput.select();
	}

	protected submit(): void {
		const name = this.nameInput.value.trim();
		if (name === "") {
			this.nameInput.addClass("is-invalid");
			this.nameInput.focus();
			return;
		}
		let start = this.startInput.value;
		let end = this.endInput.value;
		if (start && end && start > end) [start, end] = [end, start];
		if (start && !end) end = start;
		if (!start && end) start = end;
		const value: PlanFormValue = {
			name,
			groupId: this.groupSelect.value || this.opts.value.groupId,
			start,
			end,
			color: this.color,
		};
		this.close();
		this.opts.onSubmit(value);
	}
}

export interface GroupFormValue {
	name: string;
	color: string;
}

export interface GroupPopoverOptions {
	app: App;
	host: HTMLElement;
	anchor: DOMRect;
	mode: "create" | "edit";
	kind: PlanKind;
	value: GroupFormValue;
	/** 個人予定の担当者名のサジェスト候補 */
	suggestNames: () => string[];
	/** 候補から名前を選んだときに自動で合わせる色(担当者の色分け設定など)。なければ null */
	fixedColorFor?: (name: string) => string | null;
	onSubmit: (value: GroupFormValue) => void;
	/** 削除(予定は「未分類」へ移す)。未指定なら削除ボタンを出さない */
	onDelete?: () => void;
	onCancel?: () => void;
}

/** グループ(全体予定の系統 / 個人予定の担当者)の追加・設定ポップオーバー */
export class GroupPopover extends FloatingPanel {
	private nameInput: HTMLInputElement;
	private color: string;
	private opts: GroupPopoverOptions;

	constructor(opts: GroupPopoverOptions) {
		super(opts.host, opts.anchor, opts.onCancel);
		this.opts = opts;
		this.color = opts.value.color;
		const noun = groupNoun(opts.kind);

		const head = this.el.createDiv({ cls: "rg-pop-head" });
		const dot = head.createSpan({ cls: "rg-pop-dot" });
		dot.style.backgroundColor = this.color;
		head.createSpan({
			cls: "rg-pop-title",
			text: opts.mode === "create" ? `${noun}を追加` : `${noun}の設定`,
		});
		head.createSpan({ cls: "rg-pop-kind", text: planKindLabel(opts.kind) });

		this.nameInput = this.field(opts.kind === "personal" ? "担当者" : "名前").createEl("input", {
			type: "text",
			placeholder: opts.kind === "personal" ? "担当者名" : "例: リリース、ICG",
		});
		this.nameInput.value = opts.value.name;

		const selectSwatch = buildSwatches(
			this.field("色"),
			this.color,
			(color) => {
				this.color = color;
				dot.style.backgroundColor = color;
			},
			{ custom: true }
		);
		if (opts.kind === "personal") {
			new NameSuggest(opts.app, this.nameInput, opts.suggestNames, (name) => {
				const fixed = opts.fixedColorFor?.(name);
				if (fixed) {
					this.color = fixed;
					dot.style.backgroundColor = fixed;
					selectSwatch(fixed);
				}
			});
		}

		const actions = this.actions();
		if (opts.mode === "edit" && opts.onDelete) {
			const del = actions.createEl("button", { cls: "rg-pop-danger", text: "削除" });
			del.setAttr("title", `${noun}を削除し、予定は「未分類」へ移します`);
			del.addEventListener("click", () => {
				this.close();
				opts.onDelete?.();
			});
		}
		actions.createSpan({ cls: "rg-pop-spacer" });
		const cancel = actions.createEl("button", { text: "キャンセル" });
		cancel.addEventListener("click", () => this.dismiss());
		const ok = actions.createEl("button", { cls: "mod-cta", text: opts.mode === "create" ? "追加" : "保存" });
		ok.addEventListener("click", () => this.submit());
		if (opts.mode === "create") {
			this.el.createDiv({
				cls: "rg-pop-hint",
				text:
					opts.kind === "personal"
						? "同じ担当者の予定はガントの同じ行にまとまります"
						: "追加した行の空白をドラッグすると予定を作れます",
			});
		}

		this.place();
		this.nameInput.focus();
		if (opts.mode === "edit") this.nameInput.select();
	}

	protected submit(): void {
		const name = this.nameInput.value.trim();
		if (name === "") {
			this.nameInput.addClass("is-invalid");
			this.nameInput.focus();
			return;
		}
		this.close();
		this.opts.onSubmit({ name, color: this.color });
	}
}

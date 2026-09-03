import { App, Menu, Modal, Setting, setIcon } from "obsidian";
import type { AssigneeColor, PlanGroup, PlanItem, PlanKind } from "../settings";
import { buildColorMenu } from "./colorPicker";
import { NameSuggest } from "./NameSuggest";
import {
	UNCATEGORIZED_NAME,
	comparePlanItems,
	defaultGroupColor,
	ensureUncategorizedGroup,
	groupNoun,
	newPlanId,
	planKindLabel,
} from "./plans";

export interface PlanModalContext {
	/** 個人予定の担当者名のサジェスト候補 */
	suggestNames: () => string[];
	assigneeColors: AssigneeColor[];
}

/**
 * 予定の一覧編集モーダル。グループ見出しの下に予定をぶら下げて表示する。
 * 保存を押すまで元データには反映しない
 */
export class PlanModal extends Modal {
	private groups: PlanGroup[];
	private items: PlanItem[];
	private ctx: PlanModalContext;
	private onSave: (groups: PlanGroup[], items: PlanItem[]) => void;
	/** 折りたたみ中のグループID(モーダルを開いている間だけ保持) */
	private collapsed = new Set<string>();
	private lists = new Map<PlanKind, HTMLElement>();
	private blocks = new Map<string, HTMLElement>();

	constructor(
		app: App,
		groups: PlanGroup[],
		items: PlanItem[],
		ctx: PlanModalContext,
		onSave: (groups: PlanGroup[], items: PlanItem[]) => void
	) {
		super(app);
		this.groups = groups.map((g) => ({ ...g }));
		this.items = items.map((item) => ({ ...item }));
		this.ctx = ctx;
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass("rg-plan-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "予定の編集" });
		contentEl.createEl("p", {
			cls: "rg-plan-desc",
			text:
				"Redmineとは独立した予定です。ガント最上段の帯にグループごとの行で表示されます。" +
				"ガント上でも、行の空白をドラッグして追加、バーをクリックして編集できます。",
		});

		this.renderSection("team", "プロジェクト全体の予定(リリース・イベントなど)。色はグループごとに設定します");
		this.renderSection("personal", "休暇など個人の予定。同じ担当者の予定はガントの同じ行にまとまります");

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("保存")
					.setCta()
					.onClick(() => this.save())
			)
			.addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
	}

	private renderSection(kind: PlanKind, desc: string): void {
		const { contentEl } = this;
		new Setting(contentEl)
			.setName(planKindLabel(kind))
			.setHeading()
			.setDesc(desc)
			.addButton((button) =>
				button.setButtonText(`＋ ${groupNoun(kind)}`).onClick(() => this.addGroup(kind))
			);
		const list = contentEl.createDiv({ cls: "rg-plan-group-list" });
		this.lists.set(kind, list);
		this.renderList(kind);
	}

	/** 種別ごとのグループ一覧を作り直す(追加・削除・並び替えのとき) */
	private renderList(kind: PlanKind): void {
		const list = this.lists.get(kind);
		if (!list) return;
		list.empty();
		const groups = this.groups.filter((g) => g.kind === kind);
		if (groups.length === 0) {
			list.createDiv({
				cls: "rg-plan-empty",
				text: `${groupNoun(kind)}がありません。「＋ ${groupNoun(kind)}」で追加してください。`,
			});
			return;
		}
		for (const group of groups) list.appendChild(this.buildBlock(group));
	}

	/** グループ1つ分(見出し+予定行)を作り直して差し替える。他のグループの入力状態には触れない */
	private refreshBlock(group: PlanGroup, focusKey?: string): void {
		const old = this.blocks.get(group.id);
		const fresh = this.buildBlock(group);
		if (old && old.isConnected) {
			old.replaceWith(fresh);
		} else {
			this.lists.get(group.kind)?.appendChild(fresh);
		}
		if (focusKey) {
			fresh.querySelector<HTMLInputElement>(`[data-focus="${focusKey}"]`)?.focus();
		}
	}

	private buildBlock(group: PlanGroup): HTMLElement {
		const block = createDiv({ cls: "rg-plan-group" });
		this.blocks.set(group.id, block);
		const isCollapsed = this.collapsed.has(group.id);

		const head = block.createDiv({ cls: "rg-plan-group-head" });
		const body = block.createDiv({ cls: "rg-plan-group-body" });
		body.toggleClass("is-collapsed", isCollapsed);

		const chevron = head.createEl("button", { cls: "clickable-icon rg-plan-chevron" });
		setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
		chevron.setAttr("aria-label", "折りたたみ");
		chevron.addEventListener("click", (e) => {
			e.preventDefault();
			if (this.collapsed.has(group.id)) this.collapsed.delete(group.id);
			else this.collapsed.add(group.id);
			const now = this.collapsed.has(group.id);
			setIcon(chevron, now ? "chevron-right" : "chevron-down");
			body.toggleClass("is-collapsed", now);
		});

		const colorBtn = head.createEl("button", { cls: "clickable-icon rg-plan-group-color" });
		colorBtn.setAttr("aria-label", `${groupNoun(group.kind)}の色: ${group.color}`);
		const dot = colorBtn.createSpan({ cls: "rg-plan-dot rg-plan-dot-lg" });
		dot.style.backgroundColor = group.color;
		colorBtn.addEventListener("click", (e) => {
			e.preventDefault();
			buildColorMenu(group.color, (color) => {
				group.color = color;
				this.refreshBlock(group);
			}).showAtMouseEvent(e);
		});

		const nameInput = head.createEl("input", {
			type: "text",
			cls: "rg-plan-group-name",
			placeholder: group.kind === "personal" ? "担当者名" : "グループ名",
		});
		nameInput.value = group.name;
		nameInput.setAttr("data-focus", `group-${group.id}`);
		nameInput.addEventListener("input", () => {
			group.name = nameInput.value.trim();
		});
		if (group.kind === "personal") {
			// 担当者を候補から選んだら「担当者の色分け」設定の色に合わせる
			new NameSuggest(this.app, nameInput, this.ctx.suggestNames, (name) => {
				const fixed = this.ctx.assigneeColors.find((c) => c.name !== "" && c.name === name);
				if (fixed) {
					group.color = fixed.color;
					this.refreshBlock(group);
				}
			});
		}

		const items = this.items.filter((item) => item.groupId === group.id).sort(comparePlanItems);
		head.createSpan({ cls: "rg-plan-group-count", text: `${items.length}件` });
		head.createSpan({ cls: "rg-plan-group-spacer" });

		const addBtn = head.createEl("button", { text: "＋ 予定" });
		addBtn.addEventListener("click", (e) => {
			e.preventDefault();
			this.addItem(group);
		});

		const moreBtn = head.createEl("button", { cls: "clickable-icon rg-plan-more" });
		setIcon(moreBtn, "more-horizontal");
		moreBtn.setAttr("aria-label", `${groupNoun(group.kind)}のメニュー`);
		moreBtn.addEventListener("click", (e) => {
			e.preventDefault();
			this.groupMenu(group, e);
		});

		if (items.length === 0) {
			body.createDiv({
				cls: "rg-plan-empty",
				text: "予定はありません。「＋ 予定」か、ガントのこの行をドラッグして追加できます。",
			});
		}
		for (const item of items) body.appendChild(this.buildRow(item, group));
		return block;
	}

	private buildRow(item: PlanItem, group: PlanGroup): HTMLElement {
		const row = createDiv({ cls: "rg-plan-item-row" });

		const nameInput = row.createEl("input", {
			type: "text",
			cls: "rg-plan-name-input",
			placeholder: "予定名",
		});
		nameInput.value = item.name;
		nameInput.setAttr("data-focus", `item-${item.id}`);
		nameInput.addEventListener("input", () => {
			item.name = nameInput.value.trim();
		});

		const startInput = row.createEl("input", { type: "date" });
		startInput.value = item.start;
		row.createSpan({ cls: "rg-plan-tilde", text: "〜" });
		const endInput = row.createEl("input", { type: "date" });
		endInput.value = item.end;
		startInput.addEventListener("change", () => {
			item.start = startInput.value;
			// 開始日だけ入れたときは同じ日の1日予定にする
			if (item.start && (item.end === "" || item.end < item.start)) {
				item.end = item.start;
				endInput.value = item.end;
			}
		});
		endInput.addEventListener("change", () => {
			item.end = endInput.value;
		});

		const colorBtn = row.createEl("button", { cls: "clickable-icon rg-plan-item-color" });
		colorBtn.toggleClass("is-override", !!item.color);
		colorBtn.setAttr(
			"aria-label",
			item.color ? `色を上書き中(${item.color})。クリックで変更` : "色: グループ色。クリックで上書き"
		);
		const dot = colorBtn.createSpan({ cls: "rg-plan-dot" });
		dot.style.backgroundColor = item.color || group.color;
		colorBtn.addEventListener("click", (e) => {
			e.preventDefault();
			this.itemMenu(item, group, e);
		});

		const del = row.createEl("button", { cls: "clickable-icon rg-plan-delete" });
		setIcon(del, "trash");
		del.setAttr("aria-label", "削除");
		del.addEventListener("click", (e) => {
			e.preventDefault();
			this.items.remove(item);
			this.refreshBlock(group);
		});
		return row;
	}

	private groupMenu(group: PlanGroup, e: MouseEvent): void {
		const same = this.groups.filter((g) => g.kind === group.kind);
		const index = same.indexOf(group);
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("色を変更…")
				.setIcon("palette")
				.onClick(() =>
					buildColorMenu(group.color, (color) => {
						group.color = color;
						this.refreshBlock(group);
					}).showAtMouseEvent(e)
				)
		);
		menu.addItem((item) =>
			item
				.setTitle("上へ移動")
				.setIcon("arrow-up")
				.setDisabled(index <= 0)
				.onClick(() => this.moveGroup(group, -1))
		);
		menu.addItem((item) =>
			item
				.setTitle("下へ移動")
				.setIcon("arrow-down")
				.setDisabled(index >= same.length - 1)
				.onClick(() => this.moveGroup(group, 1))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(`${groupNoun(group.kind)}を削除(予定は「${UNCATEGORIZED_NAME}」へ)`)
				.setIcon("trash")
				.onClick(() => this.deleteGroup(group))
		);
		menu.showAtMouseEvent(e);
	}

	private itemMenu(item: PlanItem, group: PlanGroup, e: MouseEvent): void {
		const menu = buildColorMenu(
			item.color ?? "",
			(color) => {
				item.color = color;
				this.refreshBlock(group);
			},
			{
				reset: {
					label: "グループ色に戻す",
					disabled: !item.color,
					onReset: () => {
						item.color = "";
						this.refreshBlock(group);
					},
				},
				extra: (m) => {
					const others = this.groups.filter((g) => g.kind === group.kind && g.id !== group.id);
					if (others.length > 0) {
						m.addSeparator();
						for (const other of others) {
							m.addItem((mi) =>
								mi
									.setTitle(`「${other.name || "(無題)"}」へ移動`)
									.setIcon("corner-down-right")
									.onClick(() => {
										item.groupId = other.id;
										this.refreshBlock(group);
										this.refreshBlock(other);
									})
							);
						}
					}
					m.addSeparator();
					m.addItem((mi) =>
						mi
							.setTitle("削除")
							.setIcon("trash")
							.onClick(() => {
								this.items.remove(item);
								this.refreshBlock(group);
							})
					);
				},
			}
		);
		menu.showAtMouseEvent(e);
	}

	private addGroup(kind: PlanKind): void {
		const group: PlanGroup = {
			id: newPlanId("group"),
			name: "",
			color: defaultGroupColor(this.groups, kind, "", this.ctx.assigneeColors),
			kind,
		};
		this.groups.push(group);
		this.renderList(kind);
		this.blocks.get(group.id)?.querySelector<HTMLInputElement>(`[data-focus="group-${group.id}"]`)?.focus();
	}

	private addItem(group: PlanGroup): void {
		const item: PlanItem = {
			id: newPlanId("plan"),
			name: "",
			start: "",
			end: "",
			groupId: group.id,
		};
		this.items.push(item);
		this.collapsed.delete(group.id);
		this.refreshBlock(group, `item-${item.id}`);
	}

	private moveGroup(group: PlanGroup, dir: -1 | 1): void {
		const same = this.groups.filter((g) => g.kind === group.kind);
		const index = same.indexOf(group);
		const target = same[index + dir];
		if (!target) return;
		const a = this.groups.indexOf(group);
		const b = this.groups.indexOf(target);
		this.groups[a] = target;
		this.groups[b] = group;
		this.renderList(group.kind);
	}

	/** グループを削除し、所属していた予定は「未分類」へ移す */
	private deleteGroup(group: PlanGroup): void {
		this.groups.remove(group);
		this.blocks.delete(group.id);
		const owned = this.items.filter((item) => item.groupId === group.id);
		if (owned.length > 0) {
			const fallback = ensureUncategorizedGroup(this.groups, group.kind);
			for (const item of owned) item.groupId = fallback.id;
		}
		this.renderList(group.kind);
	}

	private save(): void {
		// 名前のないグループは、予定を持っていれば「未分類」として残し、空なら捨てる
		const groups = this.groups
			.filter((g) => g.name !== "" || this.items.some((item) => item.groupId === g.id))
			.map((g) => ({ ...g, name: g.name || UNCATEGORIZED_NAME }));
		const items = this.items.filter((item) => item.name !== "").sort(comparePlanItems);
		this.onSave(groups, items);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

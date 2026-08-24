import { App, Modal, Setting } from "obsidian";
import { PlanItem, PlanKind } from "../settings";

/** よく使う色のプリセット(赤・オレンジ・緑・青・紫) */
const PLAN_PRESET_COLORS = ["#d9534f", "#e8883a", "#3f9e4d", "#3f7fd9", "#7a5fd0"];

/** 予定の一覧編集モーダル。保存を押すまで元データには反映しない */
export class PlanModal extends Modal {
	private items: PlanItem[];
	private onSave: (items: PlanItem[]) => void;

	constructor(app: App, items: PlanItem[], onSave: (items: PlanItem[]) => void) {
		super(app);
		this.items = items.map((item) => ({ ...item }));
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
				"Redmineとは独立した予定です。ガントチャート最上段の「全体予定」「個人予定」の行に表示されます。",
		});

		this.renderSection("全体予定", "プロジェクト全体の予定(リリース・イベントなど)", "team");
		this.renderSection("個人予定", "休暇など個人の予定", "personal");

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("保存")
					.setCta()
					.onClick(() => {
						this.onSave(this.items.filter((item) => item.name !== ""));
						this.close();
					})
			)
			.addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
	}

	private renderSection(title: string, desc: string, kind: PlanKind): void {
		const { contentEl } = this;
		const list = this.items
			.filter((item) => (item.kind ?? "team") === kind)
			.sort((a, b) => {
				// 開始日順(未定は末尾)。編集中の並び替えは再描画時のみ
				if (!a.start && !b.start) return a.name.localeCompare(b.name, "ja");
				if (!a.start) return 1;
				if (!b.start) return -1;
				return a.start.localeCompare(b.start);
			});

		new Setting(contentEl)
			.setName(`${title}(${list.length}件)`)
			.setHeading()
			.setDesc(desc)
			.addButton((button) =>
				button.setButtonText("追加").onClick(() => {
					this.items.push({
						id: `plan-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
						name: "",
						start: "",
						end: "",
						color: "",
						kind,
					});
					this.render();
				})
			);

		if (list.length === 0) {
			contentEl.createDiv({ cls: "rg-plan-empty", text: "予定はありません。" });
			return;
		}

		for (const item of list) {
			const setting = new Setting(contentEl);
			setting.settingEl.addClass("rg-plan-setting");
			setting
				.addText((text) => {
					text.setPlaceholder("予定名")
						.setValue(item.name)
						.onChange((value) => {
							item.name = value.trim();
						});
					text.inputEl.addClass("rg-plan-name-input");
				})
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(item.start).onChange((value) => {
						item.start = value;
					});
				})
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(item.end).onChange((value) => {
						item.end = value;
					});
				});

			// よく使う色のワンクリック選択
			const swatches = setting.controlEl.createDiv({ cls: "rg-plan-swatches" });
			for (const color of PLAN_PRESET_COLORS) {
				const swatch = swatches.createEl("button", { cls: "rg-plan-swatch" });
				swatch.style.backgroundColor = color;
				if ((item.color ?? "").toLowerCase() === color) swatch.addClass("is-selected");
				swatch.setAttr("aria-label", `色: ${color}`);
				swatch.addEventListener("click", (e) => {
					e.preventDefault();
					item.color = color;
					this.render();
				});
			}

			setting
				.addColorPicker((picker) => {
					picker.setValue(item.color || "#808080").onChange((value) => {
						item.color = value;
					});
				})
				.addExtraButton((button) =>
					button
						.setIcon("rotate-ccw")
						.setTooltip("色を既定に戻す")
						.onClick(() => {
							item.color = "";
							this.render();
						})
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("削除")
						.onClick(() => {
							const index = this.items.indexOf(item);
							if (index >= 0) this.items.splice(index, 1);
							this.render();
						})
				);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

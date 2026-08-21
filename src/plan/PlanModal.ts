import { App, Modal, Setting } from "obsidian";
import { PLAN_STATUS_LABELS, PlanItem, PlanStatus } from "../settings";

/** よく使う色のプリセット(赤・オレンジ・緑・青・紫) */
const PLAN_PRESET_COLORS = ["#d9534f", "#e8883a", "#3f9e4d", "#3f7fd9", "#7a5fd0"];

/** 全体予定の一覧編集モーダル。保存を押すまで元データには反映しない */
export class PlanModal extends Modal {
	private items: PlanItem[];
	private onSave: (items: PlanItem[]) => void;

	constructor(app: App, items: PlanItem[], onSave: (items: PlanItem[]) => void) {
		super(app);
		this.items = items.map((item) => ({ ...item }));
		this.onSave = onSave;
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "全体予定の編集" });
		contentEl.createEl("p", {
			cls: "rg-plan-desc",
			text: "Redmineとは独立した予定です。ガントチャートの最上段に表示されます。",
		});

		this.items.forEach((item, index) => {
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
				})
				.addDropdown((dropdown) => {
					for (const [value, label] of Object.entries(PLAN_STATUS_LABELS)) {
						dropdown.addOption(value, label);
					}
					dropdown.setValue(item.status).onChange((value) => {
						item.status = value as PlanStatus;
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
						.setTooltip("色を既定(状態の色)に戻す")
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
							this.items.splice(index, 1);
							this.render();
						})
				);
		});

		new Setting(contentEl).addButton((button) =>
			button.setButtonText("予定を追加").onClick(() => {
				this.items.push({
					id: `plan-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
					name: "",
					start: "",
					end: "",
					status: "todo",
				});
				this.render();
			})
		);

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

	onClose(): void {
		this.contentEl.empty();
	}
}

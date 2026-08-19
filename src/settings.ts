import { App, PluginSettingTab, Setting } from "obsidian";
import type RedmineGanttPlugin from "./main";

export type GanttScale = "day" | "week" | "month";

export type FilterType = "parent" | "query";

/**
 * ガントビューのツールバーで切り替える表示条件。
 * 負荷対策として、プロジェクト全体の取得は提供しない。
 */
export interface GanttFilter {
	name: string;
	type: FilterType;
	/**
	 * parent: 親チケットのID(その配下ツリー全体を再帰的に取得して表示)
	 * query: 保存クエリのID。プロジェクトスコープのクエリは「プロジェクト識別子:クエリID」
	 */
	value: string;
}

export type ViewMode = "gantt" | "table";

/** 担当者の固定色。フィルタや絞り込みの選択にかかわらず常にこの色で表示する */
export interface AssigneeColor {
	/** Redmine上の表示名と完全一致させる */
	name: string;
	/** "#rrggbb" */
	color: string;
}

export type PlanStatus = "todo" | "doing" | "done";

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
	todo: "未着手",
	doing: "進行中",
	done: "完了",
};

/**
 * 全体予定の項目。Redmineとは独立してプラグイン内(data.json)に保存し、
 * ガントチャートの最上段に表示する。
 */
export interface PlanItem {
	id: string;
	name: string;
	/** "YYYY-MM-DD"。未定は空文字 */
	start: string;
	/** "YYYY-MM-DD"。未定は空文字 */
	end: string;
	status: PlanStatus;
}

export interface RedmineGanttSettings {
	baseUrl: string;
	apiKey: string;
	defaultScale: GanttScale;
	filters: GanttFilter[];
	/** 選択中フィルタの name。空文字は未選択 */
	activeFilter: string;
	viewMode: ViewMode;
	planItems: PlanItem[];
	assigneeColors: AssigneeColor[];
	/** テーブルの文字サイズ(px)。行の高さも連動する */
	tableFontSize: number;
}

export const DEFAULT_SETTINGS: RedmineGanttSettings = {
	baseUrl: "",
	apiKey: "",
	defaultScale: "week",
	filters: [],
	activeFilter: "",
	viewMode: "gantt",
	planItems: [],
	assigneeColors: [],
	tableFontSize: 11,
};

export class RedmineGanttSettingTab extends PluginSettingTab {
	plugin: RedmineGanttPlugin;

	constructor(app: App, plugin: RedmineGanttPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Redmine URL")
			.setDesc("例: https://redmine.example.local")
			.addText((text) =>
				text
					.setPlaceholder("https://redmine.example.local")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("APIキー")
			.setDesc(
				"Redmineの「個人設定」ページで確認できるAPIアクセスキー。" +
					"注意: キーはVault内の data.json に平文で保存されます。Vaultを同期している場合はキーも同期されます。"
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("API access key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("既定のスケール")
			.setDesc("ガントチャートを開いたときの時間軸スケール。")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("day", "日")
					.addOption("week", "週")
					.addOption("month", "月")
					.setValue(this.plugin.settings.defaultScale)
					.onChange(async (value) => {
						this.plugin.settings.defaultScale = value as GanttScale;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("テーブルの文字サイズ")
			.setDesc("px単位。行の高さ・バッジ類も文字サイズに連動して縮小/拡大します(既定: 11)。")
			.addSlider((slider) =>
				slider
					.setLimits(8, 16, 1)
					.setValue(this.plugin.settings.tableFontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.tableFontSize = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGanttViews();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("rotate-ccw")
					.setTooltip("既定値(11px)に戻す")
					.onClick(async () => {
						this.plugin.settings.tableFontSize = 11;
						await this.plugin.saveSettings();
						this.plugin.refreshGanttViews();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("表示フィルタ")
			.setHeading()
			.setDesc(
				"ガントビューで表示するチケットの取得条件。負荷を抑えるため、いずれかのフィルタの指定が必須です。" +
					"「親チケット配下」は指定チケットの配下ツリー全体を再帰的に取得します。" +
					"「保存クエリ」の値はクエリID(Redmineのチケット一覧URLの query_id= の数値)。" +
					"プロジェクトスコープのクエリは「プロジェクト識別子:クエリID」の形式で指定します。"
			);

		this.plugin.settings.filters.forEach((filter, index) => {
			const setting = new Setting(containerEl);
			setting
				.addText((text) =>
					text
						.setPlaceholder("表示名")
						.setValue(filter.name)
						.onChange(async (value) => {
							filter.name = value.trim();
							await this.plugin.saveSettings();
						})
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption("parent", "親チケット配下")
						.addOption("query", "保存クエリ")
						.setValue(filter.type)
						.onChange(async (value) => {
							filter.type = value as FilterType;
							await this.plugin.saveSettings();
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("チケットID / クエリID")
						.setValue(filter.value)
						.onChange(async (value) => {
							filter.value = value.trim();
							await this.plugin.saveSettings();
						})
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("削除")
						.onClick(async () => {
							this.plugin.settings.filters.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("フィルタを追加").onClick(async () => {
				this.plugin.settings.filters.push({
					name: "",
					type: "parent",
					value: "",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

		new Setting(containerEl)
			.setName("担当者の色分け")
			.setHeading()
			.setDesc(
				"登録した担当者は、表示フィルタや担当者絞り込みの選択にかかわらず常にこの色で表示されます" +
					"(ガントのバー・テーブルの担当者チップ)。名前はRedmine上の表示名と完全一致で指定してください。"
			);

		this.plugin.settings.assigneeColors.forEach((entry) => {
			new Setting(containerEl)
				.addText((text) =>
					text
						.setPlaceholder("担当者名(Redmineの表示名)")
						.setValue(entry.name)
						.onChange(async (value) => {
							entry.name = value.trim();
							await this.plugin.saveSettings();
						})
				)
				.addColorPicker((picker) =>
					picker.setValue(entry.color).onChange(async (value) => {
						entry.color = value;
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("削除")
						.onClick(async () => {
							this.plugin.settings.assigneeColors.remove(entry);
							await this.plugin.saveSettings();
							this.display();
						})
				);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("担当者を追加").onClick(async () => {
				this.plugin.settings.assigneeColors.push({ name: "", color: "#3f7fd9" });
				await this.plugin.saveSettings();
				this.display();
			})
		);

	}
}

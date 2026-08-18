import { App, PluginSettingTab, Setting } from "obsidian";
import type RedmineGanttPlugin from "./main";

export type GanttScale = "day" | "week" | "month";

export type FilterType = "project" | "parent" | "query";

/** ガントビューのツールバーで切り替える表示条件 */
export interface GanttFilter {
	name: string;
	type: FilterType;
	/**
	 * project: プロジェクト識別子またはID
	 * parent: 親チケットのID(その配下ツリー全体を表示)
	 * query: 保存クエリのID。プロジェクトスコープのクエリは「プロジェクト識別子:クエリID」
	 */
	value: string;
}

export type ViewMode = "gantt" | "table";

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
	projectId: string;
	includeClosed: boolean;
	defaultScale: GanttScale;
	filters: GanttFilter[];
	/** 選択中フィルタの name。空文字は既定(設定のプロジェクト) */
	activeFilter: string;
	viewMode: ViewMode;
	planItems: PlanItem[];
}

export const DEFAULT_SETTINGS: RedmineGanttSettings = {
	baseUrl: "",
	apiKey: "",
	projectId: "",
	includeClosed: false,
	defaultScale: "week",
	filters: [],
	activeFilter: "",
	viewMode: "gantt",
	planItems: [],
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
			.setName("プロジェクト")
			.setDesc(
				"表示するプロジェクトの識別子またはID(例: my-project)。空の場合は閲覧可能な全チケットを取得します。"
			)
			.addText((text) =>
				text
					.setPlaceholder("project-identifier")
					.setValue(this.plugin.settings.projectId)
					.onChange(async (value) => {
						this.plugin.settings.projectId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("完了チケットを含める")
			.setDesc("オンにすると終了ステータスのチケットも表示します。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeClosed)
					.onChange(async (value) => {
						this.plugin.settings.includeClosed = value;
						await this.plugin.saveSettings();
					})
			);

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
			.setName("表示フィルタ")
			.setHeading()
			.setDesc(
				"ガントビューのツールバーで切り替えられる表示条件。" +
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
						.addOption("project", "プロジェクト")
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
						.setPlaceholder("識別子 / チケットID / クエリID")
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
					type: "project",
					value: "",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

	}
}

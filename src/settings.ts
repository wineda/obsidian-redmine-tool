import { App, PluginSettingTab, Setting } from "obsidian";
import type RedmineGanttPlugin from "./main";

export type GanttScale = "day" | "week" | "month";

export interface RedmineGanttSettings {
	baseUrl: string;
	apiKey: string;
	projectId: string;
	includeClosed: boolean;
	defaultScale: GanttScale;
}

export const DEFAULT_SETTINGS: RedmineGanttSettings = {
	baseUrl: "",
	apiKey: "",
	projectId: "",
	includeClosed: false,
	defaultScale: "week",
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
	}
}

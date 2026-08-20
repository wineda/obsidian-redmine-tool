import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	RedmineGanttSettings,
	RedmineGanttSettingTab,
} from "./settings";
import { GanttView, VIEW_TYPE_REDMINE_GANTT } from "./gantt/GanttView";
import { RedmineWebView, VIEW_TYPE_REDMINE_WEB } from "./web/RedmineWebView";

export default class RedmineGanttPlugin extends Plugin {
	settings: RedmineGanttSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_REDMINE_GANTT, (leaf) => new GanttView(leaf, this));
		this.registerView(VIEW_TYPE_REDMINE_WEB, (leaf) => new RedmineWebView(leaf, this));

		this.addRibbonIcon("gantt-chart", "Redmine Gantt を開く", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-gantt-view",
			name: "ガントチャートを開く",
			callback: () => void this.activateView(),
		});

		this.addSettingTab(new RedmineGanttSettingTab(this.app, this));
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_REDMINE_GANTT);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_REDMINE_GANTT, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** Redmineの画面を右分割ペインのRedmineビューで開く(既に開いていればURLを差し替え) */
	async openRedmineWeb(url: string): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_REDMINE_WEB);
		let leaf: WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("split", "vertical");
			await leaf.setViewState({ type: VIEW_TYPE_REDMINE_WEB, active: false });
		}
		const view = leaf.view;
		if (view instanceof RedmineWebView) {
			view.navigate(url);
		}
		await workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// 旧バージョンの「プロジェクト」型フィルタは負荷対策で廃止したため読み捨てる
		this.settings.filters = this.settings.filters.filter(
			(f) => f.type === "parent" || f.type === "query"
		);
		if (
			this.settings.activeFilter &&
			!this.settings.filters.some((f) => f.name === this.settings.activeFilter)
		) {
			this.settings.activeFilter = "";
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 開いているガントビューを再描画する(設定変更の即時反映用) */
	refreshGanttViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_REDMINE_GANTT)) {
			const view = leaf.view;
			if (view instanceof GanttView) {
				view.rerender();
			}
		}
	}
}

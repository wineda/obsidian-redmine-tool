import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	RedmineGanttSettings,
	RedmineGanttSettingTab,
} from "./settings";
import { GanttView, VIEW_TYPE_REDMINE_GANTT } from "./gantt/GanttView";

export default class RedmineGanttPlugin extends Plugin {
	settings: RedmineGanttSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_REDMINE_GANTT, (leaf) => new GanttView(leaf, this));

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

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

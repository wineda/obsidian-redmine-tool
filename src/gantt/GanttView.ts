import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type RedmineGanttPlugin from "../main";
import { RedmineClient } from "../redmine/client";
import { buildGanttModel, GanttModel } from "../redmine/mapper";
import type { GanttScale } from "../settings";
import { renderGantt } from "./renderer";

export const VIEW_TYPE_REDMINE_GANTT = "redmine-gantt-view";

export class GanttView extends ItemView {
	private plugin: RedmineGanttPlugin;
	private scale: GanttScale;
	private model: GanttModel | null = null;
	private statusEl: HTMLElement | null = null;
	private chartEl: HTMLElement | null = null;
	private loading = false;

	constructor(leaf: WorkspaceLeaf, plugin: RedmineGanttPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.scale = plugin.settings.defaultScale;
	}

	getViewType(): string {
		return VIEW_TYPE_REDMINE_GANTT;
	}

	getDisplayText(): string {
		return "Redmine Gantt";
	}

	getIcon(): string {
		return "gantt-chart";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("rg-view");

		const toolbar = container.createDiv({ cls: "rg-toolbar" });

		const refreshBtn = toolbar.createEl("button", { cls: "rg-toolbar-btn" });
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.setAttr("aria-label", "再取得");
		refreshBtn.addEventListener("click", () => void this.refresh());

		const scaleSelect = toolbar.createEl("select", { cls: "dropdown rg-scale-select" });
		for (const [value, label] of [
			["day", "日"],
			["week", "週"],
			["month", "月"],
		] as const) {
			const option = scaleSelect.createEl("option", { text: label });
			option.value = value;
		}
		scaleSelect.value = this.scale;
		scaleSelect.addEventListener("change", () => {
			this.scale = scaleSelect.value as GanttScale;
			this.renderChart();
		});

		this.statusEl = toolbar.createDiv({ cls: "rg-status" });
		this.chartEl = container.createDiv({ cls: "rg-chart-container" });

		await this.refresh();
	}

	async refresh(): Promise<void> {
		if (this.loading || !this.chartEl) return;
		this.loading = true;
		this.setStatus("取得中…");
		try {
			const client = new RedmineClient(this.plugin.settings);
			const issues = await client.fetchIssues();
			this.model = buildGanttModel(issues);
			this.renderChart();
			const now = new Date();
			const hh = String(now.getHours()).padStart(2, "0");
			const mm = String(now.getMinutes()).padStart(2, "0");
			this.setStatus(`${issues.length}件 / 最終更新 ${hh}:${mm}`);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.setStatus("取得に失敗しました");
			this.chartEl.empty();
			this.chartEl.createDiv({ cls: "rg-error", text: message });
			new Notice(`Redmine Gantt: ${message}`);
		} finally {
			this.loading = false;
		}
	}

	private renderChart(): void {
		if (!this.chartEl || !this.model) return;
		const client = new RedmineClient(this.plugin.settings);
		renderGantt(this.chartEl, this.model, this.scale, {
			issueUrl: (id) => client.issueUrl(id),
		});
	}

	private setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}

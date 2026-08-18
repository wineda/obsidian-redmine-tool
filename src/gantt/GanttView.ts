import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type RedmineGanttPlugin from "../main";
import { RedmineClient } from "../redmine/client";
import { buildGanttModel, GanttModel } from "../redmine/mapper";
import type { GanttFilter, GanttScale, PlanItem, ViewMode } from "../settings";
import { PlanModal } from "../plan/PlanModal";
import { PlanRow, renderGantt } from "./renderer";
import { renderTable } from "./table";

export const VIEW_TYPE_REDMINE_GANTT = "redmine-gantt-view";

/** "YYYY-MM-DD" をローカルタイムの日付として解釈する。空文字は null */
function parsePlanDate(s: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

export class GanttView extends ItemView {
	private plugin: RedmineGanttPlugin;
	private scale: GanttScale;
	private model: GanttModel | null = null;
	private statusEl: HTMLElement | null = null;
	private chartEl: HTMLElement | null = null;
	private scaleSelect: HTMLSelectElement | null = null;
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

		// 表示モード切替(ガント / テーブル)
		const modeSelect = toolbar.createEl("select", { cls: "dropdown rg-mode-select" });
		for (const [value, label] of [
			["gantt", "ガント"],
			["table", "テーブル"],
		] as const) {
			const option = modeSelect.createEl("option", { text: label });
			option.value = value;
		}
		modeSelect.value = this.plugin.settings.viewMode;
		modeSelect.addEventListener("change", () => {
			this.plugin.settings.viewMode = modeSelect.value as ViewMode;
			void this.plugin.saveSettings();
			this.updateScaleVisibility();
			this.renderChart();
		});

		const filterSelect = toolbar.createEl("select", { cls: "dropdown rg-filter-select" });
		const defaultOption = filterSelect.createEl("option", {
			text: this.plugin.settings.projectId
				? `既定 (${this.plugin.settings.projectId})`
				: "既定 (全チケット)",
		});
		defaultOption.value = "";
		for (const filter of this.plugin.settings.filters) {
			if (!filter.name) continue;
			const option = filterSelect.createEl("option", { text: filter.name });
			option.value = filter.name;
		}
		filterSelect.value = this.activeFilter() ? this.plugin.settings.activeFilter : "";
		filterSelect.addEventListener("change", () => {
			this.plugin.settings.activeFilter = filterSelect.value;
			void this.plugin.saveSettings();
			void this.refresh();
		});

		this.scaleSelect = toolbar.createEl("select", { cls: "dropdown rg-scale-select" });
		for (const [value, label] of [
			["day", "日"],
			["week", "週"],
			["month", "月"],
		] as const) {
			const option = this.scaleSelect.createEl("option", { text: label });
			option.value = value;
		}
		this.scaleSelect.value = this.scale;
		this.scaleSelect.addEventListener("change", () => {
			this.scale = this.scaleSelect!.value as GanttScale;
			this.renderChart();
		});

		// 全体予定の編集
		const planBtn = toolbar.createEl("button", { cls: "rg-toolbar-btn" });
		setIcon(planBtn, "calendar-range");
		planBtn.setAttr("aria-label", "全体予定を編集");
		planBtn.addEventListener("click", () => {
			new PlanModal(this.app, this.plugin.settings.planItems, (items) => {
				this.plugin.settings.planItems = items;
				void this.plugin.saveSettings();
				this.renderChart();
			}).open();
		});

		this.statusEl = toolbar.createDiv({ cls: "rg-status" });
		this.chartEl = container.createDiv({ cls: "rg-chart-container" });
		this.updateScaleVisibility();

		await this.refresh();
	}

	/** 選択中の表示フィルタ。既定(設定のプロジェクト)のときは null */
	private activeFilter(): GanttFilter | null {
		const name = this.plugin.settings.activeFilter;
		if (!name) return null;
		return this.plugin.settings.filters.find((f) => f.name === name) ?? null;
	}

	private updateScaleVisibility(): void {
		if (!this.scaleSelect) return;
		this.scaleSelect.style.display =
			this.plugin.settings.viewMode === "table" ? "none" : "";
	}

	async refresh(): Promise<void> {
		if (this.loading || !this.chartEl) return;
		this.loading = true;
		this.setStatus("取得中…");
		try {
			const client = new RedmineClient(this.plugin.settings);
			const issues = await client.fetchIssues(this.activeFilter());
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

	/** 全体予定を表示用に変換する(開始日順、日付なしは末尾) */
	private planRows(): PlanRow[] {
		const rows = this.plugin.settings.planItems.map((item: PlanItem): PlanRow => {
			let start = parsePlanDate(item.start);
			let end = parsePlanDate(item.end);
			if (start && end && start > end) [start, end] = [end, start];
			// 片方だけ設定されている場合は1日分の予定として扱う
			if (start && !end) end = start;
			if (!start && end) start = end;
			return { name: item.name, start, end, status: item.status };
		});
		return rows.sort((a, b) => {
			if (!a.start) return 1;
			if (!b.start) return -1;
			return a.start.getTime() - b.start.getTime();
		});
	}

	private renderChart(): void {
		if (!this.chartEl || !this.model) return;
		const client = new RedmineClient(this.plugin.settings);
		const opts = { issueUrl: (id: number) => client.issueUrl(id) };
		if (this.plugin.settings.viewMode === "table") {
			renderTable(this.chartEl, this.model, opts);
		} else {
			renderGantt(this.chartEl, this.model, this.planRows(), this.scale, opts);
		}
	}

	private setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}

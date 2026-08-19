import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type RedmineGanttPlugin from "../main";
import { RedmineClient } from "../redmine/client";
import { buildGanttModel, GanttModel } from "../redmine/mapper";
import type { RedmineIssue } from "../redmine/types";
import type { GanttFilter, GanttScale, PlanItem, ViewMode } from "../settings";
import { PlanModal } from "../plan/PlanModal";
import { PlanRow, renderGantt } from "./renderer";
import { defaultTableWidths, renderTable } from "./table";

export const VIEW_TYPE_REDMINE_GANTT = "redmine-gantt-view";

/** 担当者絞り込みモードの配色(ライト/ダーク両テーマで判別しやすい中間トーン) */
const ASSIGNEE_PALETTE = [
	"#3f7fd9",
	"#d94f70",
	"#3f9e4d",
	"#e8883a",
	"#7a5fd0",
	"#2f9e9b",
	"#b0578d",
	"#98771d",
];

/** 担当者なしを表す内部キー(GanttTask.assignee の空文字と対応) */
const NO_ASSIGNEE = "";
const NO_ASSIGNEE_LABEL = "(担当者なし)";

/** "YYYY-MM-DD" をローカルタイムの日付として解釈する。空文字は null */
function parsePlanDate(s: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

export class GanttView extends ItemView {
	private plugin: RedmineGanttPlugin;
	private scale: GanttScale;
	private rawIssues: RedmineIssue[] | null = null;
	private statusEl: HTMLElement | null = null;
	private chartEl: HTMLElement | null = null;
	private scaleSelect: HTMLSelectElement | null = null;
	private assigneePanel: HTMLElement | null = null;
	private assigneeBtn: HTMLElement | null = null;
	private loading = false;
	private lastFetchedAt: string | null = null;

	// 表示側のフィルタ状態(セッション内のみ保持)
	private showClosed = false;
	private selectedAssignees = new Set<string>();
	private tableWidths: number[] = defaultTableWidths();

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
			this.renderView();
		});

		const filterSelect = toolbar.createEl("select", { cls: "dropdown rg-filter-select" });
		const namedFilters = this.plugin.settings.filters.filter((f) => f.name);
		if (namedFilters.length === 0) {
			const option = filterSelect.createEl("option", { text: "(フィルタ未設定)" });
			option.value = "";
			filterSelect.disabled = true;
		} else {
			for (const filter of namedFilters) {
				const option = filterSelect.createEl("option", { text: filter.name });
				option.value = filter.name;
			}
			// 保存されている選択が無効なら先頭のフィルタにフォールバック
			if (!this.activeFilter()) {
				this.plugin.settings.activeFilter = namedFilters[0].name;
				void this.plugin.saveSettings();
			}
			filterSelect.value = this.plugin.settings.activeFilter;
		}
		filterSelect.addEventListener("change", () => {
			this.plugin.settings.activeFilter = filterSelect.value;
			void this.plugin.saveSettings();
			this.selectedAssignees.clear();
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
			this.renderView();
		});

		// 完了チケットの表示切替(既定: 非表示)
		const closedLabel = toolbar.createEl("label", { cls: "rg-check" });
		const closedCheckbox = closedLabel.createEl("input", { type: "checkbox" });
		closedLabel.appendText("完了");
		closedCheckbox.checked = this.showClosed;
		closedCheckbox.addEventListener("change", () => {
			this.showClosed = closedCheckbox.checked;
			this.renderView();
		});

		// 担当者絞り込み
		this.assigneeBtn = toolbar.createEl("button", { cls: "rg-toolbar-btn" });
		setIcon(this.assigneeBtn, "users");
		this.assigneeBtn.setAttr("aria-label", "担当者で絞り込み");
		this.assigneeBtn.addEventListener("click", () => this.toggleAssigneePanel());

		// 全体予定の編集
		const planBtn = toolbar.createEl("button", { cls: "rg-toolbar-btn" });
		setIcon(planBtn, "calendar-range");
		planBtn.setAttr("aria-label", "全体予定を編集");
		planBtn.addEventListener("click", () => {
			new PlanModal(this.app, this.plugin.settings.planItems, (items) => {
				this.plugin.settings.planItems = items;
				void this.plugin.saveSettings();
				this.renderView();
			}).open();
		});

		this.statusEl = toolbar.createDiv({ cls: "rg-status" });

		this.assigneePanel = toolbar.createDiv({ cls: "rg-assignee-panel" });
		this.assigneePanel.hide();
		this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
			const target = e.target as Node;
			if (
				this.assigneePanel &&
				this.assigneePanel.isShown() &&
				!this.assigneePanel.contains(target) &&
				!this.assigneeBtn?.contains(target)
			) {
				this.assigneePanel.hide();
			}
		});

		this.chartEl = container.createDiv({ cls: "rg-chart-container" });
		this.updateScaleVisibility();

		await this.refresh();
	}

	/** 選択中の表示フィルタ。未選択・無効なときは null */
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
		const filter = this.activeFilter();
		if (!filter) {
			this.rawIssues = null;
			this.setStatus("フィルタ未設定");
			this.chartEl.empty();
			this.chartEl.createDiv({
				cls: "rg-empty",
				text:
					"表示フィルタが設定されていません。\n" +
					"設定 → Redmine Gantt → 「表示フィルタ」で、親チケット配下または保存クエリのフィルタを追加してください。\n" +
					"(負荷を抑えるため、プロジェクト全体の一括取得は行いません)",
			});
			return;
		}
		this.loading = true;
		this.setStatus("取得中…");
		try {
			const client = new RedmineClient(this.plugin.settings);
			this.rawIssues = await client.fetchIssues(filter);
			const now = new Date();
			const hh = String(now.getHours()).padStart(2, "0");
			const mm = String(now.getMinutes()).padStart(2, "0");
			this.lastFetchedAt = `${hh}:${mm}`;
			this.renderView();
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

	/** 表示側フィルタ(完了・担当者)を適用したチケット群 */
	private visibleIssues(): RedmineIssue[] {
		if (!this.rawIssues) return [];
		const filter = this.activeFilter();
		const rootId = filter?.type === "parent" ? Number(filter.value.trim()) : NaN;
		let issues = this.rawIssues;
		if (!this.showClosed) {
			// 親チケット配下フィルタのルートは表示の起点なので残す
			issues = issues.filter((issue) => !issue.closed_on || issue.id === rootId);
		}
		if (this.selectedAssignees.size > 0) {
			issues = issues.filter((issue) =>
				this.selectedAssignees.has(issue.assigned_to?.name ?? NO_ASSIGNEE)
			);
		}
		return issues;
	}

	/** 担当者絞り込みモード時の担当者→色。モード無効・対象外は null */
	private assigneeColor(assignee: string): string | null {
		if (this.selectedAssignees.size === 0) return null;
		const sorted = Array.from(this.selectedAssignees).sort();
		const index = sorted.indexOf(assignee);
		if (index < 0) return null;
		return ASSIGNEE_PALETTE[index % ASSIGNEE_PALETTE.length];
	}

	private toggleAssigneePanel(): void {
		if (!this.assigneePanel || !this.assigneeBtn) return;
		if (this.assigneePanel.isShown()) {
			this.assigneePanel.hide();
			return;
		}
		this.renderAssigneePanel();
		this.assigneePanel.style.left = `${this.assigneeBtn.offsetLeft}px`;
		this.assigneePanel.show();
	}

	private renderAssigneePanel(): void {
		const panel = this.assigneePanel;
		if (!panel) return;
		panel.empty();
		panel.createDiv({ cls: "rg-assignee-panel-title", text: "担当者で絞り込み" });

		if (!this.rawIssues || this.rawIssues.length === 0) {
			panel.createDiv({ cls: "rg-assignee-empty", text: "チケットがありません" });
			return;
		}

		// 取得済みチケットから担当者一覧(件数付き)を作る
		const counts = new Map<string, number>();
		for (const issue of this.rawIssues) {
			const name = issue.assigned_to?.name ?? NO_ASSIGNEE;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		const names = Array.from(counts.keys()).sort((a, b) => {
			if (a === NO_ASSIGNEE) return 1;
			if (b === NO_ASSIGNEE) return -1;
			return a.localeCompare(b, "ja");
		});

		for (const name of names) {
			const item = panel.createEl("label", { cls: "rg-assignee-item" });
			const checkbox = item.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selectedAssignees.has(name);
			const dot = item.createSpan({ cls: "rg-assignee-dot" });
			const color = this.assigneeColor(name);
			if (color) dot.style.backgroundColor = color;
			item.createSpan({ text: name === NO_ASSIGNEE ? NO_ASSIGNEE_LABEL : name });
			item.createSpan({ cls: "rg-assignee-count", text: String(counts.get(name)) });
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedAssignees.add(name);
				} else {
					this.selectedAssignees.delete(name);
				}
				this.renderAssigneePanel();
				this.renderView();
			});
		}

		const footer = panel.createDiv({ cls: "rg-assignee-footer" });
		const clearBtn = footer.createEl("button", { text: "選択解除" });
		clearBtn.disabled = this.selectedAssignees.size === 0;
		clearBtn.addEventListener("click", () => {
			this.selectedAssignees.clear();
			this.renderAssigneePanel();
			this.renderView();
		});
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

	/** 表示側フィルタを適用して再描画する(再取得はしない) */
	private renderView(): void {
		if (!this.chartEl || !this.rawIssues) return;
		const visible = this.visibleIssues();
		const model: GanttModel = buildGanttModel(visible);
		const client = new RedmineClient(this.plugin.settings);
		const opts = {
			issueUrl: (id: number) => client.issueUrl(id),
			assigneeColor: (assignee: string) => this.assigneeColor(assignee),
		};
		if (this.plugin.settings.viewMode === "table") {
			renderTable(this.chartEl, model, { ...opts, widths: this.tableWidths });
		} else {
			renderGantt(this.chartEl, model, this.planRows(), this.scale, opts);
		}
		const suffix = this.lastFetchedAt ? ` / 最終更新 ${this.lastFetchedAt}` : "";
		this.setStatus(`表示 ${visible.length} / 取得 ${this.rawIssues.length}件${suffix}`);
	}

	private setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}

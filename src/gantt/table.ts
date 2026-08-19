import { setIcon } from "obsidian";
import type { GanttModel, GanttTask } from "../redmine/mapper";
import { formatDate, RenderOptions } from "./renderer";
import { diffDays } from "./scale";

const INDENT = 16;
const MIN_COL_WIDTH = 48;

const COLUMNS: { label: string; width: number; cls?: string }[] = [
	{ label: "#", width: 72 },
	{ label: "トラッカー", width: 100 },
	{ label: "題名", width: 360 },
	{ label: "ステータス", width: 120 },
	{ label: "担当者", width: 110 },
	{ label: "状況", width: 104 },
	{ label: "開始日", width: 96, cls: "rg-td-date" },
	{ label: "期日", width: 96, cls: "rg-td-date" },
	{ label: "納期", width: 96, cls: "rg-td-date" },
	{ label: "進捗", width: 96 },
	{ label: "", width: 44 },
];

export function defaultTableWidths(): number[] {
	return COLUMNS.map((c) => c.width);
}

export interface TableOptions extends RenderOptions {
	/** 列幅(px)。参照を保持したまま書き換えることで呼び出し側に永続される */
	widths: number[];
	/** 編集ボタン押下時に呼ばれる。未指定なら編集列を出さない */
	onEdit?: (issueId: number) => void;
}

/** チケット一覧のテーブル表示。日付未設定のチケットも同じ表に含める */
export function renderTable(container: HTMLElement, model: GanttModel, opts: TableOptions): void {
	container.empty();

	const all = model.tasks;
	if (all.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const wrap = container.createDiv({ cls: "rg-table-wrap" });
	const table = wrap.createEl("table", { cls: "rg-table" });

	const colgroup = table.createEl("colgroup");
	const cols: HTMLTableColElement[] = COLUMNS.map((_, i) => {
		const col = colgroup.createEl("col");
		col.style.width = `${opts.widths[i]}px`;
		return col;
	});

	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	COLUMNS.forEach((column, i) => {
		const th = headRow.createEl("th", { text: column.label });
		// 列幅のドラッグリサイズ
		const resizer = th.createDiv({ cls: "rg-col-resizer" });
		resizer.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = opts.widths[i];
			const onMove = (ev: MouseEvent) => {
				opts.widths[i] = Math.max(MIN_COL_WIDTH, startWidth + ev.clientX - startX);
				cols[i].style.width = `${opts.widths[i]}px`;
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				document.body.removeClass("rg-resizing");
			};
			document.body.addClass("rg-resizing");
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	});

	const tbody = table.createEl("tbody");
	for (const task of all) {
		renderRow(tbody, task, opts);
	}
}

function renderRow(tbody: HTMLElement, task: GanttTask, opts: TableOptions): void {
	const row = tbody.createEl("tr");
	if (task.isClosed) row.addClass("rg-row-closed");
	if (task.isContext) row.addClass("rg-row-context");

	// #
	const idCell = row.createEl("td", { cls: "rg-td-id" });
	idCell.createEl("a", {
		cls: "rg-issue-link",
		text: `#${task.id}`,
		href: opts.issueUrl(task.id),
	});

	// トラッカー
	const trackerCell = row.createEl("td");
	trackerCell.createSpan({ cls: "rg-tracker", text: task.tracker });

	// 題名
	const subjectCell = row.createEl("td", { cls: "rg-td-subject" });
	subjectCell.style.paddingLeft = `${10 + task.depth * INDENT}px`;
	const link = subjectCell.createEl("a", {
		cls: "rg-issue-link",
		text: task.subject,
		href: opts.issueUrl(task.id),
	});
	link.setAttr("title", task.subject);

	// ステータス
	const statusCell = row.createEl("td");
	statusCell.createSpan({
		cls: "rg-badge" + (task.isClosed ? " rg-badge-closed" : ""),
		text: task.status,
	});

	// 担当者
	const assigneeCell = row.createEl("td");
	if (task.assignee) {
		const chip = assigneeCell.createSpan({ cls: "rg-assignee-chip", text: task.assignee });
		const color = opts.assigneeColor(task.assignee);
		if (color) {
			chip.style.backgroundColor = color;
			chip.addClass("rg-assignee-chip-colored");
		}
	} else {
		assigneeCell.setText("-");
		assigneeCell.addClass("rg-td-empty");
	}

	// 状況(現在日と期日/納期の比較。2週間より先は表示しない)
	const situationCell = row.createEl("td");
	const situation = computeSituation(task);
	if (situation) {
		const el = situationCell.createSpan({
			cls: `rg-due rg-due-${situation.kind}`,
			text: situation.text,
		});
		if (situation.title) el.setAttr("title", situation.title);
	}

	// 開始日 / 期日(フォールバック値は表示せずRedmineの生の値のみ)
	row.createEl("td", {
		cls: "rg-td-date",
		text: task.start && !task.startIsFallback ? formatDate(task.start) : "-",
	});

	row.createEl("td", {
		cls: "rg-td-date",
		text: task.due && !task.dueIsFallback ? formatDate(task.due) : "-",
	});

	// 納期(カスタムフィールド)
	row.createEl("td", { cls: "rg-td-date", text: task.delivery || "-" });

	// 進捗
	const ratioCell = row.createEl("td", { cls: "rg-td-ratio" });
	const ratioWrap = ratioCell.createDiv({ cls: "rg-ratio-wrap" });
	const bar = ratioWrap.createDiv({ cls: "rg-progress" });
	const fill = bar.createDiv({ cls: "rg-progress-fill" });
	fill.style.width = `${Math.min(task.doneRatio, 100)}%`;
	if (task.doneRatio >= 100) fill.addClass("rg-progress-done");
	ratioWrap.createSpan({ cls: "rg-progress-text", text: `${task.doneRatio}%` });

	// 編集
	const editCell = row.createEl("td", { cls: "rg-td-edit" });
	if (opts.onEdit) {
		const btn = editCell.createEl("button", { cls: "rg-edit-btn" });
		setIcon(btn, "pencil");
		btn.setAttr("aria-label", `#${task.id} を編集`);
		btn.addEventListener("click", () => opts.onEdit!(task.id));
	}
}

/** "YYYY-MM-DD" 形式の納期文字列を日付として解釈する */
function parseDeliveryDate(s: string): Date | null {
	const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// この日数以内のとき「あとXX日」バッジを表示する(それより先は表示しない)
const DUE_SOON_DAYS = 14;

interface Situation {
	text: string;
	kind: "over" | "soon";
	title?: string;
}

/**
 * 現在日と期日(なければ納期)を比較した状況表示。
 * 完了チケット・比較対象の日付がないチケット・2週間より先のチケットは null(表示なし)
 */
function computeSituation(task: GanttTask): Situation | null {
	if (task.isClosed || task.isContext) return null;
	const due = task.due && !task.dueIsFallback ? task.due : null;
	const delivery = parseDeliveryDate(task.delivery);
	const label = due ? "期日" : delivery ? "納期" : null;
	const target = due ?? delivery;
	if (!label || !target) return null;

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diff = diffDays(today, target);
	if (diff < 0) {
		return { text: `${label}超過`, kind: "over", title: `${-diff}日超過 (${formatDate(target)})` };
	}
	if (diff > DUE_SOON_DAYS) return null;
	if (diff === 0) {
		return { text: `${label}本日`, kind: "soon" };
	}
	return { text: `${label}あと${diff}日`, kind: "soon" };
}

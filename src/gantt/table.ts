import { Menu, Notice, setIcon } from "obsidian";
import type { GanttModel, GanttTask } from "../redmine/mapper";
import { formatDate, RenderOptions, rowHeightFor } from "./renderer";
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

/** 状況(期日・納期)による絞り込み条件 */
export type SituationFilter = "all" | "week1" | "week2" | "overdue";

/** テーブルの分割単位 */
export type TableGroupBy = "none" | "tracker" | "assignee";

export interface TableOptions extends RenderOptions {
	/** 列幅(px)。参照を保持したまま書き換えることで呼び出し側に永続される */
	widths: number[];
	/** 編集ボタン押下時に呼ばれる。未指定なら編集列を出さない */
	onEdit?: (issueId: number) => void;
	/** 題名の部分一致フィルタ(空文字・未指定は無条件) */
	subjectFilter?: string;
	/** 状況(期日・納期)による絞り込み */
	situationFilter?: SituationFilter;
	/** トラッカー/担当者ごとにテーブルを分ける */
	groupBy?: TableGroupBy;
}

/** チケット一覧のテーブル表示。日付未設定のチケットも同じ表に含める */
export function renderTable(container: HTMLElement, model: GanttModel, opts: TableOptions): void {
	container.empty();

	let tasks = model.tasks;
	const query = (opts.subjectFilter ?? "").trim().toLowerCase();
	if (query) {
		tasks = tasks.filter((task) => task.subject.toLowerCase().includes(query));
	}
	const situation = opts.situationFilter ?? "all";
	if (situation !== "all") {
		tasks = tasks.filter((task) => matchesSituationFilter(task, situation));
	}

	if (tasks.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const wrap = container.createDiv({ cls: "rg-table-wrap" });
	// 全テーブルを束ねて、リサイズ時に一括で列幅・テーブル幅をそろえる
	const tableRegistry: TableRefs[] = [];
	const groupBy = opts.groupBy ?? "none";
	if (groupBy === "none") {
		buildTable(wrap, tasks, opts, tableRegistry);
		return;
	}

	// トラッカー/担当者ごとに分割(チケットの並び順は元のツリー順を維持)
	const groups = new Map<string, GanttTask[]>();
	for (const task of tasks) {
		const key = groupBy === "tracker" ? task.tracker : task.assignee;
		const list = groups.get(key);
		if (list) {
			list.push(task);
		} else {
			groups.set(key, [task]);
		}
	}
	const keys = Array.from(groups.keys()).sort((a, b) => {
		if (a === "") return 1;
		if (b === "") return -1;
		return a.localeCompare(b, "ja");
	});
	for (const key of keys) {
		const list = groups.get(key)!;
		const label =
			key !== "" ? key : groupBy === "assignee" ? "(担当者なし)" : "(トラッカーなし)";
		const title = wrap.createDiv({ cls: "rg-table-group-title" });
		title.style.fontSize = `${opts.fontSize + 2}px`;
		title.setText(`${label}(${list.length}件)`);
		buildTable(wrap, list, opts, tableRegistry);
	}
}

interface TableRefs {
	table: HTMLTableElement;
	cols: HTMLTableColElement[];
}

function totalWidth(widths: number[]): number {
	return widths.reduce((sum, w) => sum + w, 0);
}

function buildTable(
	wrap: HTMLElement,
	tasks: GanttTask[],
	opts: TableOptions,
	tableRegistry: TableRefs[]
): void {
	const table = wrap.createEl("table", { cls: "rg-table" });
	table.style.fontSize = `${opts.fontSize}px`;
	// table-layout: fixed はテーブル幅の明示指定がないと効かない(自動レイアウトに
	// なり内容の長さで列幅がずれる)ため、列幅の合計を常にテーブル幅として設定する
	table.style.width = `${totalWidth(opts.widths)}px`;

	const colgroup = table.createEl("colgroup");
	const cols: HTMLTableColElement[] = COLUMNS.map((_, i) => {
		const col = colgroup.createEl("col");
		col.style.width = `${opts.widths[i]}px`;
		return col;
	});
	tableRegistry.push({ table, cols });

	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	COLUMNS.forEach((column, i) => {
		const th = headRow.createEl("th", { text: column.label });
		// 列幅のドラッグリサイズ(分割表示中の全テーブルに同じ幅を適用する)
		const resizer = th.createDiv({ cls: "rg-col-resizer" });
		resizer.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = opts.widths[i];
			const onMove = (ev: MouseEvent) => {
				opts.widths[i] = Math.max(MIN_COL_WIDTH, startWidth + ev.clientX - startX);
				const total = totalWidth(opts.widths);
				for (const refs of tableRegistry) {
					refs.cols[i].style.width = `${opts.widths[i]}px`;
					refs.table.style.width = `${total}px`;
				}
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
	for (const task of tasks) {
		renderRow(tbody, task, opts);
	}
}

function renderRow(tbody: HTMLElement, task: GanttTask, opts: TableOptions): void {
	const row = tbody.createEl("tr");
	// ガントチャートの行と同じ高さにそろえる
	row.style.height = `${rowHeightFor(opts.fontSize)}px`;
	if (task.isClosed) row.addClass("rg-row-closed");
	if (task.isContext) row.addClass("rg-row-context");

	// 右クリックでチケット内容(番号・トラッカー 題名・URL)をコピー
	row.addEventListener("contextmenu", (e: MouseEvent) => {
		e.preventDefault();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("チケット内容をコピー")
				.setIcon("copy")
				.onClick(async () => {
					const due = task.due && !task.dueIsFallback ? formatDate(task.due) : "-";
					const text = [
						`#${task.id}`,
						`${task.tracker} ${task.subject}`,
						`担当者: ${task.assignee || "-"}`,
						`期日: ${due}`,
						`納期: ${task.delivery || "-"}`,
						opts.issueUrl(task.id),
					].join("\n");
					await navigator.clipboard.writeText(text);
					new Notice(`#${task.id} をコピーしました`);
				})
		);
		menu.showAtMouseEvent(e);
	});

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
		// Obsidian本体の button { height: var(--input-height) }(約30px)が行を
		// 押し広げるのを打ち消す。styles.css が更新されていない環境でも効くよう
		// インラインで指定する
		btn.style.height = "auto";
		btn.style.minHeight = "0";
		btn.style.lineHeight = "0";
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
 * 現在日と比較対象の日付(期日、なければ納期)の情報。
 * 完了・コンテキスト・比較対象の日付がないチケットは null
 */
function situationInfo(task: GanttTask): { label: string; target: Date; diff: number } | null {
	if (task.isClosed || task.isContext) return null;
	const due = task.due && !task.dueIsFallback ? task.due : null;
	const delivery = parseDeliveryDate(task.delivery);
	const label = due ? "期日" : delivery ? "納期" : null;
	const target = due ?? delivery;
	if (!label || !target) return null;

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return { label, target, diff: diffDays(today, target) };
}

/** 状況フィルタの判定。比較対象の日付がないチケットは常に対象外 */
function matchesSituationFilter(task: GanttTask, filter: SituationFilter): boolean {
	const info = situationInfo(task);
	if (!info) return false;
	if (filter === "overdue") return info.diff < 0;
	if (filter === "week1") return info.diff >= 0 && info.diff <= 7;
	return info.diff >= 0 && info.diff <= 14;
}

/**
 * 現在日と期日(なければ納期)を比較した状況表示。
 * 完了チケット・比較対象の日付がないチケット・2週間より先のチケットは null(表示なし)
 */
function computeSituation(task: GanttTask): Situation | null {
	const info = situationInfo(task);
	if (!info) return null;
	const { label, target, diff } = info;
	if (diff < 0) {
		return { text: `${label}超過`, kind: "over", title: `${-diff}日超過 (${formatDate(target)})` };
	}
	if (diff > DUE_SOON_DAYS) return null;
	if (diff === 0) {
		return { text: `${label}本日`, kind: "soon" };
	}
	return { text: `${label}あと${diff}日`, kind: "soon" };
}

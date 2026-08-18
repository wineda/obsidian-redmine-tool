import type { GanttModel, GanttTask } from "../redmine/mapper";
import { formatDate, RenderOptions } from "./renderer";

const INDENT = 16;

/** チケット一覧のテーブル表示。日付未設定のチケットも同じ表に含める */
export function renderTable(container: HTMLElement, model: GanttModel, opts: RenderOptions): void {
	container.empty();

	const all = [...model.tasks, ...model.undated];
	if (all.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const wrap = container.createDiv({ cls: "rg-table-wrap" });
	const table = wrap.createEl("table", { cls: "rg-table" });

	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	for (const label of ["#", "題名", "ステータス", "担当者", "開始日", "期日", "進捗"]) {
		headRow.createEl("th", { text: label });
	}

	const tbody = table.createEl("tbody");
	for (const task of all) {
		const row = tbody.createEl("tr");
		if (task.isClosed) row.addClass("rg-row-closed");

		const idCell = row.createEl("td", { cls: "rg-td-id" });
		idCell.createEl("a", {
			cls: "rg-issue-link",
			text: `#${task.id}`,
			href: opts.issueUrl(task.id),
		});

		const subjectCell = row.createEl("td", { cls: "rg-td-subject" });
		subjectCell.style.paddingLeft = `${8 + task.depth * INDENT}px`;
		subjectCell.createEl("a", {
			cls: "rg-issue-link",
			text: task.subject,
			href: opts.issueUrl(task.id),
		});

		row.createEl("td", { text: task.status });
		row.createEl("td", { text: task.assignee || "-" });
		row.createEl("td", {
			cls: "rg-td-date",
			text: task.start && !task.startIsFallback ? formatDate(task.start) : "-",
		});
		row.createEl("td", {
			cls: "rg-td-date",
			text: task.due && !task.dueIsFallback ? formatDate(task.due) : "-",
		});
		row.createEl("td", { cls: "rg-td-ratio", text: `${task.doneRatio}%` });
	}
}

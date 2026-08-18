import type { RedmineIssue } from "./types";

export interface GanttTask {
	id: number;
	subject: string;
	/** バーの開始日(フォールバック適用後)。日付が一切ない場合は null */
	start: Date | null;
	/** バーの終了日(フォールバック適用後)。日付が一切ない場合は null */
	due: Date | null;
	doneRatio: number;
	assignee: string;
	status: string;
	tracker: string;
	project: string;
	parentId: number | null;
	/** 親子ツリーでの深さ(ルート=0) */
	depth: number;
	/** start_date が無く created_on から補完した場合 true */
	startIsFallback: boolean;
	/** due_date が無く開始日のみの1日バーにした場合 true */
	dueIsFallback: boolean;
	isClosed: boolean;
}

/** "YYYY-MM-DD" をローカルタイムの日付として解釈する */
function parseDate(s: string): Date {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

function toTask(issue: RedmineIssue): GanttTask {
	let start: Date | null = null;
	let due: Date | null = null;
	let startIsFallback = false;
	let dueIsFallback = false;

	if (issue.start_date) {
		start = parseDate(issue.start_date);
	}
	if (issue.due_date) {
		due = parseDate(issue.due_date);
	}
	// フォールバック: 開始日が無く期日だけある → 作成日を開始日とみなす
	if (!start && due) {
		const created = new Date(issue.created_on);
		start = new Date(created.getFullYear(), created.getMonth(), created.getDate());
		if (start > due) start = due;
		startIsFallback = true;
	}
	// フォールバック: 期日が無く開始日だけある → 1日分のバー
	if (start && !due) {
		due = start;
		dueIsFallback = true;
	}

	return {
		id: issue.id,
		subject: issue.subject,
		start,
		due,
		doneRatio: issue.done_ratio ?? 0,
		assignee: issue.assigned_to?.name ?? "",
		status: issue.status.name,
		tracker: issue.tracker.name,
		project: issue.project.name,
		parentId: issue.parent?.id ?? null,
		depth: 0,
		startIsFallback,
		dueIsFallback,
		isClosed: !!issue.closed_on,
	};
}

export interface GanttModel {
	/** 表示順(親子ツリーをDFSで平坦化済み)の日付ありタスク */
	tasks: GanttTask[];
	/** 開始日・期日とも無く、チャートに置けないタスク */
	undated: GanttTask[];
}

/**
 * Redmineチケットをガント表示用モデルへ変換する。
 * 親チケットの直下に子チケットが並ぶよう、親子ツリーをDFSで平坦化する。
 */
export function buildGanttModel(issues: RedmineIssue[]): GanttModel {
	const all = issues.map(toTask);
	const dated = all.filter((t) => t.start !== null);
	const undated = all.filter((t) => t.start === null);

	const byId = new Map<number, GanttTask>(dated.map((t) => [t.id, t]));
	const children = new Map<number, GanttTask[]>();
	const roots: GanttTask[] = [];

	for (const task of dated) {
		// 親が取得結果に含まれない(別プロジェクト・日付なし等)場合はルート扱い
		if (task.parentId !== null && byId.has(task.parentId)) {
			const list = children.get(task.parentId) ?? [];
			list.push(task);
			children.set(task.parentId, list);
		} else {
			roots.push(task);
		}
	}

	const ordered: GanttTask[] = [];
	const visit = (task: GanttTask, depth: number) => {
		task.depth = depth;
		ordered.push(task);
		for (const child of children.get(task.id) ?? []) {
			visit(child, depth + 1);
		}
	};
	for (const root of roots) visit(root, 0);

	return { tasks: ordered, undated };
}

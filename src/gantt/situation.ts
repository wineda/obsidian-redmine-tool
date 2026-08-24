import type { GanttTask } from "../redmine/mapper";
import { diffDays, formatDate } from "./scale";

/** 状況(期日・納期)による絞り込み条件 */
export type SituationFilter = "all" | "week1" | "week2" | "overdue";

// この日数以内のとき「あとXX日」バッジを表示する(それより先は表示しない)
const DUE_SOON_DAYS = 14;

export interface Situation {
	text: string;
	kind: "over" | "soon";
	title?: string;
}

/** "YYYY-MM-DD" 形式の納期文字列を日付として解釈する */
function parseDeliveryDate(s: string): Date | null {
	const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
export function matchesSituationFilter(task: GanttTask, filter: SituationFilter): boolean {
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
export function computeSituation(task: GanttTask): Situation | null {
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

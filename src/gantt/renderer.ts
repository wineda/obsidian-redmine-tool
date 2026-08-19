import type { GanttModel, GanttTask } from "../redmine/mapper";
import { GanttScale, PLAN_STATUS_LABELS, PlanStatus } from "../settings";
import {
	PX_PER_DAY,
	TimeRange,
	computeTicks,
	diffDays,
	weekendBands,
} from "./scale";

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 40;
const BAR_PADDING = 7;
const LEFT_WIDTH = 320;
const INDENT = 16;

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, String(v));
	}
	return el;
}

/** 全体予定の表示用行(日付パース済み) */
export interface PlanRow {
	name: string;
	start: Date | null;
	end: Date | null;
	status: PlanStatus;
}

export interface RenderOptions {
	issueUrl: (id: number) => string;
	/** 担当者絞り込みモード時の色。対象外・モード無効時は null */
	assigneeColor: (assignee: string) => string | null;
}

/** 表示範囲でバー期間を切り詰める。範囲外なら null */
function clipSpan(
	start: Date,
	end: Date,
	range: TimeRange
): { s: Date; e: Date } | null {
	if (end < range.start || start > range.end) return null;
	return {
		s: start < range.start ? range.start : start,
		e: end > range.end ? range.end : end,
	};
}

export function renderGantt(
	container: HTMLElement,
	model: GanttModel,
	plans: PlanRow[],
	scale: GanttScale,
	range: TimeRange,
	opts: RenderOptions
): void {
	container.empty();

	if (model.tasks.length === 0 && model.undated.length === 0 && plans.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const ppd = PX_PER_DAY[scale];
	const chartWidth = (range.days + 1) * ppd;
	const planTop = HEADER_HEIGHT;
	const taskTop = planTop + plans.length * ROW_HEIGHT;
	const chartHeight = taskTop + model.tasks.length * ROW_HEIGHT;

	const body = container.createDiv({ cls: "rg-body" });

	// ---- 左ペイン: 全体予定+チケット一覧(横スクロール時も固定) ----
	const left = body.createDiv({ cls: "rg-left" });
	left.style.width = `${LEFT_WIDTH}px`;
	const leftHeader = left.createDiv({ cls: "rg-left-header" });
	leftHeader.style.height = `${HEADER_HEIGHT}px`;
	leftHeader.setText("チケット");

	for (const plan of plans) {
		const row = left.createDiv({ cls: "rg-left-row rg-plan-row" });
		row.style.height = `${ROW_HEIGHT}px`;
		row.style.paddingLeft = "8px";
		row.createSpan({ cls: `rg-plan-dot rg-plan-${plan.status}` });
		row.createSpan({ cls: "rg-plan-name", text: plan.name });
		row.createSpan({
			cls: `rg-plan-status rg-plan-${plan.status}`,
			text: PLAN_STATUS_LABELS[plan.status],
		});
	}

	for (const task of model.tasks) {
		const row = left.createDiv({ cls: "rg-left-row" });
		row.style.height = `${ROW_HEIGHT}px`;
		row.style.paddingLeft = `${8 + task.depth * INDENT}px`;
		const link = row.createEl("a", {
			cls: "rg-issue-link",
			text: `#${task.id} ${task.subject}`,
			href: opts.issueUrl(task.id),
		});
		link.setAttr("title", taskTooltip(task));
		if (task.isClosed) row.addClass("rg-row-closed");
		if (task.assignee) {
			const assignee = row.createSpan({ cls: "rg-assignee", text: task.assignee });
			const color = opts.assigneeColor(task.assignee);
			if (color) {
				assignee.style.color = color;
				assignee.style.fontWeight = "600";
			}
		}
	}

	// ---- 右ペイン: チャートSVG ----
	const chart = body.createDiv({ cls: "rg-chart" });
	const root = svg("svg", {
		width: chartWidth,
		height: chartHeight,
		viewBox: `0 0 ${chartWidth} ${chartHeight}`,
	});
	chart.appendChild(root);

	// 全体予定エリアの背景
	if (plans.length > 0) {
		root.appendChild(
			svg("rect", {
				x: 0,
				y: planTop,
				width: chartWidth,
				height: plans.length * ROW_HEIGHT,
				class: "rg-plan-area",
			})
		);
	}

	// 週末の背景帯(日スケールのみ)
	for (const band of weekendBands(range, scale)) {
		root.appendChild(
			svg("rect", {
				x: band.x,
				y: HEADER_HEIGHT,
				width: band.w,
				height: chartHeight - HEADER_HEIGHT,
				class: "rg-weekend",
			})
		);
	}

	// グリッド縦線
	const ticks = computeTicks(range, scale);
	for (const x of ticks.gridX) {
		root.appendChild(
			svg("line", { x1: x, y1: HEADER_HEIGHT, x2: x, y2: chartHeight, class: "rg-grid" })
		);
	}

	// 行区切りの横線
	const totalRows = plans.length + model.tasks.length;
	for (let i = 0; i <= totalRows; i++) {
		const y = HEADER_HEIGHT + i * ROW_HEIGHT;
		root.appendChild(svg("line", { x1: 0, y1: y, x2: chartWidth, y2: y, class: "rg-grid" }));
	}
	// 全体予定とチケットの区切り線
	if (plans.length > 0) {
		root.appendChild(
			svg("line", { x1: 0, y1: taskTop, x2: chartWidth, y2: taskTop, class: "rg-separator" })
		);
	}

	// ヘッダー目盛り(上段: 年月 / 下段: 日・週)
	for (const tick of ticks.major) {
		const t = svg("text", { x: tick.x + 4, y: 15, class: "rg-tick-major" });
		t.textContent = tick.label;
		root.appendChild(t);
		root.appendChild(
			svg("line", { x1: tick.x, y1: 0, x2: tick.x, y2: HEADER_HEIGHT, class: "rg-grid" })
		);
	}
	for (const tick of ticks.minor) {
		const t = svg("text", { x: tick.x + 3, y: 33, class: "rg-tick-minor" });
		t.textContent = tick.label;
		root.appendChild(t);
	}

	// 全体予定のバー
	plans.forEach((plan, i) => {
		if (!plan.start || !plan.end) return;
		const span = clipSpan(plan.start, plan.end, range);
		if (!span) return;
		const x = diffDays(range.start, span.s) * ppd;
		const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
		const y = planTop + i * ROW_HEIGHT + BAR_PADDING;
		const h = ROW_HEIGHT - BAR_PADDING * 2;
		const bar = svg("rect", {
			x,
			y,
			width: w,
			height: h,
			rx: 3,
			class: `rg-plan-bar rg-plan-${plan.status}`,
		});
		const title = svg("title");
		title.textContent = planTooltip(plan);
		bar.appendChild(title);
		root.appendChild(bar);
	});

	// タスクバー
	model.tasks.forEach((task, i) => {
		if (!task.start || !task.due) return;
		const span = clipSpan(task.start, task.due, range);
		if (!span) return;
		const x = diffDays(range.start, span.s) * ppd;
		const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
		const y = taskTop + i * ROW_HEIGHT + BAR_PADDING;
		const h = ROW_HEIGHT - BAR_PADDING * 2;

		const group = svg("g", { class: "rg-bar-group" });

		const assigneeColor = task.assignee ? opts.assigneeColor(task.assignee) : null;

		const barClass =
			"rg-bar" +
			(task.isClosed ? " rg-bar-closed" : "") +
			(task.startIsFallback || task.dueIsFallback ? " rg-bar-fallback" : "");
		const bar = svg("rect", { x, y, width: w, height: h, rx: 3, class: barClass });
		if (assigneeColor && !task.isClosed) bar.style.fill = assigneeColor;
		const title = svg("title");
		title.textContent = taskTooltip(task);
		bar.appendChild(title);
		group.appendChild(bar);

		// 進捗率の塗り
		if (task.doneRatio > 0) {
			const progress = svg("rect", {
				x,
				y,
				width: (w * Math.min(task.doneRatio, 100)) / 100,
				height: h,
				rx: 3,
				class: "rg-bar-progress" + (task.isClosed ? " rg-bar-closed" : ""),
			});
			if (assigneeColor && !task.isClosed) progress.style.fill = assigneeColor;
			group.appendChild(progress);
		}

		group.addEventListener("click", () => {
			window.open(opts.issueUrl(task.id));
		});
		root.appendChild(group);
	});

	// 今日の縦線(表示範囲内のときだけ)
	const today = new Date();
	if (today >= range.start && diffDays(range.start, today) <= range.days) {
		const todayX = diffDays(range.start, today) * ppd + ppd / 2;
		root.appendChild(
			svg("line", { x1: todayX, y1: 0, x2: todayX, y2: chartHeight, class: "rg-today" })
		);
	}

	// ---- 日付未設定チケット ----
	if (model.undated.length > 0) {
		const undated = container.createDiv({ cls: "rg-undated" });
		undated.createDiv({
			cls: "rg-undated-header",
			text: `日付未設定のチケット (${model.undated.length}件)`,
		});
		for (const task of model.undated) {
			const row = undated.createDiv({ cls: "rg-undated-row" });
			row.createEl("a", {
				cls: "rg-issue-link",
				text: `#${task.id} ${task.subject}`,
				href: opts.issueUrl(task.id),
			});
			if (task.assignee) row.createSpan({ cls: "rg-assignee", text: task.assignee });
		}
	}
}

export function formatDate(d: Date | null): string {
	if (!d) return "-";
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate()
	).padStart(2, "0")}`;
}

function taskTooltip(task: GanttTask): string {
	const lines = [
		`#${task.id} ${task.subject}`,
		`${task.tracker} / ${task.status}`,
		`期間: ${formatDate(task.start)}${task.startIsFallback ? "(推定)" : ""} 〜 ${formatDate(task.due)}${task.dueIsFallback ? "(未設定)" : ""}`,
		`進捗: ${task.doneRatio}%`,
	];
	if (task.assignee) lines.push(`担当: ${task.assignee}`);
	return lines.join("\n");
}

function planTooltip(plan: PlanRow): string {
	return [
		plan.name,
		`期間: ${formatDate(plan.start)} 〜 ${formatDate(plan.end)}`,
		`状態: ${PLAN_STATUS_LABELS[plan.status]}`,
	].join("\n");
}

import type { GanttModel, GanttTask } from "../redmine/mapper";
import { GanttScale, PLAN_STATUS_LABELS, PlanStatus } from "../settings";
import {
	PX_PER_DAY,
	TimeRange,
	addDays,
	computeTicks,
	diffDays,
	weekendBands,
} from "./scale";

const HEADER_HEIGHT = 40;
export const DEFAULT_LEFT_WIDTH = 480;
const MIN_LEFT_WIDTH = 200;
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
	/** 文字サイズ(px)。行の高さも連動する */
	fontSize: number;
	/** ガント左ペイン(チケット一覧)の幅(px) */
	leftWidth?: number;
	/** 左ペイン幅をドラッグで変更したときに呼ばれる(呼び出し側で保持する) */
	onLeftWidthChange?: (width: number) => void;
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

	if (model.tasks.length === 0 && plans.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const ppd = PX_PER_DAY[scale];
	const chartWidth = (range.days + 1) * ppd;
	// 文字サイズに応じて行の高さ・バーの余白を連動させる
	const rowHeight = Math.max(16, Math.round(opts.fontSize * 2));
	const barPadding = Math.max(3, Math.round(rowHeight * 0.22));

	// 全体予定を重ならないようにレーンへ詰める(日付のない予定はチャートに出せないため除外)
	const datedPlans = plans
		.filter((p): p is PlanRow & { start: Date; end: Date } => p.start !== null && p.end !== null)
		.sort((a, b) => a.start.getTime() - b.start.getTime());
	const laneEnds: Date[] = [];
	const planLane = new Map<PlanRow, number>();
	for (const plan of datedPlans) {
		// 1日予定は▼の右にタイトルが伸びるため、その分の幅もレーン上で確保する
		const isSingleDay = diffDays(plan.start, plan.end) === 0;
		const labelDays = isSingleDay
			? Math.ceil((plan.name.length * opts.fontSize + rowHeight) / PX_PER_DAY[scale])
			: 0;
		const effectiveEnd = labelDays > 0 ? addDays(plan.end, labelDays) : plan.end;
		let lane = laneEnds.findIndex((end) => plan.start > end);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(effectiveEnd);
		} else {
			laneEnds[lane] = effectiveEnd;
		}
		planLane.set(plan, lane);
	}
	const planLaneCount = laneEnds.length;

	const planTop = HEADER_HEIGHT;
	const taskTop = planTop + planLaneCount * rowHeight;
	const chartHeight = taskTop + model.tasks.length * rowHeight;

	const body = container.createDiv({ cls: "rg-body" });

	// ---- 左ペイン: 全体予定+チケット一覧(横スクロール時も固定) ----
	const left = body.createDiv({ cls: "rg-left" });
	left.style.width = `${opts.leftWidth ?? DEFAULT_LEFT_WIDTH}px`;
	left.style.fontSize = `${opts.fontSize}px`;
	const leftHeader = left.createDiv({ cls: "rg-left-header" });
	leftHeader.style.height = `${HEADER_HEIGHT}px`;
	leftHeader.setText("チケット");

	// 左ペイン幅のドラッグリサイズ
	const resizer = left.createDiv({ cls: "rg-left-resizer" });
	resizer.addEventListener("mousedown", (e: MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = left.getBoundingClientRect().width;
		const onMove = (ev: MouseEvent) => {
			const width = Math.max(MIN_LEFT_WIDTH, startWidth + ev.clientX - startX);
			left.style.width = `${width}px`;
			opts.onLeftWidthChange?.(width);
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

	if (planLaneCount > 0) {
		const planLabel = left.createDiv({ cls: "rg-left-row rg-plan-row rg-plan-label" });
		planLabel.style.height = `${planLaneCount * rowHeight}px`;
		planLabel.style.paddingLeft = "8px";
		planLabel.setText("全体予定");
	}

	for (const task of model.tasks) {
		const row = left.createDiv({ cls: "rg-left-row" });
		row.style.height = `${rowHeight}px`;
		row.style.paddingLeft = `${8 + task.depth * INDENT}px`;
		row.createEl("a", {
			cls: "rg-id-link",
			text: `#${task.id}`,
			href: opts.issueUrl(task.id),
		});
		row.createSpan({ cls: "rg-tracker", text: task.tracker });
		const link = row.createEl("a", {
			cls: "rg-issue-link",
			text: task.subject,
			href: opts.issueUrl(task.id),
		});
		link.setAttr("title", taskTooltip(task));
		if (task.isClosed) row.addClass("rg-row-closed");
		if (task.isContext) row.addClass("rg-row-context");
		if (task.assignee) {
			const chip = row.createSpan({ cls: "rg-assignee-chip", text: task.assignee });
			const color = task.isContext ? null : opts.assigneeColor(task.assignee);
			if (color) {
				chip.style.backgroundColor = color;
				chip.addClass("rg-assignee-chip-colored");
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
	if (planLaneCount > 0) {
		root.appendChild(
			svg("rect", {
				x: 0,
				y: planTop,
				width: chartWidth,
				height: planLaneCount * rowHeight,
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
	const totalRows = planLaneCount + model.tasks.length;
	for (let i = 0; i <= totalRows; i++) {
		const y = HEADER_HEIGHT + i * rowHeight;
		root.appendChild(svg("line", { x1: 0, y1: y, x2: chartWidth, y2: y, class: "rg-grid" }));
	}
	// 全体予定とチケットの区切り線
	if (planLaneCount > 0) {
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

	// 全体予定: 1日の予定は▼マーカー+タイトル、複数日はタイトル入りブロック
	for (const plan of datedPlans) {
		const lane = planLane.get(plan) ?? 0;
		const y = planTop + lane * rowHeight + barPadding;
		const h = rowHeight - barPadding * 2;
		const textBaseline = y + Math.round(h / 2 + opts.fontSize * 0.35);
		const group = svg("g", {});
		const title = svg("title");
		title.textContent = planTooltip(plan);
		group.appendChild(title);

		if (diffDays(plan.start, plan.end) === 0) {
			// 1日の予定: ▼マーカーと右側にタイトル
			if (plan.start < range.start || plan.start > range.end) continue;
			const cx = diffDays(range.start, plan.start) * ppd + ppd / 2;
			const half = Math.max(5, Math.round(h / 2));
			group.appendChild(
				svg("polygon", {
					points: `${cx - half},${y} ${cx + half},${y} ${cx},${y + h}`,
					class: `rg-plan-marker rg-plan-${plan.status}`,
				})
			);
			const label = svg("text", {
				x: cx + half + 4,
				y: textBaseline,
				"font-size": opts.fontSize,
				class: `rg-plan-marker-label rg-plan-${plan.status}`,
			});
			label.textContent = plan.name;
			group.appendChild(label);
		} else {
			// 複数日の予定: ブロック内にタイトル
			const span = clipSpan(plan.start, plan.end, range);
			if (!span) continue;
			const x = diffDays(range.start, span.s) * ppd;
			const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
			group.appendChild(
				svg("rect", { x, y, width: w, height: h, rx: 3, class: `rg-plan-bar rg-plan-${plan.status}` })
			);
			const maxChars = Math.floor((w - 10) / opts.fontSize);
			if (maxChars >= 2) {
				const name =
					plan.name.length > maxChars ? plan.name.slice(0, maxChars - 1) + "…" : plan.name;
				const label = svg("text", {
					x: x + 6,
					y: textBaseline,
					"font-size": opts.fontSize,
					class: "rg-plan-bar-label",
				});
				label.textContent = name;
				group.appendChild(label);
			}
		}
		root.appendChild(group);
	}

	// タスクバー
	model.tasks.forEach((task, i) => {
		if (!task.start || !task.due) return;
		const span = clipSpan(task.start, task.due, range);
		if (!span) return;
		const x = diffDays(range.start, span.s) * ppd;
		const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
		const y = taskTop + i * rowHeight + barPadding;
		const h = rowHeight - barPadding * 2;

		const group = svg("g", { class: "rg-bar-group" });

		const assigneeColor =
			task.assignee && !task.isContext ? opts.assigneeColor(task.assignee) : null;

		const barClass =
			"rg-bar" +
			(task.isClosed ? " rg-bar-closed" : "") +
			(task.isContext ? " rg-bar-context" : "") +
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
				class:
					"rg-bar-progress" +
					(task.isClosed ? " rg-bar-closed" : "") +
					(task.isContext ? " rg-bar-context" : ""),
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
	if (task.isContext) lines.push("(絞り込み条件外の親。ツリー表示のため参考表示)");
	return lines.join("\n");
}

function planTooltip(plan: PlanRow): string {
	return [
		plan.name,
		`期間: ${formatDate(plan.start)} 〜 ${formatDate(plan.end)}`,
		`状態: ${PLAN_STATUS_LABELS[plan.status]}`,
	].join("\n");
}

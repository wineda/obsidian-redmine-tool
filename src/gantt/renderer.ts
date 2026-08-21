import type { GanttModel, GanttTask } from "../redmine/mapper";
import { GanttScale, PLAN_STATUS_LABELS, PlanStatus } from "../settings";
import {
	PX_PER_DAY,
	TimeRange,
	addDays,
	computeTicks,
	diffDays,
	formatDate,
	weekendBands,
} from "./scale";
import { isJapaneseHoliday } from "./holidays";
import { computeSituation } from "./situation";

// 他モジュール(table.tsなど)は従来どおりrenderer経由でも参照できるようにする
export { formatDate } from "./scale";

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
	/** バーの色 "#rrggbb"。空文字は状態に応じた既定色 */
	color: string;
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
	/**
	 * 日詳細モード(1ヶ月表示時)。スケール設定に関わらず1日単位で広めに表示し、
	 * ヘッダーに日付+曜日、土日祝の背景帯を描く
	 */
	dayDetail?: boolean;
}

/** 日詳細モードの1日あたりピクセル幅(通常の日スケールより広め) */
const DAY_DETAIL_PX_PER_DAY = 44;
const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** 文字サイズに応じた行の高さ(px)。ガントとテーブル表示で共通 */
export function rowHeightFor(fontSize: number): number {
	return Math.max(16, Math.round(fontSize * 2));
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

	const ppd = opts.dayDetail ? DAY_DETAIL_PX_PER_DAY : PX_PER_DAY[scale];
	const chartWidth = (range.days + 1) * ppd;
	// 文字サイズに応じて行の高さ・バーの余白を連動させる
	const rowHeight = rowHeightFor(opts.fontSize);
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
			? Math.ceil((plan.name.length * opts.fontSize + rowHeight) / ppd)
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

	const topHeight = HEADER_HEIGHT + planLaneCount * rowHeight;
	const tasksHeight = model.tasks.length * rowHeight;
	const leftWidth = opts.leftWidth ?? DEFAULT_LEFT_WIDTH;
	// 日詳細モードは毎日グリッド線を引き、ヘッダー目盛りは専用描画にする
	let ticks = computeTicks(range, scale);
	if (opts.dayDetail) {
		ticks = { major: [], minor: [], gridX: [] };
		for (let i = 0; i <= range.days; i++) ticks.gridX.push(i * ppd);
	}

	const today = new Date();
	const todayX =
		today >= range.start && diffDays(range.start, today) <= range.days
			? diffDays(range.start, today) * ppd + ppd / 2
			: null;

	// 日詳細モードの休み(土日祝)判定
	const restDays: { x: number; holiday: boolean }[] = [];
	if (opts.dayDetail) {
		for (let i = 0; i <= range.days; i++) {
			const d = addDays(range.start, i);
			const dow = d.getDay();
			const holiday = isJapaneseHoliday(d);
			if (dow === 0 || dow === 6 || holiday) {
				restDays.push({ x: i * ppd, holiday: holiday || dow === 0 });
			}
		}
	}

	// 左ペイン幅のドラッグリサイズ(上部固定エリアとチケット行の両方に適用する)
	const leftEls: HTMLElement[] = [];
	const attachResizer = (host: HTMLElement) => {
		const resizer = host.createDiv({ cls: "rg-left-resizer" });
		resizer.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = host.getBoundingClientRect().width;
			const onMove = (ev: MouseEvent) => {
				const width = Math.max(MIN_LEFT_WIDTH, startWidth + ev.clientX - startX);
				for (const el of leftEls) {
					el.style.width = `${width}px`;
				}
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
	};

	// ---- 上部固定エリア: 時間軸ヘッダー+全体予定(縦スクロールしても上部に固定) ----
	const stickyTop = container.createDiv({ cls: "rg-sticky-top" });

	const leftTop = stickyTop.createDiv({ cls: "rg-left rg-left-top" });
	leftTop.style.width = `${leftWidth}px`;
	leftTop.style.fontSize = `${opts.fontSize}px`;
	leftEls.push(leftTop);
	attachResizer(leftTop);
	const leftHeader = leftTop.createDiv({ cls: "rg-left-header" });
	leftHeader.style.height = `${HEADER_HEIGHT}px`;
	leftHeader.setText("チケット");
	if (planLaneCount > 0) {
		const planLabel = leftTop.createDiv({ cls: "rg-left-row rg-plan-row rg-plan-label" });
		planLabel.style.height = `${planLaneCount * rowHeight}px`;
		planLabel.style.paddingLeft = "8px";
		planLabel.setText("全体予定");
	}

	const chartTop = stickyTop.createDiv({ cls: "rg-chart" });
	const topSvg = svg("svg", {
		width: chartWidth,
		height: topHeight,
		viewBox: `0 0 ${chartWidth} ${topHeight}`,
	});
	chartTop.appendChild(topSvg);

	// 全体予定エリアの背景
	if (planLaneCount > 0) {
		topSvg.appendChild(
			svg("rect", {
				x: 0,
				y: HEADER_HEIGHT,
				width: chartWidth,
				height: planLaneCount * rowHeight,
				class: "rg-plan-area",
			})
		);
	}

	// グリッド縦線・レーン区切り
	for (const x of ticks.gridX) {
		topSvg.appendChild(
			svg("line", { x1: x, y1: HEADER_HEIGHT, x2: x, y2: topHeight, class: "rg-grid" })
		);
	}
	for (let i = 0; i <= planLaneCount; i++) {
		const y = HEADER_HEIGHT + i * rowHeight;
		topSvg.appendChild(
			svg("line", {
				x1: 0,
				y1: y,
				x2: chartWidth,
				y2: y,
				class: i === planLaneCount ? "rg-separator" : "rg-grid",
			})
		);
	}

	// ヘッダー目盛り
	if (opts.dayDetail) {
		// 日詳細モード: 上段に年月、下段に日付+曜日(土=青、日・祝=赤)
		for (let i = 0; i <= range.days; i++) {
			const d = addDays(range.start, i);
			const x = i * ppd;
			if (d.getDate() === 1 || i === 0) {
				const t = svg("text", { x: x + 4, y: 15, class: "rg-tick-major" });
				t.textContent = `${d.getFullYear()}/${d.getMonth() + 1}`;
				topSvg.appendChild(t);
				topSvg.appendChild(
					svg("line", { x1: x, y1: 0, x2: x, y2: HEADER_HEIGHT, class: "rg-grid" })
				);
			}
			const dow = d.getDay();
			const restClass =
				isJapaneseHoliday(d) || dow === 0 ? " rg-tick-sun" : dow === 6 ? " rg-tick-sat" : "";
			const dayText = svg("text", {
				x: x + ppd / 2,
				y: 27,
				"text-anchor": "middle",
				class: "rg-tick-minor" + restClass,
			});
			dayText.textContent = String(d.getDate());
			topSvg.appendChild(dayText);
			const dowText = svg("text", {
				x: x + ppd / 2,
				y: 38,
				"text-anchor": "middle",
				class: "rg-tick-dow" + restClass,
			});
			dowText.textContent = DOW_LABELS[dow];
			topSvg.appendChild(dowText);
		}
	} else {
		// 上段: 年月 / 下段: 日・週
		for (const tick of ticks.major) {
			const t = svg("text", { x: tick.x + 4, y: 15, class: "rg-tick-major" });
			t.textContent = tick.label;
			topSvg.appendChild(t);
			topSvg.appendChild(
				svg("line", { x1: tick.x, y1: 0, x2: tick.x, y2: HEADER_HEIGHT, class: "rg-grid" })
			);
		}
		for (const tick of ticks.minor) {
			const t = svg("text", { x: tick.x + 3, y: 33, class: "rg-tick-minor" });
			t.textContent = tick.label;
			topSvg.appendChild(t);
		}
	}

	// 全体予定: 1日の予定は▼マーカー+タイトル、複数日はタイトル入りブロック
	for (const plan of datedPlans) {
		const lane = planLane.get(plan) ?? 0;
		const y = HEADER_HEIGHT + lane * rowHeight + barPadding;
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
			const marker = svg("polygon", {
				points: `${cx - half},${y} ${cx + half},${y} ${cx},${y + h}`,
				class: `rg-plan-marker rg-plan-${plan.status}`,
			});
			if (plan.color) marker.style.fill = plan.color;
			group.appendChild(marker);
			const label = svg("text", {
				x: cx + half + 4,
				y: textBaseline,
				"font-size": opts.fontSize,
				class: `rg-plan-marker-label rg-plan-${plan.status}`,
			});
			if (plan.color) label.style.fill = plan.color;
			label.textContent = plan.name;
			group.appendChild(label);
		} else {
			// 複数日の予定: ブロック内にタイトル
			const span = clipSpan(plan.start, plan.end, range);
			if (!span) continue;
			const x = diffDays(range.start, span.s) * ppd;
			const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
			const bar = svg("rect", {
				x,
				y,
				width: w,
				height: h,
				rx: 3,
				class: `rg-plan-bar rg-plan-${plan.status}`,
			});
			if (plan.color) bar.style.fill = plan.color;
			group.appendChild(bar);
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
		topSvg.appendChild(group);
	}

	// 今日の縦線(上部固定エリア側)
	if (todayX !== null) {
		topSvg.appendChild(
			svg("line", { x1: todayX, y1: 0, x2: todayX, y2: topHeight, class: "rg-today" })
		);
	}

	// ---- チケット行(縦スクロール対象) ----
	const body = container.createDiv({ cls: "rg-body" });

	const left = body.createDiv({ cls: "rg-left" });
	left.style.width = `${leftWidth}px`;
	left.style.fontSize = `${opts.fontSize}px`;
	leftEls.push(left);
	attachResizer(left);

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

		// 右寄せ領域: 担当者・状況の固定幅カラム(全行で縦位置がそろうよう常に両方作る)
		const rowRight = row.createDiv({ cls: "rg-left-right" });
		const assigneeCell = rowRight.createDiv({ cls: "rg-left-col-assignee" });
		if (task.assignee) {
			const chip = assigneeCell.createSpan({ cls: "rg-assignee-chip", text: task.assignee });
			const color = task.isContext ? null : opts.assigneeColor(task.assignee);
			if (color) {
				chip.style.backgroundColor = color;
				chip.addClass("rg-assignee-chip-colored");
			}
		}
		const situationCell = rowRight.createDiv({ cls: "rg-left-col-situation" });
		const situation = computeSituation(task);
		if (situation) {
			const badge = situationCell.createSpan({
				cls: `rg-due rg-due-${situation.kind}`,
				text: situation.text,
			});
			if (situation.title) badge.setAttr("title", situation.title);
		}
	}

	const chart = body.createDiv({ cls: "rg-chart" });
	const root = svg("svg", {
		width: chartWidth,
		height: tasksHeight,
		viewBox: `0 0 ${chartWidth} ${tasksHeight}`,
	});
	chart.appendChild(root);

	// 休みの背景帯
	if (opts.dayDetail) {
		// 日詳細モード: 土日に加えて日本の祝日も休みとして塗る
		for (const rest of restDays) {
			root.appendChild(
				svg("rect", {
					x: rest.x,
					y: 0,
					width: ppd,
					height: tasksHeight,
					class: "rg-weekend" + (rest.holiday ? " rg-holiday" : ""),
				})
			);
		}
	} else {
		// 週末の背景帯(日スケールのみ)
		for (const band of weekendBands(range, scale)) {
			root.appendChild(
				svg("rect", { x: band.x, y: 0, width: band.w, height: tasksHeight, class: "rg-weekend" })
			);
		}
	}

	// グリッド縦線・行区切り
	for (const x of ticks.gridX) {
		root.appendChild(svg("line", { x1: x, y1: 0, x2: x, y2: tasksHeight, class: "rg-grid" }));
	}
	for (let i = 0; i <= model.tasks.length; i++) {
		const y = i * rowHeight;
		root.appendChild(svg("line", { x1: 0, y1: y, x2: chartWidth, y2: y, class: "rg-grid" }));
	}

	// タスクバー
	model.tasks.forEach((task, i) => {
		if (!task.start || !task.due) return;
		const span = clipSpan(task.start, task.due, range);
		if (!span) return;
		const x = diffDays(range.start, span.s) * ppd;
		const w = Math.max((diffDays(span.s, span.e) + 1) * ppd, 4);
		const y = i * rowHeight + barPadding;
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

	// 今日の縦線(チケット行側)
	if (todayX !== null) {
		root.appendChild(
			svg("line", { x1: todayX, y1: 0, x2: todayX, y2: tasksHeight, class: "rg-today" })
		);
	}
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

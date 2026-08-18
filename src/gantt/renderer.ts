import type { GanttModel, GanttTask } from "../redmine/mapper";
import type { GanttScale } from "../settings";
import {
	PX_PER_DAY,
	computeRange,
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

export interface RenderOptions {
	issueUrl: (id: number) => string;
}

export function renderGantt(
	container: HTMLElement,
	model: GanttModel,
	scale: GanttScale,
	opts: RenderOptions
): void {
	container.empty();

	if (model.tasks.length === 0 && model.undated.length === 0) {
		container.createDiv({ cls: "rg-empty", text: "表示できるチケットがありません。" });
		return;
	}

	const range = computeRange(model.tasks);
	const ppd = PX_PER_DAY[scale];
	const chartWidth = (range.days + 1) * ppd;
	const chartHeight = HEADER_HEIGHT + model.tasks.length * ROW_HEIGHT;

	const body = container.createDiv({ cls: "rg-body" });

	// ---- 左ペイン: チケット一覧(横スクロール時も固定) ----
	const left = body.createDiv({ cls: "rg-left" });
	left.style.width = `${LEFT_WIDTH}px`;
	const leftHeader = left.createDiv({ cls: "rg-left-header" });
	leftHeader.style.height = `${HEADER_HEIGHT}px`;
	leftHeader.setText("チケット");

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
			row.createSpan({ cls: "rg-assignee", text: task.assignee });
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
	for (let i = 0; i <= model.tasks.length; i++) {
		const y = HEADER_HEIGHT + i * ROW_HEIGHT;
		root.appendChild(svg("line", { x1: 0, y1: y, x2: chartWidth, y2: y, class: "rg-grid" }));
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

	// タスクバー
	model.tasks.forEach((task, i) => {
		if (!task.start || !task.due) return;
		const x = diffDays(range.start, task.start) * ppd;
		const w = Math.max((diffDays(task.start, task.due) + 1) * ppd, 4);
		const y = HEADER_HEIGHT + i * ROW_HEIGHT + BAR_PADDING;
		const h = ROW_HEIGHT - BAR_PADDING * 2;

		const group = svg("g", { class: "rg-bar-group" });

		const barClass =
			"rg-bar" +
			(task.isClosed ? " rg-bar-closed" : "") +
			(task.startIsFallback || task.dueIsFallback ? " rg-bar-fallback" : "");
		const bar = svg("rect", { x, y, width: w, height: h, rx: 3, class: barClass });
		const title = svg("title");
		title.textContent = taskTooltip(task);
		bar.appendChild(title);
		group.appendChild(bar);

		// 進捗率の塗り
		if (task.doneRatio > 0) {
			group.appendChild(
				svg("rect", {
					x,
					y,
					width: (w * Math.min(task.doneRatio, 100)) / 100,
					height: h,
					rx: 3,
					class: "rg-bar-progress" + (task.isClosed ? " rg-bar-closed" : ""),
				})
			);
		}

		group.addEventListener("click", () => {
			window.open(opts.issueUrl(task.id));
		});
		root.appendChild(group);
	});

	// 今日の縦線
	const todayX = diffDays(range.start, new Date()) * ppd + ppd / 2;
	root.appendChild(
		svg("line", { x1: todayX, y1: 0, x2: todayX, y2: chartHeight, class: "rg-today" })
	);

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

function taskTooltip(task: GanttTask): string {
	const fmt = (d: Date | null) =>
		d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "-";
	const lines = [
		`#${task.id} ${task.subject}`,
		`${task.tracker} / ${task.status}`,
		`期間: ${fmt(task.start)}${task.startIsFallback ? "(推定)" : ""} 〜 ${fmt(task.due)}${task.dueIsFallback ? "(未設定)" : ""}`,
		`進捗: ${task.doneRatio}%`,
	];
	if (task.assignee) lines.push(`担当: ${task.assignee}`);
	return lines.join("\n");
}

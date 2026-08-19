import type { GanttScale } from "../settings";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** スケールごとの1日あたりピクセル幅 */
export const PX_PER_DAY: Record<GanttScale, number> = {
	day: 32,
	week: 12,
	month: 4,
};

export interface TimeRange {
	/** チャート左端の日(ローカル0時) */
	start: Date;
	/** チャート右端の日(この日を含む) */
	end: Date;
	/** 最終日のインデックス(0始まり。表示日数 - 1) */
	days: number;
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + days);
	return r;
}

export function diffDays(from: Date, to: Date): number {
	return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** 指定した開始月から months ヶ月分の表示範囲を作る */
export function monthRange(year: number, month0: number, months: number): TimeRange {
	const start = new Date(year, month0, 1);
	// 翌月0日 = 対象最終月の末日
	const end = new Date(year, month0 + months, 0);
	return { start, end, days: diffDays(start, end) };
}

export interface Tick {
	/** チャート左端からのX座標(px) */
	x: number;
	label: string;
}

export interface Ticks {
	/** 上段: 年月ラベル */
	major: Tick[];
	/** 下段: 日(日スケール)/週初日(週スケール)。月スケールでは空 */
	minor: Tick[];
	/** グリッド縦線のX座標 */
	gridX: number[];
}

/** 時間軸の目盛りを生成する */
export function computeTicks(range: TimeRange, scale: GanttScale): Ticks {
	const ppd = PX_PER_DAY[scale];
	const major: Tick[] = [];
	const minor: Tick[] = [];
	const gridX: number[] = [];

	for (let i = 0; i <= range.days; i++) {
		const d = addDays(range.start, i);
		const x = i * ppd;
		if (d.getDate() === 1 || i === 0) {
			major.push({ x, label: `${d.getFullYear()}/${d.getMonth() + 1}` });
			if (scale === "month") gridX.push(x);
		}
		if (scale === "day") {
			minor.push({ x, label: String(d.getDate()) });
			gridX.push(x);
		} else if (scale === "week" && d.getDay() === 1) {
			// 月曜を週の目盛りにする
			minor.push({ x, label: `${d.getMonth() + 1}/${d.getDate()}` });
			gridX.push(x);
		}
	}
	return { major, minor, gridX };
}

/** 日スケール用: 週末(土日)の背景帯 */
export function weekendBands(range: TimeRange, scale: GanttScale): { x: number; w: number }[] {
	if (scale !== "day") return [];
	const ppd = PX_PER_DAY[scale];
	const bands: { x: number; w: number }[] = [];
	for (let i = 0; i <= range.days; i++) {
		const d = addDays(range.start, i);
		const day = d.getDay();
		if (day === 0 || day === 6) {
			bands.push({ x: i * ppd, w: ppd });
		}
	}
	return bands;
}

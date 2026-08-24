import { addDays } from "./scale";

/**
 * 日本の祝日判定(2020年以降の祝日法ベースの計算式。1980〜2099年で有効)。
 * 東京五輪特例(2020・2021年の海の日等の移動)のような一時的な特例は考慮しない。
 */

/** 年ごとの祝日集合(月×100+日)のキャッシュ */
const cache = new Map<number, Set<number>>();

function key(month0: number, day: number): number {
	return month0 * 100 + day;
}

/** 指定月の第n月曜の日付(1始まり) */
function nthMonday(year: number, month0: number, n: number): number {
	const first = new Date(year, month0, 1).getDay();
	const offset = (8 - first) % 7; // 最初の月曜まで
	return 1 + offset + (n - 1) * 7;
}

/** 春分の日(1980〜2099年の近似式) */
function vernalEquinoxDay(year: number): number {
	return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分の日(1980〜2099年の近似式) */
function autumnalEquinoxDay(year: number): number {
	return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function holidaysOf(year: number): Set<number> {
	const cached = cache.get(year);
	if (cached) return cached;

	const base: [number, number][] = [
		[0, 1], // 元日
		[0, nthMonday(year, 0, 2)], // 成人の日
		[1, 11], // 建国記念の日
		[1, 23], // 天皇誕生日
		[2, vernalEquinoxDay(year)], // 春分の日
		[3, 29], // 昭和の日
		[4, 3], // 憲法記念日
		[4, 4], // みどりの日
		[4, 5], // こどもの日
		[6, nthMonday(year, 6, 3)], // 海の日
		[7, 11], // 山の日
		[8, nthMonday(year, 8, 3)], // 敬老の日
		[8, autumnalEquinoxDay(year)], // 秋分の日
		[9, nthMonday(year, 9, 2)], // スポーツの日
		[10, 3], // 文化の日
		[10, 23], // 勤労感謝の日
	];
	const set = new Set(base.map(([m, d]) => key(m, d)));

	// 振替休日: 日曜に当たった祝日の直後の「祝日でない日」
	for (const [m, d] of base) {
		const date = new Date(year, m, d);
		if (date.getDay() !== 0) continue;
		let next = addDays(date, 1);
		while (set.has(key(next.getMonth(), next.getDate()))) {
			next = addDays(next, 1);
		}
		if (next.getFullYear() === year) set.add(key(next.getMonth(), next.getDate()));
	}

	// 国民の休日: 前日と翌日が祝日に挟まれた平日(敬老の日〜秋分の日の間に発生し得る)
	for (const [m, d] of base) {
		const candidate = new Date(year, m, d + 2);
		if (candidate.getFullYear() !== year) continue;
		const candidateKey = key(candidate.getMonth(), candidate.getDate());
		const betweenKey = key(new Date(year, m, d + 1).getMonth(), new Date(year, m, d + 1).getDate());
		if (set.has(candidateKey) && !set.has(betweenKey)) {
			const between = new Date(year, m, d + 1);
			if (between.getDay() !== 0) set.add(betweenKey);
		}
	}

	cache.set(year, set);
	return set;
}

/** 日本の祝日(振替休日・国民の休日を含む)かどうか */
export function isJapaneseHoliday(d: Date): boolean {
	return holidaysOf(d.getFullYear()).has(key(d.getMonth(), d.getDate()));
}

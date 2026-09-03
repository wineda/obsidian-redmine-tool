import type {
	AssigneeColor,
	PlanGroup,
	PlanItem,
	PlanKind,
	RedmineGanttSettings,
} from "../settings";

/** グループ色・上書き色の選択肢(ライト/ダーク両テーマで判別しやすい中間トーン) */
export const PLAN_COLORS: { hex: string; label: string }[] = [
	{ hex: "#d9534f", label: "赤" },
	{ hex: "#e8883a", label: "オレンジ" },
	{ hex: "#3f9e4d", label: "緑" },
	{ hex: "#3f7fd9", label: "青" },
	{ hex: "#7a5fd0", label: "紫" },
	{ hex: "#2f9e9b", label: "青緑" },
	{ hex: "#b0578d", label: "ピンク" },
	{ hex: "#98771d", label: "茶" },
];

/** グループが未指定の予定の受け皿 */
export const UNCATEGORIZED_NAME = "未分類";
const UNCATEGORIZED_COLOR = "#8a8f9a";

export function newPlanId(prefix: "plan" | "group"): string {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function planKindLabel(kind: PlanKind): string {
	return kind === "personal" ? "個人予定" : "全体予定";
}

/** グループを指す名詞。個人予定では「担当者」と呼ぶ */
export function groupNoun(kind: PlanKind): string {
	return kind === "personal" ? "担当者" : "グループ";
}

/** 種別ごとの「未分類」グループ。なければ作って末尾に追加する */
export function ensureUncategorizedGroup(groups: PlanGroup[], kind: PlanKind): PlanGroup {
	const existing = groups.find((g) => g.kind === kind && g.name === UNCATEGORIZED_NAME);
	if (existing) return existing;
	const group: PlanGroup = {
		id: newPlanId("group"),
		name: UNCATEGORIZED_NAME,
		color: UNCATEGORIZED_COLOR,
		kind,
	};
	groups.push(group);
	return group;
}

/**
 * 新しいグループの既定色。
 * 個人予定は「担当者の色分け」設定に同名があればその色。
 * それ以外は同じ種別でまだ使っていない色を優先し、使い切っていれば順番に割り当てる
 */
export function defaultGroupColor(
	groups: PlanGroup[],
	kind: PlanKind,
	name: string,
	assigneeColors: AssigneeColor[]
): string {
	if (kind === "personal" && name !== "") {
		const fixed = assigneeColors.find((entry) => entry.name !== "" && entry.name === name);
		if (fixed) return fixed.color;
	}
	const sameKind = groups.filter((g) => g.kind === kind);
	const used = new Set(sameKind.map((g) => g.color.toLowerCase()));
	const unused = PLAN_COLORS.find((c) => !used.has(c.hex));
	if (unused) return unused.hex;
	return PLAN_COLORS[sameKind.length % PLAN_COLORS.length].hex;
}

/**
 * グループ導入前のデータを移行する。戻り値は変更があったか。
 * - 個人予定: 担当者名ごとに個人予定グループを作る(色は担当者の色分け設定を優先)
 * - 全体予定・担当者名なしの個人予定: 種別ごとの「未分類」グループへ
 * - グループIDが不明な予定も「未分類」へ
 */
export function migratePlans(settings: RedmineGanttSettings): boolean {
	let changed = false;
	if (!Array.isArray(settings.planGroups)) {
		settings.planGroups = [];
		changed = true;
	}
	const groups = settings.planGroups;
	const ids = new Set(groups.map((g) => g.id));
	for (const item of settings.planItems) {
		if (item.groupId && ids.has(item.groupId)) continue;
		const kind: PlanKind = item.kind === "personal" ? "personal" : "team";
		const owner = (item.owner ?? "").trim();
		let group: PlanGroup | undefined;
		if (kind === "personal" && owner !== "") {
			group = groups.find((g) => g.kind === "personal" && g.name === owner);
			if (!group) {
				group = {
					id: newPlanId("group"),
					name: owner,
					color: defaultGroupColor(groups, "personal", owner, settings.assigneeColors),
					kind: "personal",
				};
				groups.push(group);
			}
		} else {
			group = ensureUncategorizedGroup(groups, kind);
		}
		ids.add(group.id);
		item.groupId = group.id;
		changed = true;
	}
	return changed;
}

/** 開始日順(未定は末尾)、同日は名前順 */
export function comparePlanItems(a: PlanItem, b: PlanItem): number {
	if (!a.start && !b.start) return a.name.localeCompare(b.name, "ja");
	if (!a.start) return 1;
	if (!b.start) return -1;
	return a.start.localeCompare(b.start) || a.name.localeCompare(b.name, "ja");
}

/** "YYYY-MM-DD" をローカルタイムの日付として解釈する。空文字・不正は null */
export function parsePlanDate(s: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

/** 予定の一括変更を取り消すためのスナップショット */
export interface PlanSnapshot {
	groups: PlanGroup[];
	items: PlanItem[];
}

export function snapshotPlans(settings: RedmineGanttSettings): PlanSnapshot {
	return {
		groups: settings.planGroups.map((g) => ({ ...g })),
		items: settings.planItems.map((item) => ({ ...item })),
	};
}

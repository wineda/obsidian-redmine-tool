import { requestUrl } from "obsidian";
import type { GanttFilter, RedmineGanttSettings } from "../settings";
import type {
	RedmineIssue,
	RedmineIssuesResponse,
	RedmineProject,
	RedmineProjectsResponse,
} from "./types";

const PAGE_SIZE = 100;
// 暴走防止の上限。超えた場合は打ち切って部分結果を返す
const MAX_ISSUES = 10000;
// 親チケット配下の探索で、1リクエストに詰める parent_id の数
const PARENT_CHUNK = 30;

export class RedmineApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

/**
 * Redmine REST API クライアント。
 * 現フェーズは読み取り専用のため公開メソッドは GET 系のみ。
 * 将来のチケット更新対応(Phase 4)では request() の上に PUT を追加する。
 */
export class RedmineClient {
	constructor(private settings: RedmineGanttSettings) {}

	get baseUrl(): string {
		return this.settings.baseUrl.replace(/\/+$/, "");
	}

	issueUrl(issueId: number): string {
		return `${this.baseUrl}/issues/${issueId}`;
	}

	private async request<T>(
		method: "GET",
		path: string,
		params?: Record<string, string>
	): Promise<T> {
		if (!this.baseUrl) {
			throw new RedmineApiError(0, "Redmine URLが設定されていません。プラグイン設定を確認してください。");
		}
		if (!this.settings.apiKey) {
			throw new RedmineApiError(0, "APIキーが設定されていません。プラグイン設定を確認してください。");
		}
		const qs = params ? new URLSearchParams(params).toString() : "";
		const url = `${this.baseUrl}${path}${qs ? "?" + qs : ""}`;

		let response;
		try {
			response = await requestUrl({
				url,
				method,
				headers: {
					"X-Redmine-API-Key": this.settings.apiKey,
					Accept: "application/json",
				},
				throw: false,
			});
		} catch (e) {
			throw new RedmineApiError(
				0,
				`Redmineに接続できません: ${url}\n` +
					`URLの誤り、ネットワーク未到達、または自己署名証明書が原因の可能性があります。(${String(e)})`
			);
		}

		if (response.status === 401) {
			throw new RedmineApiError(401, "認証に失敗しました。APIキーを確認してください。");
		}
		if (response.status === 403) {
			throw new RedmineApiError(
				403,
				"アクセスが拒否されました。REST APIが有効か(管理→設定→API)、プロジェクトの閲覧権限があるか確認してください。"
			);
		}
		if (response.status === 404) {
			throw new RedmineApiError(404, `見つかりません: ${path}(プロジェクト識別子を確認してください)`);
		}
		if (response.status >= 400) {
			throw new RedmineApiError(response.status, `Redmine APIエラー (HTTP ${response.status}): ${path}`);
		}
		return response.json as T;
	}

	private statusParam(): string {
		return this.settings.includeClosed ? "*" : "open";
	}

	/** 指定条件でチケットをページングしながら全件取得する */
	private async fetchIssuesPaged(baseParams: Record<string, string>): Promise<RedmineIssue[]> {
		const issues: RedmineIssue[] = [];
		let offset = 0;
		for (;;) {
			const params: Record<string, string> = {
				...baseParams,
				limit: String(PAGE_SIZE),
				offset: String(offset),
			};
			const res = await this.request<RedmineIssuesResponse>("GET", "/issues.json", params);
			issues.push(...res.issues);
			offset += res.issues.length;
			if (res.issues.length === 0 || offset >= res.total_count || offset >= MAX_ISSUES) {
				break;
			}
		}
		return issues;
	}

	/**
	 * 表示フィルタに応じて対象チケットを取得する。
	 * filter が null のときは設定の既定プロジェクトを使う。
	 */
	async fetchIssues(filter: GanttFilter | null): Promise<RedmineIssue[]> {
		if (!filter || filter.type === "project") {
			return this.fetchProjectIssues(filter ? filter.value : this.settings.projectId);
		}
		if (filter.type === "query") {
			return this.fetchQueryIssues(filter.value);
		}
		return this.fetchSubtreeIssues(filter.value);
	}

	private fetchProjectIssues(projectId: string): Promise<RedmineIssue[]> {
		const params: Record<string, string> = {
			status_id: this.statusParam(),
			sort: "start_date:asc,id:asc",
		};
		if (projectId) {
			params.project_id = projectId;
			// サブプロジェクトのチケットも含める
			params.subproject_id = "*";
		}
		return this.fetchIssuesPaged(params);
	}

	/**
	 * 保存クエリでの取得。value は「クエリID」または「プロジェクト識別子:クエリID」。
	 * 絞り込み条件(ステータス含む)はクエリ側の定義に従うため status_id は付けない。
	 */
	private fetchQueryIssues(value: string): Promise<RedmineIssue[]> {
		const m = value.trim().match(/^(.+):(\d+)$/);
		const params: Record<string, string> = m
			? { project_id: m[1], query_id: m[2] }
			: { query_id: value.trim() };
		if (!/^\d+$/.test(params.query_id)) {
			throw new RedmineApiError(
				0,
				`保存クエリの指定が不正です: "${value}"(クエリID、または「プロジェクト識別子:クエリID」で指定してください)`
			);
		}
		return this.fetchIssuesPaged(params);
	}

	/**
	 * 親チケット配下のツリー全体を取得する。
	 * Redmine APIにサブツリー一括取得はないため、parent_id フィルタで1階層ずつ辿る。
	 * 途中の親が完了済みでも配下を辿れるよう探索は全ステータスで行い、最後に絞り込む。
	 */
	private async fetchSubtreeIssues(value: string): Promise<RedmineIssue[]> {
		const rootId = Number(value.trim());
		if (!Number.isInteger(rootId) || rootId <= 0) {
			throw new RedmineApiError(0, `親チケットIDが不正です: "${value}"(チケット番号を指定してください)`);
		}
		const rootRes = await this.request<{ issue: RedmineIssue }>("GET", `/issues/${rootId}.json`);
		const root = rootRes.issue;

		const result: RedmineIssue[] = [root];
		const seen = new Set<number>([rootId]);
		let frontier: number[] = [rootId];

		while (frontier.length > 0 && result.length < MAX_ISSUES) {
			const next: number[] = [];
			for (let i = 0; i < frontier.length; i += PARENT_CHUNK) {
				const chunk = frontier.slice(i, i + PARENT_CHUNK);
				const children = await this.fetchIssuesPaged({
					parent_id: chunk.join("|"),
					status_id: "*",
					sort: "start_date:asc,id:asc",
				});
				for (const child of children) {
					if (!seen.has(child.id)) {
						seen.add(child.id);
						result.push(child);
						next.push(child.id);
					}
				}
			}
			frontier = next;
		}

		if (!this.settings.includeClosed) {
			// ルートは表示の起点なので残す
			return result.filter((issue) => issue.id === rootId || !issue.closed_on);
		}
		return result;
	}

	/** 接続テスト等に使うプロジェクト一覧取得 */
	async fetchProjects(): Promise<RedmineProject[]> {
		const res = await this.request<RedmineProjectsResponse>("GET", "/projects.json", {
			limit: String(PAGE_SIZE),
		});
		return res.projects;
	}
}

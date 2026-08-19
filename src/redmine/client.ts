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
			throw new RedmineApiError(404, `見つかりません (HTTP 404): ${path}`);
		}
		if (response.status >= 400) {
			throw new RedmineApiError(response.status, `Redmine APIエラー (HTTP ${response.status}): ${path}`);
		}
		return response.json as T;
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
	 * 負荷対策のためプロジェクト全体の取得は提供せず、フィルタの指定が必須。
	 */
	async fetchIssues(filter: GanttFilter): Promise<RedmineIssue[]> {
		if (filter.type === "query") {
			return this.fetchQueryIssues(filter.value);
		}
		return this.fetchSubtreeIssues(filter.value);
	}

	/**
	 * 保存クエリでの取得。value は「クエリID」または「プロジェクト識別子:クエリID」。
	 * 絞り込み条件(ステータス含む)はクエリ側の定義に従うため status_id は付けない。
	 */
	private async fetchQueryIssues(value: string): Promise<RedmineIssue[]> {
		// 全角コロンでの区切りも受け付ける
		const m = value.trim().match(/^(.+)[::](\d+)$/);
		const params: Record<string, string> = m
			? { project_id: m[1].trim(), query_id: m[2] }
			: { query_id: value.trim() };
		if (!/^\d+$/.test(params.query_id)) {
			throw new RedmineApiError(
				0,
				`保存クエリの指定が不正です: "${value}"(クエリID、または「プロジェクト識別子:クエリID」で指定してください)`
			);
		}
		try {
			return await this.fetchIssuesPaged(params);
		} catch (e) {
			if (e instanceof RedmineApiError && e.status === 404) {
				throw new RedmineApiError(
					404,
					`保存クエリ(ID: ${params.query_id})が見つかりません。次を確認してください:\n` +
						`・クエリIDが正しいか(Redmineのチケット一覧URLの query_id= の数値)\n` +
						`・APIキーのユーザーがそのクエリを使えるか(自分のクエリ、または公開クエリのみ)\n` +
						`・プロジェクト内で保存したクエリは「プロジェクト識別子:クエリID」の形式で指定` +
						(params.project_id ? `(現在の指定プロジェクト: ${params.project_id})` : "")
				);
			}
			throw e;
		}
	}

	/**
	 * 親チケット配下のツリー全体を取得する。
	 * parent_id の「~」演算子(指定チケットの全子孫を再帰的に返す)で一括取得し、
	 * 対応していないRedmineでは1親ずつ辿るBFSにフォールバックする。
	 * 完了チケットの表示/非表示はビュー側で切り替えるため、取得は常に全ステータスで行う。
	 */
	private async fetchSubtreeIssues(value: string): Promise<RedmineIssue[]> {
		const rootId = Number(value.trim());
		if (!Number.isInteger(rootId) || rootId <= 0) {
			throw new RedmineApiError(0, `親チケットIDが不正です: "${value}"(チケット番号を指定してください)`);
		}
		let root: RedmineIssue;
		try {
			const rootRes = await this.request<{ issue: RedmineIssue }>("GET", `/issues/${rootId}.json`);
			root = rootRes.issue;
		} catch (e) {
			if (e instanceof RedmineApiError && e.status === 404) {
				throw new RedmineApiError(
					404,
					`チケット #${rootId} が見つかりません。チケット番号と閲覧権限を確認してください。`
				);
			}
			throw e;
		}

		let descendants: RedmineIssue[] | null = null;
		try {
			descendants = await this.fetchIssuesPaged({
				parent_id: `~${rootId}`,
				status_id: "*",
				sort: "start_date:asc,id:asc",
			});
		} catch {
			// 「~」演算子が使えないRedmineではBFSで代替する
			descendants = null;
		}
		if (descendants === null || descendants.length === 0) {
			descendants = await this.crawlDescendants(rootId);
		}

		const seen = new Set<number>([rootId]);
		const result: RedmineIssue[] = [root];
		for (const issue of descendants) {
			if (!seen.has(issue.id)) {
				seen.add(issue.id);
				result.push(issue);
			}
		}
		return result;
	}

	/**
	 * フォールバック: parent_id を1件ずつ指定して階層を辿る。
	 * Redmineの parent_id フィルタは「a|b」の複数指定でも先頭の値しか評価しないため、
	 * 必ず1リクエスト1親で問い合わせる。
	 */
	private async crawlDescendants(rootId: number): Promise<RedmineIssue[]> {
		const result: RedmineIssue[] = [];
		const seen = new Set<number>([rootId]);
		let frontier: number[] = [rootId];

		while (frontier.length > 0 && result.length < MAX_ISSUES) {
			const next: number[] = [];
			for (const parentId of frontier) {
				const children = await this.fetchIssuesPaged({
					parent_id: String(parentId),
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

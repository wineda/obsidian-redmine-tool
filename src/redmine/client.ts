import { requestUrl } from "obsidian";
import type { RedmineGanttSettings } from "../settings";
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
			throw new RedmineApiError(404, `見つかりません: ${path}(プロジェクト識別子を確認してください)`);
		}
		if (response.status >= 400) {
			throw new RedmineApiError(response.status, `Redmine APIエラー (HTTP ${response.status}): ${path}`);
		}
		return response.json as T;
	}

	/** 設定に基づき、対象チケットをページングしながら全件取得する */
	async fetchIssues(): Promise<RedmineIssue[]> {
		const issues: RedmineIssue[] = [];
		let offset = 0;
		for (;;) {
			const params: Record<string, string> = {
				limit: String(PAGE_SIZE),
				offset: String(offset),
				status_id: this.settings.includeClosed ? "*" : "open",
				sort: "start_date:asc,id:asc",
			};
			if (this.settings.projectId) {
				params.project_id = this.settings.projectId;
				// サブプロジェクトのチケットも含める
				params.subproject_id = "*";
			}
			const res = await this.request<RedmineIssuesResponse>("GET", "/issues.json", params);
			issues.push(...res.issues);
			offset += res.issues.length;
			if (res.issues.length === 0 || offset >= res.total_count || offset >= MAX_ISSUES) {
				break;
			}
		}
		return issues;
	}

	/** 接続テスト等に使うプロジェクト一覧取得 */
	async fetchProjects(): Promise<RedmineProject[]> {
		const res = await this.request<RedmineProjectsResponse>("GET", "/projects.json", {
			limit: String(PAGE_SIZE),
		});
		return res.projects;
	}
}

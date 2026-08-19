/** Redmine REST API のレスポンス型(利用するフィールドのみ定義) */

export interface RedmineNamedRef {
	id: number;
	name: string;
}

export interface RedmineCustomField {
	id: number;
	name: string;
	value: string | string[] | null;
}

export interface RedmineIssue {
	id: number;
	subject: string;
	description?: string;
	project: RedmineNamedRef;
	tracker: RedmineNamedRef;
	status: RedmineNamedRef;
	priority?: RedmineNamedRef;
	assigned_to?: RedmineNamedRef;
	fixed_version?: RedmineNamedRef;
	parent?: { id: number };
	start_date?: string; // "YYYY-MM-DD"
	due_date?: string; // "YYYY-MM-DD"
	done_ratio: number; // 0-100
	custom_fields?: RedmineCustomField[];
	created_on: string; // ISO 8601
	updated_on: string; // ISO 8601 — 将来の更新対応(楽観ロック)で使用
	closed_on?: string;
}

export interface RedmineIssuesResponse {
	issues: RedmineIssue[];
	total_count: number;
	offset: number;
	limit: number;
}

export interface RedmineProject {
	id: number;
	name: string;
	identifier: string;
}

export interface RedmineProjectsResponse {
	projects: RedmineProject[];
	total_count: number;
	offset: number;
	limit: number;
}

export interface RedmineQuery {
	id: number;
	name: string;
	is_public: boolean;
	/** プロジェクトスコープのクエリのみ設定される */
	project_id?: number | null;
}

export interface RedmineQueriesResponse {
	queries: RedmineQuery[];
	total_count: number;
	offset: number;
	limit: number;
}

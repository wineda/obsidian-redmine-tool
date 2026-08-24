import { ItemView, Platform, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type RedmineGanttPlugin from "../main";

export const VIEW_TYPE_REDMINE_WEB = "redmine-web-view";

/** Electronのwebviewタグ(公式の型定義がないため必要な範囲のみ) */
interface WebviewElement extends HTMLElement {
	src: string;
}

/**
 * Redmine本体をObsidian内に表示するビュー。
 * RedmineはX-Frame-Options: SAMEORIGINを返すためiframeでは埋め込めない。
 * トップレベルフレーム扱いでこのヘッダの影響を受けないElectronのwebviewを使う
 * (そのためデスクトップ版限定。ログインCookieはpartition内に保持される)
 */
export class RedmineWebView extends ItemView {
	private plugin: RedmineGanttPlugin;
	private currentUrl = "";
	private webviewEl: WebviewElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: RedmineGanttPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_REDMINE_WEB;
	}

	getDisplayText(): string {
		return "Redmine";
	}

	getIcon(): string {
		return "globe";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("rg-web-view");
		// webviewの height: 100% は親のレイアウト次第で潰れることがあるため、
		// ペイン全体への絶対配置で常に埋める(CSS未更新の環境でも効くようインライン指定)
		this.contentEl.style.padding = "0";
		this.contentEl.style.position = "relative";
		this.contentEl.style.overflow = "hidden";

		if (!Platform.isDesktopApp) {
			this.contentEl.createDiv({
				cls: "rg-empty",
				text: "RedmineビューはObsidianデスクトップ版のみ対応です。",
			});
			return;
		}

		// URL未指定でこのビューを開いたときはRedmineのトップを表示する
		if (!this.currentUrl) {
			this.currentUrl = this.plugin.settings.baseUrl;
		}

		const webview = document.createElement("webview") as WebviewElement;
		webview.setAttribute("partition", "persist:redmine-gantt");
		webview.setAttribute("allowpopups", "true");
		if (this.currentUrl) webview.setAttribute("src", this.currentUrl);
		webview.addClass("rg-webview");
		webview.style.position = "absolute";
		webview.style.inset = "0";
		webview.style.width = "100%";
		webview.style.height = "100%";
		this.contentEl.appendChild(webview);
		this.webviewEl = webview;
	}

	/** 表示URLを切り替える(ビュー未生成ならonOpen時に読み込む) */
	navigate(url: string): void {
		this.currentUrl = url;
		if (this.webviewEl) {
			this.webviewEl.setAttribute("src", url);
		}
	}

	/** ワークスペース保存・復元用にURLを保持する */
	getState(): Record<string, unknown> {
		return { url: this.currentUrl };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const url = (state as { url?: unknown } | null)?.url;
		if (typeof url === "string" && url) {
			this.navigate(url);
		}
		await super.setState(state, result);
	}

	async onClose(): Promise<void> {
		this.webviewEl = null;
		this.contentEl.empty();
	}
}

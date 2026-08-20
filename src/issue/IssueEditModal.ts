import { App, Modal, Notice, Setting } from "obsidian";
import { RedmineClient } from "../redmine/client";
import { DELIVERY_FIELD_NAME } from "../redmine/mapper";
import type {
	RedmineIssue,
	RedmineIssueStatus,
	RedmineIssueUpdate,
	RedmineNamedRef,
} from "../redmine/types";

/**
 * チケット編集モーダル。
 * 開くたびに最新のチケットを取得して表示し、変更したフィールドだけを
 * PUT /issues/:id.json で送信する。
 */
export class IssueEditModal extends Modal {
	private client: RedmineClient;
	private issueId: number;
	private onSaved: (updated: RedmineIssue) => void;

	private issue: RedmineIssue | null = null;
	private statuses: RedmineIssueStatus[] = [];
	private members: RedmineNamedRef[] = [];
	private saving = false;

	// フォームの入力値
	private statusId = 0;
	private assigneeId = ""; // user id の文字列。空は未割当
	private startDate = "";
	private dueDate = "";
	private delivery = "";
	private doneRatio = 0;
	private deliveryFieldId: number | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		client: RedmineClient,
		issueId: number,
		onSaved: (updated: RedmineIssue) => void
	) {
		super(app);
		this.client = client;
		this.issueId = issueId;
		this.onSaved = onSaved;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: `#${this.issueId} を読み込み中…` });
		try {
			const [issue, statuses] = await Promise.all([
				this.client.fetchIssue(this.issueId),
				this.client.fetchStatuses(),
			]);
			this.issue = issue;
			this.statuses = statuses;
			try {
				this.members = await this.client.fetchProjectMembers(issue.project.id);
			} catch {
				// メンバー一覧が取得できない場合は現担当者のみを候補にする
				this.members = [];
			}
			if (issue.assigned_to && !this.members.some((m) => m.id === issue.assigned_to!.id)) {
				this.members.unshift(issue.assigned_to);
			}

			this.applyIssue(issue);
			this.renderForm();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			contentEl.empty();
			contentEl.createEl("h3", { text: `#${this.issueId} の読み込みに失敗` });
			contentEl.createDiv({ cls: "rg-error", text: message });
		}
	}

	/** チケットの現在値をフォームの入力値へ反映する */
	private applyIssue(issue: RedmineIssue): void {
		this.issue = issue;
		this.statusId = issue.status.id;
		this.assigneeId = issue.assigned_to ? String(issue.assigned_to.id) : "";
		this.startDate = issue.start_date ?? "";
		this.dueDate = issue.due_date ?? "";
		this.doneRatio = issue.done_ratio ?? 0;
		const deliveryField = issue.custom_fields?.find((f) => f.name === DELIVERY_FIELD_NAME);
		if (deliveryField) {
			this.deliveryFieldId = deliveryField.id;
			this.delivery = Array.isArray(deliveryField.value)
				? deliveryField.value.join(", ")
				: deliveryField.value ?? "";
		} else {
			this.deliveryFieldId = null;
			this.delivery = "";
		}
	}

	private renderForm(): void {
		const issue = this.issue;
		if (!issue) return;
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: `#${issue.id} ${issue.subject}` });
		contentEl.createDiv({
			cls: "rg-edit-meta",
			text: `${issue.project.name} / ${issue.tracker.name}`,
		});

		new Setting(contentEl).setName("ステータス").addDropdown((dropdown) => {
			for (const status of this.statuses) {
				dropdown.addOption(String(status.id), status.name);
			}
			dropdown.setValue(String(this.statusId)).onChange((value) => {
				this.statusId = Number(value);
			});
		});

		new Setting(contentEl).setName("担当者").addDropdown((dropdown) => {
			dropdown.addOption("", "(未割当)");
			for (const member of this.members) {
				dropdown.addOption(String(member.id), member.name);
			}
			dropdown.setValue(this.assigneeId).onChange((value) => {
				this.assigneeId = value;
			});
		});

		new Setting(contentEl).setName("開始日").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.startDate).onChange((value) => {
				this.startDate = value;
			});
		});

		new Setting(contentEl).setName("期日").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.dueDate).onChange((value) => {
				this.dueDate = value;
			});
		});

		if (this.deliveryFieldId !== null) {
			new Setting(contentEl).setName("納期").addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.delivery).onChange((value) => {
					this.delivery = value;
				});
			});
		}

		new Setting(contentEl).setName("進捗率").addDropdown((dropdown) => {
			for (let ratio = 0; ratio <= 100; ratio += 10) {
				dropdown.addOption(String(ratio), `${ratio}%`);
			}
			dropdown.setValue(String(this.doneRatio)).onChange((value) => {
				this.doneRatio = Number(value);
			});
		});

		// 保存失敗・未反映時のエラー表示欄(通常は非表示)
		this.errorEl = contentEl.createDiv({ cls: "rg-error rg-edit-error" });
		this.errorEl.hide();

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("保存")
					.setCta()
					.onClick(() => void this.save())
			)
			.addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
	}

	private showSaveError(message: string): void {
		if (this.errorEl) {
			this.errorEl.setText(message);
			this.errorEl.show();
		}
	}

	/** 更新後のチケットと送信内容を突き合わせ、反映されなかった項目名を返す */
	private findUnappliedFields(updated: RedmineIssue, payload: RedmineIssueUpdate): string[] {
		const unapplied: string[] = [];
		if (payload.status_id !== undefined && updated.status.id !== payload.status_id) {
			unapplied.push("ステータス");
		}
		if (payload.assigned_to_id !== undefined) {
			const actual = updated.assigned_to ? String(updated.assigned_to.id) : "";
			const expected = payload.assigned_to_id === "" ? "" : String(payload.assigned_to_id);
			if (actual !== expected) unapplied.push("担当者");
		}
		if (payload.start_date !== undefined && (updated.start_date ?? "") !== payload.start_date) {
			unapplied.push("開始日");
		}
		if (payload.due_date !== undefined && (updated.due_date ?? "") !== payload.due_date) {
			unapplied.push("期日");
		}
		if (payload.done_ratio !== undefined && (updated.done_ratio ?? 0) !== payload.done_ratio) {
			unapplied.push("進捗率");
		}
		for (const field of payload.custom_fields ?? []) {
			const current = updated.custom_fields?.find((f) => f.id === field.id);
			const value = Array.isArray(current?.value)
				? current.value.join(", ")
				: current?.value ?? "";
			if (value !== field.value) unapplied.push("納期");
		}
		return unapplied;
	}

	/** 変更されたフィールドだけを集めた更新ペイロード。変更なしなら null */
	private buildPayload(): RedmineIssueUpdate | null {
		const issue = this.issue;
		if (!issue) return null;
		const payload: RedmineIssueUpdate = {};

		if (this.statusId !== issue.status.id) payload.status_id = this.statusId;

		const currentAssignee = issue.assigned_to ? String(issue.assigned_to.id) : "";
		if (this.assigneeId !== currentAssignee) {
			payload.assigned_to_id = this.assigneeId === "" ? "" : Number(this.assigneeId);
		}

		if (this.startDate !== (issue.start_date ?? "")) payload.start_date = this.startDate;
		if (this.dueDate !== (issue.due_date ?? "")) payload.due_date = this.dueDate;
		if ((this.doneRatio ?? 0) !== (issue.done_ratio ?? 0)) payload.done_ratio = this.doneRatio;

		if (this.deliveryFieldId !== null) {
			const field = issue.custom_fields?.find((f) => f.id === this.deliveryFieldId);
			const current = Array.isArray(field?.value)
				? field.value.join(", ")
				: field?.value ?? "";
			if (this.delivery !== current) {
				payload.custom_fields = [{ id: this.deliveryFieldId, value: this.delivery }];
			}
		}

		return Object.keys(payload).length > 0 ? payload : null;
	}

	private async save(): Promise<void> {
		if (this.saving || !this.issue) return;
		const payload = this.buildPayload();
		if (!payload) {
			this.close();
			return;
		}
		this.saving = true;
		console.log(`[Redmine Gantt] #${this.issueId} 保存開始`, JSON.stringify(payload));
		try {
			await this.client.updateIssue(this.issueId, payload);
			// PUTが成功(2xx)でも、ワークフローの制限などでRedmineが変更を黙って
			// 無視することがあるため、再取得して実際に反映されたかを確認する
			const updated = await this.client.fetchIssue(this.issueId);
			const unapplied = this.findUnappliedFields(updated, payload);
			this.onSaved(updated);
			if (unapplied.length > 0) {
				console.warn(
					`[Redmine Gantt] #${this.issueId} 保存は受理されたが未反映の項目あり: ` +
						unapplied.join("・"),
					JSON.stringify({ payload, server: updated })
				);
				new Notice(`#${this.issueId}: ${unapplied.join("・")} が反映されませんでした`, 8000);
				// フォームをサーバの現在値で描画し直し、モーダルは開いたままにする
				this.applyIssue(updated);
				this.renderForm();
				this.showSaveError(
					`サーバは更新を受け付けましたが、次の項目が反映されていません: ${unapplied.join("・")}\n` +
						`ワークフロー(ステータス遷移)の制限や権限が原因の可能性があります。\n` +
						`フォームはサーバの現在値に更新しました。`
				);
				return;
			}
			console.log(`[Redmine Gantt] #${this.issueId} 保存成功(全項目の反映を確認)`);
			new Notice(`#${this.issueId} を更新しました`);
			this.close();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[Redmine Gantt] #${this.issueId} 保存失敗`, e);
			new Notice(`Redmine Gantt: ${message}`, 8000);
			this.showSaveError(`保存に失敗しました:\n${message}`);
		} finally {
			this.saving = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

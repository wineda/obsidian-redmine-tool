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
			}

			this.renderForm();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			contentEl.empty();
			contentEl.createEl("h3", { text: `#${this.issueId} の読み込みに失敗` });
			contentEl.createDiv({ cls: "rg-error", text: message });
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

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("保存")
					.setCta()
					.onClick(() => void this.save())
			)
			.addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
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
		try {
			await this.client.updateIssue(this.issueId, payload);
			const updated = await this.client.fetchIssue(this.issueId);
			new Notice(`#${this.issueId} を更新しました`);
			this.onSaved(updated);
			this.close();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			new Notice(`Redmine Gantt: ${message}`, 8000);
		} finally {
			this.saving = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

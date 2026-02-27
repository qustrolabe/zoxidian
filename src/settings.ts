import { App, PluginSettingTab, Setting } from "obsidian";
import ZoxidianPlugin from "./main";
import { applyAging } from "./frecency";
import { FILE_ICON_SVG } from "./utils";

export interface ZoxidianSettings {
	maxItems: number;
	excludePaths: string;
	openInNewTab: boolean;
	showFrecencyBadge: boolean;
	showScoreBadge: boolean;
	maxAge: number;
	recordOnEveryVisit: boolean;
}

export const DEFAULT_SETTINGS: ZoxidianSettings = {
	maxItems: 50,
	excludePaths: "",
	openInNewTab: false,
	showFrecencyBadge: true,
	showScoreBadge: true,
	maxAge: 9000,
	recordOnEveryVisit: false,
};

export class ZoxidianSettingTab extends PluginSettingTab {
	plugin: ZoxidianPlugin;

	constructor(app: App, plugin: ZoxidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// updatePreview is declared early so toggle onChange handlers can reference it
		// via closure. It will be assigned later in this method. Since onChange only
		// fires on user interaction (after display() has returned), the assignment
		// is always in place before it's ever called.
		let updatePreview: () => void = () => {};

		containerEl.createEl("h2", { text: "Zoxidian" });
		containerEl.createEl("p", {
			cls: "zoxidian-settings-desc",
			text: "Tracks note visits using the zoxide frecency algorithm. Each visit increments the base score; the displayed frecency score is weighted by recency.",
		});

		new Setting(containerEl)
			.setName("Max items")
			.setDesc("Maximum number of notes to show in the panel.")
			.addText((text) =>
				text
					.setPlaceholder("50")
					.setValue(String(this.plugin.settings.maxItems))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxItems = num;
							await this.plugin.persistData();
							this.plugin.view?.redraw();
						}
					})
			);

		new Setting(containerEl)
			.setName("Exclude paths (regex)")
			.setDesc(
				"Notes whose path matches this regex are excluded. Example: ^Daily/"
			)
			.addText((text) =>
				text
					.setPlaceholder("^Daily/")
					.setValue(this.plugin.settings.excludePaths)
					.onChange(async (value) => {
						this.plugin.settings.excludePaths = value;
						await this.plugin.persistData();
						this.plugin.view?.redraw();
					})
			);

		new Setting(containerEl)
			.setName("Open in new tab by default")
			.setDesc(
				"When enabled, clicking a note opens it in a new tab. You can always Ctrl/Cmd+click to toggle."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openInNewTab)
					.onChange(async (value) => {
						this.plugin.settings.openInNewTab = value;
						await this.plugin.persistData();
					})
			);

		new Setting(containerEl)
			.setName("Record score on every visit")
			.setDesc(
				"Off (default): score increments only when you open a note that has no existing tab. " +
				"Switching focus to an already-open tab does not count, but closing and reopening does. " +
				"On: score increments every time the note becomes active, including tab switches."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.recordOnEveryVisit)
					.onChange(async (value) => {
						this.plugin.settings.recordOnEveryVisit = value;
						await this.plugin.persistData();
					})
			);

		new Setting(containerEl)
			.setName("Show frecency badge")
			.setDesc("Display the frecency score badge (accent colour) next to each note.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFrecencyBadge)
					.onChange(async (value) => {
						this.plugin.settings.showFrecencyBadge = value;
						await this.plugin.persistData();
						this.plugin.view?.redraw();
						updatePreview();
					})
			);

		new Setting(containerEl)
			.setName("Show score badge")
			.setDesc("Display the score badge (muted) next to each note.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showScoreBadge)
					.onChange(async (value) => {
						this.plugin.settings.showScoreBadge = value;
						await this.plugin.persistData();
						this.plugin.view?.redraw();
						updatePreview();
					})
			);

		// ---- Live preview ----

		containerEl.createEl("h3", { text: "Preview" });
		containerEl.createEl("p", {
			cls: "zoxidian-settings-desc",
			text: "How a note row looks with your current badge settings.",
		});

		const previewWrap = containerEl.createEl("div", { cls: "zoxidian-preview-wrap" });

		updatePreview = () => {
			previewWrap.empty();

			const row = previewWrap.createEl("div", { cls: "zoxidian-item" });

			const iconWrap = row.createEl("span", { cls: "zoxidian-item-icon" });
			iconWrap.innerHTML = FILE_ICON_SVG;

			row.createEl("span", {
				cls: "zoxidian-item-name",
				text: "Example Note",
			});

			const badges = row.createEl("span", { cls: "zoxidian-badges" });

			if (this.plugin.settings.showFrecencyBadge) {
				badges.createEl("span", {
					cls: "zoxidian-badge zoxidian-badge-frecency",
					text: "8.0",
				});
			}

			if (this.plugin.settings.showScoreBadge) {
				badges.createEl("span", {
					cls: "zoxidian-badge zoxidian-badge-base",
					text: "4",
				});
			}
		};

		updatePreview();

		// ---- Aging ----

		containerEl.createEl("h3", { text: "Aging" });

		let updateStats: () => void = () => {};

		let pendingMaxAge: number | null = null;
		let applyBtnEl: HTMLButtonElement | null = null;
		let showWarning: (num: number, total: number) => void = () => {};
		let hideWarning: () => void = () => {};

		new Setting(containerEl)
			.setName("Max age")
			.setDesc(
				"Maximum total score across all notes (zoxide default: 9000). " +
				"When the sum of all base scores exceeds this, every score is scaled " +
				"down proportionally and notes that fall below 1 are pruned."
			)
			.addText((text) =>
				text
					.setPlaceholder("9000")
					.setValue(String(this.plugin.settings.maxAge))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							const total = this.plugin.getTotalScore();
							if (num < total) {
								pendingMaxAge = num;
								showWarning(num, total);
							} else {
								pendingMaxAge = null;
								hideWarning();
								this.plugin.settings.maxAge = num;
								applyAging(this.plugin.files, num);
								await this.plugin.persistData();
								this.plugin.view?.redraw();
								updateStats();
							}
						} else {
							pendingMaxAge = null;
							hideWarning();
						}
					})
			)
			.addButton((btn) => {
				btn.setButtonText("Apply").setWarning();
				applyBtnEl = btn.buttonEl;
				applyBtnEl.style.display = "none";
				btn.onClick(async () => {
					if (pendingMaxAge === null) return;
					this.plugin.settings.maxAge = pendingMaxAge;
					applyAging(this.plugin.files, pendingMaxAge);
					await this.plugin.persistData();
					this.plugin.view?.redraw();
					updateStats();
					pendingMaxAge = null;
					hideWarning();
				});
			});

		const maxAgeWarningEl = containerEl.createEl("p", { cls: "zoxidian-maxage-warning" });
		maxAgeWarningEl.style.display = "none";

		showWarning = (num: number, total: number) => {
			const scale = num / total;
			const pruneCount = Object.values(this.plugin.files)
				.filter(e => e.score * scale < 1).length;
			maxAgeWarningEl.setText(
				`Reducing to ${num} will prune ${pruneCount} note(s) ` +
				`(current total: ${total.toFixed(1)}).`
			);
			maxAgeWarningEl.style.display = "";
			if (applyBtnEl) applyBtnEl.style.display = "";
		};

		hideWarning = () => {
			maxAgeWarningEl.style.display = "none";
			if (applyBtnEl) applyBtnEl.style.display = "none";
		};

		// Stats
		const statsEl = containerEl.createEl("div", { cls: "zoxidian-stats" });

		updateStats = () => {
			statsEl.empty();
			const total = this.plugin.getTotalScore();
			const count = Object.keys(this.plugin.files).length;
			const pct   = Math.min(100, (total / this.plugin.settings.maxAge) * 100);

			const grid = statsEl.createEl("div", { cls: "zoxidian-stats-grid" });

			const addStat = (label: string, value: string) => {
				const cell = grid.createEl("div", { cls: "zoxidian-stat" });
				cell.createEl("span", { cls: "zoxidian-stat-value", text: value });
				cell.createEl("span", { cls: "zoxidian-stat-label", text: label });
			};

			addStat("tracked notes", String(count));
			addStat("total score", `${total.toFixed(1)} / ${this.plugin.settings.maxAge}`);
			addStat("age pool used", `${pct.toFixed(1)}%`);

			// Progress bar
			const barWrap = statsEl.createEl("div", { cls: "zoxidian-age-bar-wrap" });
			const bar = barWrap.createEl("div", { cls: "zoxidian-age-bar" });
			bar.style.width = `${pct}%`;
		};

		updateStats();

		// ---- Algorithm ----

		containerEl.createEl("h3", { text: "How it works" });

		const algoEl = containerEl.createEl("div", { cls: "zoxidian-algo" });

		const steps: Array<[string, string]> = [
			[
				"1 · Base score",
				"Every time you open a note its base score increases by 1. " +
				"A note opened 20 times has a base score of 20.",
			],
			[
				"2 · Frecency",
				"When notes are ranked for display, the base score is multiplied by a recency factor " +
				"so freshly-visited notes surface even if they have a low total count:",
			],
			[
				"3 · Aging",
				"When the sum of all base scores exceeds Max age, every score is scaled down " +
				"proportionally so the total equals Max age. " +
				"Notes whose score falls below 1 are pruned. " +
				"This bounds score growth and lets rarely-visited notes fade naturally.",
			],
		];

		for (const [heading, body] of steps) {
			const block = algoEl.createEl("div", { cls: "zoxidian-algo-step" });
			block.createEl("p", { cls: "zoxidian-algo-heading", text: heading });
			block.createEl("p", { cls: "zoxidian-algo-body",    text: body });
		}

		// Frecency table (inline in step 2's block)
		const tableBlock = algoEl.children[1] as HTMLElement;
		const table = tableBlock.createEl("table", { cls: "zoxidian-algo-table" });
		const thead = table.createEl("thead");
		const hrow  = thead.createEl("tr");
		hrow.createEl("th", { text: "Last opened" });
		hrow.createEl("th", { text: "Multiplier" });

		const rows: Array<[string, string]> = [
			["Within the last hour", "× 4"],
			["Within the last day",  "× 2"],
			["Within the last week", "÷ 2"],
			["Longer ago",           "÷ 4"],
		];
		const tbody = table.createEl("tbody");
		for (const [when, mult] of rows) {
			const tr = tbody.createEl("tr");
			tr.createEl("td", { text: when });
			tr.createEl("td", { cls: "zoxidian-algo-mult", text: mult });
		}

		// ---- Data management ----

		containerEl.createEl("h3", { text: "Data management" });

		new Setting(containerEl)
			.setName("Clear all data")
			.setDesc("Remove all tracked visit data. This cannot be undone.")
			.addButton((btn) =>
				btn
					.setButtonText("Clear")
					.setWarning()
					.onClick(async () => {
						this.plugin.clearData();
						await this.plugin.persistData();
						this.plugin.view?.redraw();
						updateStats();
					})
			);
	}
}

import { App, Modal, TFile } from "obsidian";
import type ZoxidianPlugin from "./main";
import type { FileEntry } from "./main";

export class ZoxidianSearchModal extends Modal {
	private plugin: ZoxidianPlugin;
	private query = "";
	private results: Array<{ entry: FileEntry; frecency: number }> = [];
	private selectedIndex = 0;
	private listEl!: HTMLElement;

	constructor(app: App, plugin: ZoxidianPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("zoxidian-modal");

		// Search input
		const inputEl = contentEl.createEl("input", { cls: "zoxidian-modal-input" });
		inputEl.type = "text";
		inputEl.placeholder = "Search recent notes…";
		inputEl.focus();

		// Results list
		this.listEl = contentEl.createEl("div", { cls: "zoxidian-modal-list" });

		// Populate with all entries on open
		this.updateResults("");

		inputEl.addEventListener("input", () => {
			this.query = inputEl.value;
			this.updateResults(this.query);
		});

		inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
				this.renderList();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.renderList();
			} else if (e.key === "Enter") {
				e.preventDefault();
				this.openSelected();
			} else if (e.key === "Escape") {
				this.close();
			}
		});
	}

	private updateResults(query: string): void {
		const all = this.plugin.getSortedEntries();
		const q = query.toLowerCase().trim();

		this.results = q === ""
			? all
			: all.filter(({ entry }) => {
				const basename = entry.path.split("/").pop()?.replace(/\.md$/i, "") ?? entry.path;
				return basename.toLowerCase().includes(q);
			});

		this.selectedIndex = 0;
		this.renderList();
	}

	private renderList(): void {
		this.listEl.empty();

		if (this.results.length === 0) {
			this.listEl.createEl("div", {
				cls: "zoxidian-modal-empty",
				text: "No matching notes.",
			});
			return;
		}

		this.results.forEach(({ entry }, index) => {
			const file = this.app.vault.getAbstractFileByPath(entry.path);
			if (!(file instanceof TFile)) return;

			const row = this.listEl.createEl("div", {
				cls: "zoxidian-modal-item" + (index === this.selectedIndex ? " is-selected" : ""),
			});

			row.createEl("span", {
				cls: "zoxidian-modal-item-name",
				text: file.basename,
			});

			const parentPath = file.parent?.path ?? "";
			if (parentPath && parentPath !== "/") {
				row.createEl("span", {
					cls: "zoxidian-modal-item-path",
					text: parentPath,
				});
			}

			row.addEventListener("click", () => {
				this.selectedIndex = index;
				this.openSelected();
			});

			row.addEventListener("mouseover", () => {
				if (this.selectedIndex !== index) {
					this.selectedIndex = index;
					this.renderList();
				}
			});
		});

		// Scroll selected row into view
		const selected = this.listEl.querySelector(".is-selected") as HTMLElement | null;
		selected?.scrollIntoView({ block: "nearest" });
	}

	private openSelected(): void {
		const result = this.results[this.selectedIndex];
		if (!result) return;

		const file = this.app.vault.getAbstractFileByPath(result.entry.path);
		if (!(file instanceof TFile)) return;

		const leaf = this.plugin.settings.openInNewTab
			? this.app.workspace.getLeaf("tab")
			: this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();

		leaf.openFile(file);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

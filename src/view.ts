import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_ZOXIDIAN } from "./types";
import { getFrecency } from "./frecency";
import { formatScore, FILE_ICON_SVG } from "./utils";
import type ZoxidianPlugin from "./main";

export class ZoxidianView extends ItemView {
	plugin: ZoxidianPlugin;
	private activeFilePath: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ZoxidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string   { return VIEW_TYPE_ZOXIDIAN; }
	getDisplayText(): string { return "Zoxidian"; }
	getIcon(): string        { return "history"; }

	async onOpen(): Promise<void> {
		// Seed with whatever is already open.
		this.activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
		this.redraw();
		// file-open provides the file as an argument — use that instead of
		// querying getActiveFile() at render time, which returns null when
		// the sidebar itself is the focused leaf.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.activeFilePath = file?.path ?? null;
				this.redraw();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && this.activeFilePath === file.path) {
					this.activeFilePath = null;
					// no redraw — handleDelete in the plugin already triggers one
				}
			})
		);
	}

	async onClose(): Promise<void> { /* nothing */ }

	private openOrReveal(file: TFile): void {
		// getLeaf(false) is Obsidian's standard "open in appropriate leaf":
		// reuses the most recent non-pinned main-area leaf, never touches
		// sidebar or pinned leaves — same behaviour as the built-in Files panel.
		this.app.workspace.getLeaf(false).openFile(file);
	}

	redraw(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("zoxidian-container");

		const entries = this.plugin.getSortedEntries();

		if (entries.length === 0) {
			container.createEl("p", {
				cls: "zoxidian-empty",
				text: "No notes visited yet. Open a note to start tracking.",
			});
			return;
		}

		const listEl = container.createEl("div", { cls: "zoxidian-list" });
		for (const { path, entry, frecency } of entries) {
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) continue;

				const row = listEl.createEl("div", { cls: "zoxidian-item" });

				if (path === this.activeFilePath) {
					row.addClass("is-active");
				}

				// File icon
				const iconWrap = row.createEl("span", { cls: "zoxidian-item-icon" });
				iconWrap.innerHTML = FILE_ICON_SVG;

				// Note name
				row.createEl("span", {
					cls: "zoxidian-item-name",
					text: file.basename,
				});

				// Score badges — conditionally rendered based on settings
				const badgeWrap = row.createEl("span", { cls: "zoxidian-badges" });

				if (this.plugin.settings.showFrecencyBadge) {
					const frecBadge = badgeWrap.createEl("span", {
						cls: "zoxidian-badge zoxidian-badge-frecency",
						text: formatScore(frecency),
					});
					frecBadge.setAttribute("aria-label", "Frecency score");
				}

				if (this.plugin.settings.showVisitsBadge) {
					const baseBadge = badgeWrap.createEl("span", {
						cls: "zoxidian-badge zoxidian-badge-base",
						text: formatScore(entry.score),
					});
					baseBadge.setAttribute("aria-label", "Total visits");
				}

				// Tooltip
				row.title =
					`Frecency: ${frecency.toFixed(2)}\n` +
					`Visits: ${entry.score.toFixed(1)}\n` +
					`Last access: ${new Date(entry.lastAccess).toLocaleString()}\n` +
					`Path: ${path}`;

				// Click to open
				row.addEventListener("click", (e: MouseEvent) => {
					const newTab = this.plugin.settings.openInNewTab
						? !(e.ctrlKey || e.metaKey)
						: e.ctrlKey || e.metaKey;

					if (newTab) {
						this.app.workspace.getLeaf("tab").openFile(file);
					} else {
						this.openOrReveal(file);
					}
				});

				// Context menu
				row.addEventListener("contextmenu", (e: MouseEvent) => {
					e.preventDefault();
					const menu = new Menu();

					menu.addItem((item) =>
						item
							.setTitle("Open")
							.setIcon("arrow-right-circle")
							.onClick(() => this.openOrReveal(file))
					);

					menu.addItem((item) =>
						item
							.setTitle("Open in new tab")
							.setIcon("file-plus")
							.onClick(() =>
								this.app.workspace.getLeaf("tab").openFile(file)
							)
					);

					menu.addItem((item) =>
						item
							.setTitle("Open to the right")
							.setIcon("separator-vertical")
							.onClick(() =>
								this.app.workspace.getLeaf("split").openFile(file)
							)
					);

					menu.addSeparator();

					menu.addItem((item) =>
						item
							.setTitle("Remove from list")
							.setIcon("x")
							.onClick(async () => {
								this.plugin.removeEntry(path);
								await this.plugin.persistData();
								this.redraw();
							})
					);

					menu.showAtMouseEvent(e);
				});

				// Drag-and-drop
				row.draggable = true;
				row.addEventListener("dragstart", (e: DragEvent) => {
					const linkText = this.app.metadataCache.fileToLinktext(file, "");
					e.dataTransfer?.setData("text/plain", `[[${linkText}]]`);
					e.dataTransfer?.setData(
						"application/json",
						JSON.stringify({ type: "file", path: file.path })
					);
				});

			} catch (err) {
				console.error(`[Zoxidian] Failed to render row for "${path}":`, err);
				const errRow = listEl.createEl("div", { cls: "zoxidian-item zoxidian-item-error" });
				errRow.createEl("span", { cls: "zoxidian-item-name", text: `⚠ ${path}` });
			}
		}
	}
}

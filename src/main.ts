import {
	App,
	ItemView,
	Menu,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, ZoxidianSettingTab, ZoxidianSettings } from "./settings";
import { ZoxidianSearchModal } from "./modal";

export const VIEW_TYPE_ZOXIDIAN = "zoxidian-view";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface FileEntry {
	path: string;
	/** Raw visit count — the base score in the zoxide model. */
	score: number;
	/** Unix timestamp (ms) of the most recent visit. */
	lastAccess: number;
}

interface PersistedData {
	files: Record<string, FileEntry>;
	settings: ZoxidianSettings;
}

// ---------------------------------------------------------------------------
// Aging — mirrors the zoxide aging mechanic:
//
//   When the sum of all base scores exceeds maxAge, every score is scaled
//   down proportionally so the total equals maxAge. Entries whose score
//   drops below 1 are pruned — they have become irrelevant relative to
//   everything else.
// ---------------------------------------------------------------------------

export function applyAging(files: Record<string, FileEntry>, maxAge: number): void {
	const total = Object.values(files).reduce((sum, e) => sum + e.score, 0);
	if (total <= maxAge) return;

	const scale = maxAge / total;
	for (const path of Object.keys(files)) {
		const entry = files[path];
		if (entry) {
			entry.score *= scale;
			if (entry.score < 1) delete files[path];
		}
	}
}

// ---------------------------------------------------------------------------
// Frecency calculation — mirrors the zoxide weighting table:
//
//   Last access          | Multiplier
//   ---------------------|----------
//   Within the last hour |  × 4
//   Within the last day  |  × 2
//   Within the last week |  ÷ 2
//   Otherwise            |  ÷ 4
// ---------------------------------------------------------------------------

export function getFrecency(entry: FileEntry, now = Date.now()): number {
	const elapsed = now - entry.lastAccess;
	const HOUR = 60 * 60 * 1000;
	const DAY  = 24 * HOUR;
	const WEEK = 7  * DAY;

	if (elapsed < HOUR)  return entry.score * 4;
	if (elapsed < DAY)   return entry.score * 2;
	if (elapsed < WEEK)  return entry.score / 2;
	return entry.score / 4;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a frecency score for display.
 * Whole numbers are shown without decimals; others show one decimal place.
 */
function formatScore(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return function (this: unknown, ...args: Parameters<T>) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), ms);
	} as T;
}

// ---------------------------------------------------------------------------
// Sidebar view
// ---------------------------------------------------------------------------

export class ZoxidianView extends ItemView {
	plugin: ZoxidianPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ZoxidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string   { return VIEW_TYPE_ZOXIDIAN; }
	getDisplayText(): string { return "Zoxidian"; }
	getIcon(): string        { return "history"; }

	async onOpen(): Promise<void> {
		this.redraw();
		// Re-render when the active file changes so the highlight stays current.
		this.registerEvent(
			this.app.workspace.on("file-open", () => this.redraw())
		);
	}

	async onClose(): Promise<void> { /* nothing */ }

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
		const activeFile = this.app.workspace.getActiveFile();

		for (const { entry, frecency } of entries) {
			try {
				const file = this.app.vault.getAbstractFileByPath(entry.path);
				if (!(file instanceof TFile)) continue;

				const row = listEl.createEl("div", { cls: "zoxidian-item" });

				if (activeFile?.path === entry.path) {
					row.addClass("is-active");
				}

				// File icon
				const iconWrap = row.createEl("span", { cls: "zoxidian-item-icon" });
				iconWrap.innerHTML =
					`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ` +
					`stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
					`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>` +
					`<polyline points="14 2 14 8 20 8"/></svg>`;

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
						text: String(entry.score),
					});
					baseBadge.setAttribute("aria-label", "Total visits");
				}

				// Tooltip
				row.title =
					`Frecency: ${frecency.toFixed(2)}\n` +
					`Visits: ${entry.score}\n` +
					`Last access: ${new Date(entry.lastAccess).toLocaleString()}\n` +
					`Path: ${entry.path}`;

				// Click to open
				row.addEventListener("click", (e: MouseEvent) => {
					const newTab = this.plugin.settings.openInNewTab
						? !(e.ctrlKey || e.metaKey)
						: e.ctrlKey || e.metaKey;

					const leaf = newTab
						? this.app.workspace.getLeaf("tab")
						: this.app.workspace.getMostRecentLeaf() ??
						  this.app.workspace.getLeaf();
					leaf.openFile(file);
				});

				// Context menu
				row.addEventListener("contextmenu", (e: MouseEvent) => {
					e.preventDefault();
					const menu = new Menu();

					menu.addItem((item) =>
						item
							.setTitle("Open")
							.setIcon("arrow-right-circle")
							.onClick(() => {
								const leaf =
									this.app.workspace.getMostRecentLeaf() ??
									this.app.workspace.getLeaf();
								leaf.openFile(file);
							})
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
								this.plugin.removeEntry(entry.path);
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
				console.error(`[Zoxidian] Failed to render row for "${entry.path}":`, err);
				const errRow = listEl.createEl("div", { cls: "zoxidian-item zoxidian-item-error" });
				errRow.createEl("span", { cls: "zoxidian-item-name", text: `⚠ ${entry.path}` });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Main plugin class
// ---------------------------------------------------------------------------

export default class ZoxidianPlugin extends Plugin {
	settings: ZoxidianSettings = { ...DEFAULT_SETTINGS };
	files: Record<string, FileEntry> = {};
	view: ZoxidianView | null = null;
	private debouncedPersist!: () => void;

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async onload() {
		this.debouncedPersist = debounce(() => this.persistData(), 500);

		await this.initData();

		this.registerView(VIEW_TYPE_ZOXIDIAN, (leaf) => {
			this.view = new ZoxidianView(leaf, this);
			return this.view;
		});

		this.addRibbonIcon("history", "Zoxidian", () => this.activateView());

		this.addCommand({
			id:   "open-panel",
			name: "Open Zoxidian panel",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id:   "search-notes",
			name: "Search recent notes",
			callback: () => new ZoxidianSearchModal(this.app, this).open(),
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file instanceof TFile) this.recordVisit(file);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) this.handleRename(oldPath, file.path);
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) this.handleDelete(file.path);
			})
		);

		this.addSettingTab(new ZoxidianSettingTab(this.app, this));

		if (this.app.workspace.layoutReady) {
			this.activateView();
		} else {
			this.app.workspace.onLayoutReady(() => this.activateView());
		}
	}

	onunload() { /* Obsidian cleans up registered events */ }

	// -------------------------------------------------------------------------
	// Data I/O
	// -------------------------------------------------------------------------

	async initData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
		this.files    = raw?.files ?? {};
	}

	async persistData(): Promise<void> {
		await this.saveData({ files: this.files, settings: this.settings } as PersistedData);
	}

	clearData(): void {
		this.files = {};
	}

	// -------------------------------------------------------------------------
	// Visit tracking
	// -------------------------------------------------------------------------

	recordVisit(file: TFile): void {
		const existing = this.files[file.path];
		if (existing) {
			existing.score      += 1;
			existing.lastAccess  = Date.now();
		} else {
			this.files[file.path] = { path: file.path, score: 1, lastAccess: Date.now() };
		}
		applyAging(this.files, this.settings.maxAge);
		this.debouncedPersist();
		this.view?.redraw();
	}

	getTotalScore(): number {
		return Object.values(this.files).reduce((sum, e) => sum + e.score, 0);
	}

	handleRename(oldPath: string, newPath: string): void {
		const entry = this.files[oldPath];
		if (!entry) return;
		this.files[newPath] = { ...entry, path: newPath };
		delete this.files[oldPath];
		this.persistData();
		this.view?.redraw();
	}

	handleDelete(path: string): void {
		if (!this.files[path]) return;
		delete this.files[path];
		this.persistData();
		this.view?.redraw();
	}

	removeEntry(path: string): void {
		delete this.files[path];
	}

	// -------------------------------------------------------------------------
	// Sorted entry list (used by the view and search modal)
	// -------------------------------------------------------------------------

	getSortedEntries(): Array<{ entry: FileEntry; frecency: number }> {
		let excludeRegex: RegExp | null = null;
		if (this.settings.excludePaths.trim()) {
			try {
				excludeRegex = new RegExp(this.settings.excludePaths);
			} catch {
				// Invalid regex — skip the filter rather than crash.
			}
		}

		const now = Date.now();

		return Object.values(this.files)
			.filter((e) => !excludeRegex || !excludeRegex.test(e.path))
			.map((entry) => ({ entry, frecency: getFrecency(entry, now) }))
			.sort((a, b) => b.frecency - a.frecency)
			.slice(0, this.settings.maxItems);
	}

	// -------------------------------------------------------------------------
	// View management
	// -------------------------------------------------------------------------

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_ZOXIDIAN);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_ZOXIDIAN, active: true });
			workspace.revealLeaf(leaf);
		}
	}
}

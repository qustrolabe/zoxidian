import { Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, ZoxidianSettingTab, ZoxidianSettings } from "./settings";
import { ZoxidianSearchModal } from "./modal";
import { VIEW_TYPE_ZOXIDIAN, FileEntry } from "./types";
import { applyAging, getFrecency } from "./frecency";
import { debounce } from "./utils";
import { ZoxidianView } from "./view";

interface PersistedData {
	files: Record<string, FileEntry>;
	settings: ZoxidianSettings;
}

// ---------------------------------------------------------------------------
// Main plugin class
// ---------------------------------------------------------------------------

export default class ZoxidianPlugin extends Plugin {
	settings: ZoxidianSettings = { ...DEFAULT_SETTINGS };
	files: Record<string, FileEntry> = {};
	private debouncedPersist!: () => void;
	// Snapshot of open-path counts from the previous workspace state. This is
	// used to decide whether a file-open is a fresh open or a tab switch.
	private openPathCounts = new Map<string, number>();

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async onload() {
		this.debouncedPersist = debounce(() => this.persistData(), 500);

		await this.initData();

		this.registerView(VIEW_TYPE_ZOXIDIAN, (leaf) => {
			return new ZoxidianView(leaf, this);
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

		// Seed previous open-path snapshot from whatever is open at load time.
		this.rebuildOpenPathCounts();

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.rebuildOpenPathCounts();
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile)) return;
				const wasAlreadyOpen = (this.openPathCounts.get(file.path) ?? 0) > 0;
				this.rebuildOpenPathCounts();
				this.recordVisit(file, wasAlreadyOpen);
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
	}

	// Called only when the user explicitly enables the plugin — not on every
	// app startup. The right place to reveal the leaf for the first time.
	onUserEnable(): void {
		this.app.workspace.ensureSideLeaf(VIEW_TYPE_ZOXIDIAN, "left", { reveal: true });
	}

	onunload() { /* Obsidian cleans up registered events */ }

	private rebuildOpenPathCounts(): void {
		const next = new Map<string, number>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const f = (leaf.view as any)?.file;
			if (f instanceof TFile) {
				next.set(f.path, (next.get(f.path) ?? 0) + 1);
			}
		});
		this.openPathCounts = next;
	}

	// -------------------------------------------------------------------------
	// Data I/O
	// -------------------------------------------------------------------------

	async initData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
		this.files    = (typeof raw?.files === "object" && raw.files !== null && !Array.isArray(raw.files))
			? raw.files as Record<string, FileEntry>
			: {};
	}

	async persistData(): Promise<void> {
		await this.saveData({ files: this.files, settings: this.settings } as PersistedData);
	}

	clearData(): void {
		this.files = {};
		this.debouncedPersist();
	}

	// -------------------------------------------------------------------------
	// Visit tracking
	// -------------------------------------------------------------------------

	recordVisit(file: TFile, wasAlreadyOpen: boolean): void {
		// In "on open" mode, skip if this file already had a leaf (tab switch).
		if (!this.settings.recordOnEveryVisit && wasAlreadyOpen) return;

		const existing = this.files[file.path];
		if (existing) {
			existing.score      += 1;
			existing.lastAccess  = Date.now();
		} else {
			this.files[file.path] = { score: 1, lastAccess: Date.now() };
		}
		applyAging(this.files, this.settings.maxAge);
		this.debouncedPersist();
		this.redrawViews();
	}

	getTotalScore(): number {
		return Object.values(this.files).reduce((sum, e) => sum + e.score, 0);
	}

	handleRename(oldPath: string, newPath: string): void {
		const entry = this.files[oldPath];
		if (!entry) return;

		// Merge into existing entry for newPath (if any), rather than overwriting.
		const existing = this.files[newPath];
		this.files[newPath] = existing
			? { score: existing.score + entry.score, lastAccess: Math.max(existing.lastAccess, entry.lastAccess) }
			: { ...entry };
		delete this.files[oldPath];

		// Keep open-path snapshot consistent across renames.
		const oldCount = this.openPathCounts.get(oldPath) ?? 0;
		if (oldCount > 0) {
			this.openPathCounts.delete(oldPath);
			this.openPathCounts.set(newPath, (this.openPathCounts.get(newPath) ?? 0) + oldCount);
		}

		this.notifyRenameInViews(oldPath, newPath);  // update activeFilePath before redraw
		this.debouncedPersist();   // was: this.persistData() — debounce for bulk folder moves
		this.redrawViews();
	}

	handleDelete(path: string): void {
		if (!this.files[path]) return;
		delete this.files[path];
		this.persistData();
		this.redrawViews();
	}

	removeEntry(path: string): void {
		delete this.files[path];
	}

	private getZoxidianViews(): ZoxidianView[] {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOXIDIAN)
			.map(leaf => leaf.view)
			.filter((view): view is ZoxidianView => view instanceof ZoxidianView);
	}

	redrawViews(): void {
		for (const view of this.getZoxidianViews()) {
			view.redraw();
		}
	}

	private notifyRenameInViews(oldPath: string, newPath: string): void {
		for (const view of this.getZoxidianViews()) {
			view.notifyRename(oldPath, newPath);
		}
	}

	// -------------------------------------------------------------------------
	// Sorted entry list (used by the view and search modal)
	// -------------------------------------------------------------------------

	getSortedEntries(applyLimit = true): Array<{ path: string; entry: FileEntry; frecency: number }> {
		let excludeRegex: RegExp | null = null;
		if (this.settings.excludePaths.trim()) {
			try {
				excludeRegex = new RegExp(this.settings.excludePaths);
			} catch {
				// Invalid regex — skip the filter rather than crash.
			}
		}

		const now = Date.now();

		const sorted = Object.entries(this.files)
			.filter(([path]) => !excludeRegex || !excludeRegex.test(path))
			.map(([path, entry]) => ({ path, entry, frecency: getFrecency(entry, now) }))
			.sort((a, b) => b.frecency - a.frecency);

		return applyLimit ? sorted.slice(0, this.settings.maxItems) : sorted;
	}

	// -------------------------------------------------------------------------
	// View management
	// -------------------------------------------------------------------------

	activateView(): void {
		this.app.workspace.ensureSideLeaf(VIEW_TYPE_ZOXIDIAN, "left", { reveal: true });
	}
}

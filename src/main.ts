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
	view: ZoxidianView | null = null;
	private debouncedPersist!: () => void;
	// Paths of files currently open in any leaf. Used to distinguish a fresh
	// open (no existing leaf) from a tab switch (leaf already exists).
	private openInLeaf = new Set<string>();

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

		// Seed openInLeaf from whatever is already open when the plugin loads.
		this.app.workspace.iterateAllLeaves((leaf) => {
			const f = (leaf.view as any)?.file;
			if (f instanceof TFile) this.openInLeaf.add(f.path);
		});

		// When tabs are closed, remove their paths so a future open records again.
		// We only remove here — additions happen inside the file-open handler.
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const current = new Set<string>();
				this.app.workspace.iterateAllLeaves((leaf) => {
					const f = (leaf.view as any)?.file;
					if (f instanceof TFile) current.add(f.path);
				});
				for (const path of this.openInLeaf) {
					if (!current.has(path)) this.openInLeaf.delete(path);
				}
			})
		);

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
	}

	// Called only when the user explicitly enables the plugin — not on every
	// app startup. The right place to reveal the leaf for the first time.
	onUserEnable(): void {
		this.app.workspace.ensureSideLeaf(VIEW_TYPE_ZOXIDIAN, "left", { reveal: true });
	}

	onunload() { /* Obsidian cleans up registered events */ }

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
	}

	// -------------------------------------------------------------------------
	// Visit tracking
	// -------------------------------------------------------------------------

	recordVisit(file: TFile): void {
		const wasAlreadyOpen = this.openInLeaf.has(file.path);
		// Mark it open now regardless — so subsequent tab switches are recognised.
		this.openInLeaf.add(file.path);

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
		this.view?.redraw();
	}

	getTotalScore(): number {
		return Object.values(this.files).reduce((sum, e) => sum + e.score, 0);
	}

	handleRename(oldPath: string, newPath: string): void {
		const entry = this.files[oldPath];
		if (!entry) return;
		this.files[newPath] = { ...entry };
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

	getSortedEntries(): Array<{ path: string; entry: FileEntry; frecency: number }> {
		let excludeRegex: RegExp | null = null;
		if (this.settings.excludePaths.trim()) {
			try {
				excludeRegex = new RegExp(this.settings.excludePaths);
			} catch {
				// Invalid regex — skip the filter rather than crash.
			}
		}

		const now = Date.now();

		return Object.entries(this.files)
			.filter(([path]) => !excludeRegex || !excludeRegex.test(path))
			.map(([path, entry]) => ({ path, entry, frecency: getFrecency(entry, now) }))
			.sort((a, b) => b.frecency - a.frecency)
			.slice(0, this.settings.maxItems);
	}

	// -------------------------------------------------------------------------
	// View management
	// -------------------------------------------------------------------------

	activateView(): void {
		this.app.workspace.ensureSideLeaf(VIEW_TYPE_ZOXIDIAN, "left", { reveal: true });
	}
}

import { App, SuggestModal, TFile, prepareFuzzySearch, renderMatches, Notice } from "obsidian";
import type ZoxidianPlugin from "./main";
import type { FileEntry } from "./types";
import { formatScore } from "./utils";

type SortedEntry = { path: string; entry: FileEntry; frecency: number; matches: [number, number][] | null; untracked?: boolean };

export class ZoxidianSearchModal extends SuggestModal<SortedEntry> {
	constructor(app: App, private plugin: ZoxidianPlugin) {
		super(app);
		this.setPlaceholder("Search recent notes…");
		this.setInstructions([
			{ command: "↑↓",          purpose: "navigate" },
			{ command: "↵",           purpose: "open" },
			{ command: "ctrl ↵",      purpose: "open in new tab" },
			{ command: "ctrl alt ↵",  purpose: "open to right" },
			{ command: "shift ↵",     purpose: "create" },
			{ command: "esc",         purpose: "dismiss" },
		]);

		// Route Ctrl+Enter and Ctrl+Alt+Enter through chooser so onChooseSuggestion
		// receives the real event with modifier keys intact
		this.scope.register(["Mod"], "Enter", (evt: KeyboardEvent) => {
			(this as any).chooser.useSelectedItem(evt);
			return false;
		});
		this.scope.register(["Mod", "Alt"], "Enter", (evt: KeyboardEvent) => {
			(this as any).chooser.useSelectedItem(evt);
			return false;
		});
		this.scope.register(["Shift"], "Enter", (_evt: KeyboardEvent) => {
			this.createNote();
			return false;
		});
	}

	getSuggestions(query: string): SortedEntry[] {
		// No cap in the modal — show all tracked files
		const tracked = this.plugin.getSortedEntries(false);

		let all: SortedEntry[];
		if (this.plugin.settings.includeUntrackedInModal) {
			const trackedPaths = new Set(tracked.map(e => e.path));

			let excludeRegex: RegExp | null = null;
			const ep = this.plugin.settings.excludePaths.trim();
			if (ep) { try { excludeRegex = new RegExp(ep); } catch {} }

			const untracked = this.app.vault.getMarkdownFiles()
				.filter(f => !trackedPaths.has(f.path) && (!excludeRegex || !excludeRegex.test(f.path)))
				.map(f => ({
					path: f.path,
					entry: { score: 0, lastAccess: 0 },
					frecency: 0,
					matches: null as [number, number][] | null,
					untracked: true as const,
				}));

			all = [
				...tracked.map(e => ({ ...e, matches: null as [number, number][] | null })),
				...untracked,
			];
		} else {
			all = tracked.map(e => ({ ...e, matches: null as [number, number][] | null }));
		}

		const q = query.trim();
		if (!q) return all;
		const fuzzy = prepareFuzzySearch(q);
		return all
			.map(e => ({ ...e, matches: fuzzy(e.path)?.matches ?? null }))
			.filter(e => e.matches !== null);
	}

	renderSuggestion({ path, entry, frecency, matches, untracked }: SortedEntry, el: HTMLElement): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const row = el.createEl("div", { cls: "zoxidian-suggestion" });

		const info = row.createEl("div", { cls: "zoxidian-suggestion-info" });
		renderMatches(info.createEl("span", { cls: "suggestion-title" }), path, matches);

		const badges = row.createEl("div", { cls: "zoxidian-badges" });
		if (untracked) {
			badges.createEl("span", {
				cls: "zoxidian-badge zoxidian-badge-untracked",
				text: "untracked",
			});
		} else {
			if (this.plugin.settings.showFrecencyBadge) {
				badges.createEl("span", {
					cls: "zoxidian-badge zoxidian-badge-frecency",
					text: formatScore(frecency),
				});
			}
			if (this.plugin.settings.showScoreBadge) {
				badges.createEl("span", {
					cls: "zoxidian-badge zoxidian-badge-base",
					text: formatScore(entry.score),
				});
			}
		}
	}

	onChooseSuggestion({ path }: SortedEntry, evt: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const isCtrlMeta = evt.ctrlKey || evt.metaKey;

		let leaf;
		if (isCtrlMeta && evt.altKey && evt instanceof KeyboardEvent) {
			leaf = this.app.workspace.getLeaf("split");
		} else if (isCtrlMeta) {
			leaf = this.app.workspace.getLeaf("tab");
		} else {
			const mostRecent = this.app.workspace.getMostRecentLeaf();
			leaf = this.plugin.settings.openInNewTab
				? this.app.workspace.getLeaf("tab")
				: (mostRecent && mostRecent.getRoot() === this.app.workspace.rootSplit)
					? mostRecent
					: this.app.workspace.getLeaf("tab");
		}

		leaf.openFile(file);
	}

	private createNote(): void {
		const name = this.inputEl.value.trim();
		if (!name) return;
		this.close();
		const path = name.endsWith(".md") ? name : `${name}.md`;

		const openInLeaf = (file: TFile) => {
			const mostRecent = this.app.workspace.getMostRecentLeaf();
			const leaf = (mostRecent && mostRecent.getRoot() === this.app.workspace.rootSplit)
				? mostRecent
				: this.app.workspace.getLeaf("tab");
			leaf.openFile(file);
		};

		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			openInLeaf(existing);
			return;
		}

		this.app.vault.create(path, "").then(openInLeaf).catch(() => new Notice(`Could not create "${path}".`));
	}
}

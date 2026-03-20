import { App, SuggestModal, TFile, prepareFuzzySearch, renderMatches, Notice, normalizePath } from "obsidian";
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

			const untracked = this.getUntrackedEntries(trackedPaths, excludeRegex);

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
		if (!(file instanceof TFile)) {
			this.createMissingNote(path, evt);
			return;
		}

		this.pickLeaf(evt).openFile(file);
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

	private getUntrackedEntries(trackedPaths: Set<string>, excludeRegex: RegExp | null): SortedEntry[] {
		const untracked = this.app.vault.getMarkdownFiles()
			.filter(f => !trackedPaths.has(f.path) && (!excludeRegex || !excludeRegex.test(f.path)))
			.map(f => ({
				path: f.path,
				entry: { score: 0, lastAccess: 0 },
				frecency: 0,
				matches: null as [number, number][] | null,
				untracked: true as const,
			}));

		const knownPaths = new Set<string>([...trackedPaths, ...untracked.map(u => u.path)]);
		const missing = this.getMissingLinkEntries(knownPaths, excludeRegex);

		return [...untracked, ...missing];
	}

	private getMissingLinkEntries(knownPaths: Set<string>, excludeRegex: RegExp | null): SortedEntry[] {
		const unresolved = this.app.metadataCache.unresolvedLinks ?? {};
		const missingPaths = new Set<string>();

		for (const [sourcePath, links] of Object.entries(unresolved)) {
			for (const rawLink of Object.keys(links)) {
				const linkpath = this.extractLinkpath(rawLink);
				if (!linkpath) continue;
				if (this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)) continue;

				const path = this.resolveMissingLinkPath(linkpath, sourcePath);
				if (!path) continue;
				if (knownPaths.has(path)) continue;
				if (excludeRegex && excludeRegex.test(path)) continue;

				missingPaths.add(path);
			}
		}

		return [...missingPaths].map(path => ({
			path,
			entry: { score: 0, lastAccess: 0 },
			frecency: 0,
			matches: null as [number, number][] | null,
			untracked: true as const,
		}));
	}

	private extractLinkpath(raw: string): string | null {
		let linkpath = raw;
		const pipe = linkpath.indexOf("|");
		if (pipe !== -1) linkpath = linkpath.slice(0, pipe);
		const hash = linkpath.indexOf("#");
		if (hash !== -1) linkpath = linkpath.slice(0, hash);
		linkpath = linkpath.trim();
		return linkpath ? linkpath : null;
	}

	private resolveMissingLinkPath(linkpath: string, sourcePath: string): string | null {
		const base = linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`;
		if (base.includes("://")) return null;

		let path = base;
		if (!base.includes("/")) {
			const parent = this.app.fileManager.getNewFileParent(sourcePath, base);
			path = parent.path ? `${parent.path}/${base}` : base;
		}

		return normalizePath(path);
	}

	private pickLeaf(evt: MouseEvent | KeyboardEvent) {
		const isCtrlMeta = evt.ctrlKey || evt.metaKey;
		if (isCtrlMeta && evt.altKey && evt instanceof KeyboardEvent) {
			return this.app.workspace.getLeaf("split");
		}
		if (isCtrlMeta) {
			return this.app.workspace.getLeaf("tab");
		}

		const mostRecent = this.app.workspace.getMostRecentLeaf();
		return this.plugin.settings.openInNewTab
			? this.app.workspace.getLeaf("tab")
			: (mostRecent && mostRecent.getRoot() === this.app.workspace.rootSplit)
				? mostRecent
				: this.app.workspace.getLeaf("tab");
	}

	private createMissingNote(path: string, evt: MouseEvent | KeyboardEvent): void {
		const leaf = this.pickLeaf(evt);
		this.app.vault.create(path, "")
			.then(file => leaf.openFile(file))
			.catch(() => new Notice(`Could not create "${path}".`));
	}
}

import { App, SuggestModal, TFile, prepareFuzzySearch, renderMatches } from "obsidian";
import type ZoxidianPlugin from "./main";
import type { FileEntry } from "./types";
import { formatScore } from "./utils";

type SortedEntry = { path: string; entry: FileEntry; frecency: number; matches: [number, number][] | null };

export class ZoxidianSearchModal extends SuggestModal<SortedEntry> {
	constructor(app: App, private plugin: ZoxidianPlugin) {
		super(app);
		this.setPlaceholder("Search recent notes…");
		this.setInstructions([
			{ command: "↑↓", purpose: "navigate" },
			{ command: "↵",  purpose: "open" },
			{ command: "esc", purpose: "dismiss" },
		]);
	}

	getSuggestions(query: string): SortedEntry[] {
		const all = this.plugin.getSortedEntries();
		const q = query.trim();
		if (!q) return all.map(e => ({ ...e, matches: null }));
		const fuzzy = prepareFuzzySearch(q);
		return all
			.map(e => ({ ...e, matches: fuzzy(e.path)?.matches ?? null }))
			.filter(e => e.matches !== null);
	}

	renderSuggestion({ path, entry, frecency, matches }: SortedEntry, el: HTMLElement): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const row = el.createEl("div", { cls: "zoxidian-suggestion" });

		const info = row.createEl("div", { cls: "zoxidian-suggestion-info" });
		renderMatches(info.createEl("span", { cls: "suggestion-title" }), path, matches);

		const badges = row.createEl("div", { cls: "zoxidian-badges" });
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

	onChooseSuggestion({ path }: SortedEntry, _evt: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const mostRecent = this.app.workspace.getMostRecentLeaf();
		const leaf = this.plugin.settings.openInNewTab
			? this.app.workspace.getLeaf("tab")
			: (mostRecent && mostRecent.getRoot() === this.app.workspace.rootSplit)
				? mostRecent
				: this.app.workspace.getLeaf("tab");

		leaf.openFile(file);
	}
}

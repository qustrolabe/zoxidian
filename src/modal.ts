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

	onChooseSuggestion({ path }: SortedEntry, evt: MouseEvent | KeyboardEvent): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		let leaf;
		if (evt instanceof KeyboardEvent && (evt.ctrlKey || evt.metaKey) && evt.altKey) {
			leaf = this.app.workspace.getLeaf("split");
		} else if (evt instanceof KeyboardEvent && (evt.ctrlKey || evt.metaKey)) {
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
		this.app.vault.create(path, "").then(file => {
			const mostRecent = this.app.workspace.getMostRecentLeaf();
			const leaf = (mostRecent && mostRecent.getRoot() === this.app.workspace.rootSplit)
				? mostRecent
				: this.app.workspace.getLeaf("tab");
			leaf.openFile(file);
		});
	}
}

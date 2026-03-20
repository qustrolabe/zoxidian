import { mock, describe, it, expect } from "bun:test";
import "./obsidian-mock";

// Dynamic import so the mock is registered before any module loads.
const { ZoxidianSearchModal } = await import("../src/modal");
const { TFile } = await import("obsidian");

function makeModal(overrides?: {
	excludePaths?: string;
	unresolvedLinks?: Record<string, Record<string, number>>;
}) {
	const app = {
		vault: {
			getMarkdownFiles: () => [new (TFile as any)("Existing.md"), new (TFile as any)("Tracked.md")],
			getAbstractFileByPath: (_path: string) => null,
			create: mock(async (path: string) => new (TFile as any)(path)),
		},
		metadataCache: {
			unresolvedLinks: overrides?.unresolvedLinks ?? {
				"Folder/Source.md": {
					"Ghost": 1,
					"Existing": 1,
					"Heading#Sub": 1,
					"Alias|Display": 1,
					"http://example.com": 1,
				},
			},
			getFirstLinkpathDest: (linkpath: string, _sourcePath: string) => {
				if (linkpath === "Existing") return new (TFile as any)("Existing.md");
				return null;
			},
		},
		fileManager: {
			getNewFileParent: (_sourcePath: string, _newFilePath?: string) => ({ path: "Folder" }),
		},
		workspace: {
			getLeaf: mock(() => ({ openFile: mock(() => {}) })),
			getMostRecentLeaf: mock(() => null),
			rootSplit: {},
		},
	};

	const plugin = {
		getSortedEntries: () => ([{
			path: "Tracked.md",
			entry: { score: 1, lastAccess: 1 },
			frecency: 1,
		}]),
		settings: {
			includeUntrackedInModal: true,
			excludePaths: overrides?.excludePaths ?? "",
			openInNewTab: false,
			showFrecencyBadge: true,
			showScoreBadge: false,
		},
	};

	return new ZoxidianSearchModal(app as any, plugin as any);
}

describe("ZoxidianSearchModal.getSuggestions", () => {
	it("includes unresolved links as untracked entries", () => {
		const modal = makeModal();

		const results = modal.getSuggestions("");
		const paths = results.map(r => r.path);

		expect(paths).toContain("Tracked.md");
		expect(paths).toContain("Existing.md");
		expect(paths).toContain("Folder/Ghost.md");
		expect(paths).toContain("Folder/Heading.md");
		expect(paths).toContain("Folder/Alias.md");
		expect(paths).not.toContain("Folder/Existing.md");
		expect(paths).not.toContain("http://example.com.md");

		const ghost = results.find(r => r.path === "Folder/Ghost.md");
		expect(ghost?.untracked).toBe(true);
	});

	it("respects excludePaths for missing entries", () => {
		const modal = makeModal({ excludePaths: "^Folder/" });

		const results = modal.getSuggestions("");
		const paths = results.map(r => r.path);

		expect(paths).toContain("Tracked.md");
		expect(paths).toContain("Existing.md");
		expect(paths).not.toContain("Folder/Ghost.md");
	});
});

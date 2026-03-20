import { mock, describe, it, expect } from "bun:test";

// Stub obsidian before any plugin module loads.
mock.module("obsidian", () => ({
	App: class {},
	ItemView: class {},
	Menu: class {},
	Modal: class {},
	Plugin: class {},
	SuggestModal: class {},
	TFile: class {},
	WorkspaceLeaf: class {},
	PluginSettingTab: class {},
	Setting: class {
		setName()  { return this; }
		setDesc()  { return this; }
		addText()  { return this; }
		addToggle(){ return this; }
		addButton(){ return this; }
	},
	prepareFuzzySearch: () => () => null,
	renderMatches: () => {},
	Notice: class { constructor(_msg: string) {} },
}));

// Dynamic imports so the mock is registered before any module loads.
const { default: ZoxidianPlugin } = await import("../src/main");
const { DEFAULT_SETTINGS } = await import("../src/settings");

// ---------------------------------------------------------------------------
// Test-instance factory
// ---------------------------------------------------------------------------

function makePlugin() {
	// Instantiate without calling onload() — field initialisers still run.
	// Cast to `any` first to bypass the typed Plugin(app, manifest) constructor.
	const plugin = new (ZoxidianPlugin as any)() as any;
	// Seed with safe defaults; tests override as needed.
	plugin.files          = {};
	plugin.openPathCounts = new Map<string, number>();
	// debouncedPersist is assigned in onload(), so we must supply it here.
	plugin.debouncedPersist = mock(() => {});
	// Override async persistData so it never touches Obsidian's saveData().
	plugin.persistData    = mock(async () => {});
	plugin.redrawViews    = mock(() => {});
	plugin.notifyRenameInViews = mock(() => {});
	plugin.settings       = { ...DEFAULT_SETTINGS };
	return plugin;
}

// ---------------------------------------------------------------------------
// recordVisit
// ---------------------------------------------------------------------------

describe("recordVisit", () => {
	it("creates a new entry and persists/redraws for a fresh open", () => {
		const plugin = makePlugin();
		const nowSpy = mock(() => 1234);
		const realNow = Date.now;
		(Date as any).now = nowSpy;

		plugin.recordVisit({ path: "a.md" } as any, false);

		expect(plugin.files["a.md"]).toEqual({ score: 1, lastAccess: 1234 });
		expect(plugin.debouncedPersist).toHaveBeenCalledTimes(1);
		expect(plugin.redrawViews).toHaveBeenCalledTimes(1);
		(Date as any).now = realNow;
	});

	it("updates an existing entry", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 2, lastAccess: 1000 };

		plugin.recordVisit({ path: "a.md" } as any, false);

		expect(plugin.files["a.md"]?.score).toBe(3);
		expect(plugin.files["a.md"]?.lastAccess).toBeGreaterThanOrEqual(1000);
	});

	it("skips increment when file was already open and recordOnEveryVisit is off", () => {
		const plugin = makePlugin();
		plugin.settings.recordOnEveryVisit = false;
		plugin.files["a.md"] = { score: 2, lastAccess: 1000 };

		plugin.recordVisit({ path: "a.md" } as any, true);

		expect(plugin.files["a.md"]).toEqual({ score: 2, lastAccess: 1000 });
		expect(plugin.debouncedPersist).not.toHaveBeenCalled();
	});

	it("increments when file was already open and recordOnEveryVisit is on", () => {
		const plugin = makePlugin();
		plugin.settings.recordOnEveryVisit = true;
		plugin.files["a.md"] = { score: 2, lastAccess: 1000 };

		plugin.recordVisit({ path: "a.md" } as any, true);

		expect(plugin.files["a.md"]?.score).toBe(3);
		expect(plugin.debouncedPersist).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// handleRename
// ---------------------------------------------------------------------------

describe("handleRename", () => {
	it("migrates entry to newPath and removes oldPath", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 5, lastAccess: 1000 };

		plugin.handleRename("a.md", "b.md");

		expect(plugin.files["b.md"]).toEqual({ score: 5, lastAccess: 1000 });
		expect(plugin.files["a.md"]).toBeUndefined();
	});

	it("is a no-op when oldPath is not tracked", () => {
		const plugin = makePlugin();
		plugin.files["other.md"] = { score: 3, lastAccess: 500 };

		plugin.handleRename("missing.md", "b.md");

		expect(plugin.files["b.md"]).toBeUndefined();
		expect(plugin.files["other.md"]).toEqual({ score: 3, lastAccess: 500 });
	});

	it("moves oldPath open-count to newPath when oldPath was open", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		plugin.openPathCounts.set("a.md", 1);

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openPathCounts.has("a.md")).toBe(false);
		expect(plugin.openPathCounts.get("b.md")).toBe(1);
	});

	it("does NOT add newPath open-count when oldPath was absent", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		// openPathCounts does NOT contain "a.md"

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openPathCounts.has("b.md")).toBe(false);
	});

	it("adds old and new open-counts when both paths are open", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		plugin.files["b.md"] = { score: 1, lastAccess: 1 };
		plugin.openPathCounts.set("a.md", 2);
		plugin.openPathCounts.set("b.md", 1);

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openPathCounts.has("a.md")).toBe(false);
		expect(plugin.openPathCounts.get("b.md")).toBe(3);
	});

	it("merges scores when newPath already has an entry", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 3, lastAccess: 2000 };
		plugin.files["b.md"] = { score: 7, lastAccess: 1000 };

		plugin.handleRename("a.md", "b.md");

		expect(plugin.files["b.md"]?.score).toBe(10);
	});

	it("takes Math.max(lastAccess) when merging", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 3, lastAccess: 9000 };
		plugin.files["b.md"] = { score: 7, lastAccess: 1000 };

		plugin.handleRename("a.md", "b.md");

		expect(plugin.files["b.md"]?.lastAccess).toBe(9000);
	});

	it("calls debouncedPersist (not persistData) after rename", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };

		plugin.handleRename("a.md", "b.md");

		expect(plugin.debouncedPersist).toHaveBeenCalledTimes(1);
		expect(plugin.persistData).not.toHaveBeenCalled();
	});

	it("notifies views before redraw after rename", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		const callOrder: string[] = [];
		plugin.notifyRenameInViews = mock((_o: string, _n: string) => { callOrder.push("notify"); });
		plugin.redrawViews = mock(() => { callOrder.push("redraw"); });

		plugin.handleRename("a.md", "b.md");

		expect(plugin.notifyRenameInViews).toHaveBeenCalledWith("a.md", "b.md");
		// notify must precede redraw so activeFilePath is correct when the DOM renders
		expect(callOrder).toEqual(["notify", "redraw"]);
	});
});

// ---------------------------------------------------------------------------
// handleDelete
// ---------------------------------------------------------------------------

describe("handleDelete", () => {
	it("removes the entry for the given path", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 5, lastAccess: 1000 };

		plugin.handleDelete("a.md");

		expect(plugin.files["a.md"]).toBeUndefined();
	});

	it("is a no-op (no crash) when path is not tracked", () => {
		const plugin = makePlugin();
		plugin.files["other.md"] = { score: 3, lastAccess: 500 };

		expect(() => plugin.handleDelete("missing.md")).not.toThrow();
		expect(plugin.files["other.md"]).toBeDefined();
	});

	it("calls persistData after deletion", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };

		plugin.handleDelete("a.md");

		expect(plugin.persistData).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// clearData
// ---------------------------------------------------------------------------

describe("clearData", () => {
	it("sets files to {}", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 5, lastAccess: 1000 };
		plugin.files["b.md"] = { score: 3, lastAccess: 500 };

		plugin.clearData();

		expect(plugin.files).toEqual({});
	});

	it("calls debouncedPersist after clearing", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 5, lastAccess: 1000 };

		plugin.clearData();

		expect(plugin.debouncedPersist).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// getSortedEntries
// ---------------------------------------------------------------------------

describe("getSortedEntries", () => {
	it("returns at most maxItems when applyLimit is true", () => {
		const plugin = makePlugin();
		plugin.settings.maxItems = 1;
		plugin.files["a.md"] = { score: 1, lastAccess: Date.now() };
		plugin.files["b.md"] = { score: 2, lastAccess: Date.now() };

		const rows = plugin.getSortedEntries(true);

		expect(rows.length).toBe(1);
	});

	it("skips exclude filter when regex is invalid", () => {
		const plugin = makePlugin();
		plugin.settings.excludePaths = "[";
		plugin.files["a.md"] = { score: 1, lastAccess: Date.now() };

		const rows = plugin.getSortedEntries(true);

		expect(rows.length).toBe(1);
		expect(rows[0]?.path).toBe("a.md");
	});

	it("filters paths matching exclude regex", () => {
		const plugin = makePlugin();
		plugin.settings.excludePaths = "^Daily/";
		plugin.files["Daily/note.md"] = { score: 5, lastAccess: Date.now() };
		plugin.files["Work/note.md"] = { score: 5, lastAccess: Date.now() };

		const rows = plugin.getSortedEntries(false);

		expect(rows.map((r: any) => r.path)).toEqual(["Work/note.md"]);
	});
});

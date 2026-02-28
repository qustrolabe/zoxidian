import { mock, describe, it, expect, beforeEach } from "bun:test";

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
	plugin.openInLeaf     = new Set<string>();
	// debouncedPersist is assigned in onload(), so we must supply it here.
	plugin.debouncedPersist = mock(() => {});
	// Override async persistData so it never touches Obsidian's saveData().
	plugin.persistData    = mock(async () => {});
	plugin.view           = null;
	plugin.settings       = { ...DEFAULT_SETTINGS };
	return plugin;
}

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

	it("removes oldPath from openInLeaf when it was present", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		plugin.openInLeaf.add("a.md");

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openInLeaf.has("a.md")).toBe(false);
	});

	it("adds newPath to openInLeaf when oldPath was in the set", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		plugin.openInLeaf.add("a.md");

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openInLeaf.has("b.md")).toBe(true);
	});

	it("does NOT add newPath to openInLeaf when oldPath was absent", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		// openInLeaf does NOT contain "a.md"

		plugin.handleRename("a.md", "b.md");

		expect(plugin.openInLeaf.has("b.md")).toBe(false);
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

	it("calls view.notifyRename with old and new paths", () => {
		const plugin = makePlugin();
		plugin.files["a.md"] = { score: 1, lastAccess: 1 };
		const callOrder: string[] = [];
		plugin.view = {
			notifyRename: mock((_o: string, _n: string) => { callOrder.push("notify"); }),
			redraw:       mock(() => { callOrder.push("redraw"); }),
		};

		plugin.handleRename("a.md", "b.md");

		expect(plugin.view.notifyRename).toHaveBeenCalledWith("a.md", "b.md");
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

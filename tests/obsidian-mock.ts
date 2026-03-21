import { mock } from "bun:test";

// Single shared Obsidian mock to avoid order-dependent test failures.
void mock.module("obsidian", () => ({
	App: class {},
	ItemView: class {},
	FileView: class {
		file: any = null;
	},
	Menu: class {},
	Modal: class {},
	Plugin: class {},
	SuggestModal: class {
		app: any;
		inputEl: { value: string };
		scope: { register: ReturnType<typeof mock> };
		constructor(app: any) {
			this.app = app;
			this.inputEl = { value: "" };
			this.scope = { register: mock(() => {}) };
		}
		setPlaceholder() { return this; }
		setInstructions() { return this; }
	},
	TFile: class {
		path: string;
		constructor(path: string) { this.path = path; }
	},
	WorkspaceLeaf: class {},
	PluginSettingTab: class {},
	Setting: class {
		setName()  { return this; }
		setDesc()  { return this; }
		addText()  { return this; }
		addToggle(){ return this; }
		addButton(){ return this; }
		setHeading(){ return this; }
	},
	prepareFuzzySearch: () => () => ({ matches: [] }),
	renderMatches: () => {},
	Notice: class { constructor(_msg: string) {} },
	normalizePath: (path: string) => path,
}));

import { mock, describe, it, expect } from "bun:test";
import type { FileEntry } from "../src/types";

// Stub obsidian before the plugin module loads.
// obsidian is an esbuild external (not a real npm module), so it must be
// mocked for the test runner to resolve the import in main.ts.
mock.module("obsidian", () => ({
	App: class {},
	ItemView: class {},
	Menu: class {},
	Modal: class {},
	Plugin: class {},
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
}));

// Dynamic import so the mock is registered before the module loads.
const { getFrecency, applyAging } = await import("../src/frecency");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY  = 86_400_000;
const WEEK = 604_800_000;
const NOW  = 1_700_000_000_000;

function entry(score: number, msAgo: number): FileEntry {
	return { score, lastAccess: NOW - msAgo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getFrecency", () => {
	it("multiplies by 4 when last access < 1 hour ago", () => {
		expect(getFrecency(entry(10, 30 * 60 * 1000), NOW)).toBe(40);
	});

	it("multiplies by 2 when last access < 1 day ago", () => {
		expect(getFrecency(entry(10, 12 * HOUR), NOW)).toBe(20);
	});

	it("divides by 2 when last access < 1 week ago", () => {
		expect(getFrecency(entry(10, 3 * DAY), NOW)).toBe(5);
	});

	it("divides by 4 when last access >= 1 week ago", () => {
		expect(getFrecency(entry(10, 14 * DAY), NOW)).toBe(2.5);
	});

	it("boundary: exactly 1 hour elapsed → day bucket (×2)", () => {
		expect(getFrecency(entry(10, HOUR), NOW)).toBe(20);
	});

	it("boundary: exactly 1 day elapsed → week bucket (÷2)", () => {
		expect(getFrecency(entry(10, DAY), NOW)).toBe(5);
	});

	it("boundary: exactly 1 week elapsed → old bucket (÷4)", () => {
		expect(getFrecency(entry(10, WEEK), NOW)).toBe(2.5);
	});

	it("score of 1, very recent → frecency of 4", () => {
		expect(getFrecency(entry(1, 5 * 60 * 1000), NOW)).toBe(4);
	});

	it("old entry with large score produces fractional result", () => {
		expect(getFrecency(entry(3, 30 * DAY), NOW)).toBe(0.75);
	});
});

// ---------------------------------------------------------------------------
// applyAging tests
// ---------------------------------------------------------------------------

function makeFiles(...scores: number[]): Record<string, import("../src/types").FileEntry> {
	const files: Record<string, import("../src/types").FileEntry> = {};
	scores.forEach((score, i) => {
		files[`note${i}.md`] = { score, lastAccess: NOW };
	});
	return files;
}

describe("applyAging", () => {
	it("does nothing when total is below maxAge", () => {
		const files = makeFiles(10, 20, 30); // total = 60
		applyAging(files, 100);
		expect(files["note0.md"]?.score).toBe(10);
		expect(files["note1.md"]?.score).toBe(20);
		expect(files["note2.md"]?.score).toBe(30);
	});

	it("does nothing when total exactly equals maxAge", () => {
		const files = makeFiles(50, 50); // total = 100
		applyAging(files, 100);
		expect(files["note0.md"]?.score).toBe(50);
		expect(files["note1.md"]?.score).toBe(50);
	});

	it("scales scores proportionally when total exceeds maxAge", () => {
		const files = makeFiles(100, 100); // total = 200, maxAge = 100 → scale 0.5
		applyAging(files, 100);
		expect(files["note0.md"]?.score).toBeCloseTo(50);
		expect(files["note1.md"]?.score).toBeCloseTo(50);
	});

	it("prunes entries whose score drops below 1 after scaling", () => {
		// total = 1001, maxAge = 1000 → scale ≈ 0.999; score-1 entry → 0.999 → pruned
		const files = makeFiles(1000, 1);
		applyAging(files, 1000);
		expect(files["note0.md"]).toBeDefined();
		expect(files["note1.md"]).toBeUndefined();
	});

	it("total after aging does not exceed maxAge", () => {
		const files = makeFiles(300, 400, 500); // total = 1200
		applyAging(files, 1000);
		const total = Object.values(files).reduce((s, e) => s + e.score, 0);
		expect(total).toBeLessThanOrEqual(1000);
	});
});

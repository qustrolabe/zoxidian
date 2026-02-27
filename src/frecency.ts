import type { FileEntry } from "./types";

// ---------------------------------------------------------------------------
// Aging — mirrors the zoxide aging mechanic:
//
//   When the sum of all base scores exceeds maxAge, every score is scaled
//   down proportionally so the total equals maxAge. Entries whose score
//   drops below 1 are pruned — they have become irrelevant relative to
//   everything else.
// ---------------------------------------------------------------------------

export function applyAging(files: Record<string, FileEntry>, maxAge: number): void {
	if (maxAge <= 0) return;
	const total = Object.values(files).reduce((sum, e) => sum + e.score, 0);
	if (total <= maxAge) return;

	const scale = (maxAge * 0.9) / total;
	for (const path of Object.keys(files)) {
		const entry = files[path];
		if (entry) {
			entry.score *= scale;
			if (entry.score < 1) delete files[path];
		}
	}
}

// ---------------------------------------------------------------------------
// Frecency calculation — mirrors the zoxide weighting table:
//
//   Last access          | Multiplier
//   ---------------------|----------
//   Within the last hour |  × 4
//   Within the last day  |  × 2
//   Within the last week |  ÷ 2
//   Otherwise            |  ÷ 4
// ---------------------------------------------------------------------------

export function getFrecency(entry: FileEntry, now = Date.now()): number {
	const elapsed = now - entry.lastAccess;
	const HOUR = 60 * 60 * 1000;
	const DAY  = 24 * HOUR;
	const WEEK = 7  * DAY;

	if (elapsed < HOUR)  return entry.score * 4;
	if (elapsed < DAY)   return entry.score * 2;
	if (elapsed < WEEK)  return entry.score / 2;
	return entry.score / 4;
}

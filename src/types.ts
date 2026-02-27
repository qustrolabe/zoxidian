export const VIEW_TYPE_ZOXIDIAN = "zoxidian-view";

export interface FileEntry {
	/** Base score — incremented on each open, scaled down by aging. */
	score: number;
	/** Unix timestamp (ms) of the most recent visit. */
	lastAccess: number;
}

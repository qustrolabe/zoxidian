export const VIEW_TYPE_ZOXIDIAN = "zoxidian-view";

export interface FileEntry {
	/** Raw visit count — the base score in the zoxide model. */
	score: number;
	/** Unix timestamp (ms) of the most recent visit. */
	lastAccess: number;
}

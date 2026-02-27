#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
	console.error("Usage: bun run release <patch|minor|major>");
	process.exit(1);
}

// Read current version
const pkg      = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
	bump === "major" ? `${major + 1}.0.0` :
	bump === "minor" ? `${major}.${minor + 1}.0` :
	                   `${major}.${minor}.${patch + 1}`;

// Update files
pkg.version      = next;
manifest.version = next;
versions[next]   = manifest.minAppVersion;

writeFileSync("package.json", JSON.stringify(pkg,      null, "\t") + "\n");
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

// Commit and tag
execSync("git add package.json manifest.json versions.json");
execSync(`git commit -m "${next}"`);
execSync(`git tag ${next}`);

console.log(`Released ${next} — run \`git push --follow-tags\` when ready.`);

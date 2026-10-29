import changelogSource from "../../../static/changelog.js?raw";
import { parseChangelogSource, type ChangelogEntry } from "./parseChangelog";

let cached: ChangelogEntry[] | null = null;

export function getChangelog(): ChangelogEntry[] {
  if (!cached) cached = parseChangelogSource(changelogSource);
  return cached;
}

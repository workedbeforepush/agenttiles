// Picking the IDE window of a session among several windows of one app; shared by Windows, macOS and Linux.
import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * The names an IDE window of the session's folder can carry, nearest folder first: the folder's name and the
 * solutions in it, then the same for each parent folder. Rider titles its window after the solution, which can differ
 * from the folder (folder "darkorbit-2009", solution "DarkOrbit.slnx", window "DarkOrbit – Program.cs"). A folder
 * that cannot be read (deleted meanwhile) contributes its name only.
 */
export function projectNames(cwd: string): string[] {
  const names: string[] = [];
  for (let folder = cwd; ; folder = dirname(folder)) {
    const name = basename(folder);
    if (name.length > 0) names.push(name, ...solutionNames(folder));
    if (dirname(folder) === folder) return names;
  }
}

function solutionNames(folder: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return [];
  }
  return entries.filter((entry) => /\.slnx?$/i.test(entry)).map((entry) => entry.replace(/\.slnx?$/i, ''));
}

/**
 * Of several windows of one app, the one whose title contains a session title (terminals title their window after
 * the session) or, failing that, carries the first of the project names (IDE project windows: "Shop.Api – Program.cs",
 * "app - Visual Studio Code"); null when none does. A project name has to stand alone in the title, so folder "app"
 * does not pick window "app.web".
 */
export function pickWindow(windowTitles: string[], sessionTitles: string[], names: string[]): number | null {
  const byTitle = windowTitles.findIndex((title) => sessionTitles.some((session) => title.includes(session)));
  if (byTitle >= 0) return byTitle;
  for (const name of names) {
    const index = windowTitles.findIndex((title) => namesFolder(title, name));
    if (index >= 0) return index;
  }
  return null;
}

/** True when `folder` occurs in `title` with a space, bracket or the title's edge on both sides. */
function namesFolder(title: string, folder: string): boolean {
  const edge = (char: string | undefined): boolean => char === undefined || /[\s()[\]]/.test(char);
  for (let at = title.indexOf(folder); at >= 0; at = title.indexOf(folder, at + 1)) {
    if (edge(title[at - 1]) && edge(title[at + folder.length])) return true;
  }
  return false;
}

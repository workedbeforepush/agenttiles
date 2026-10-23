import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { matchableTitles } from '../src/main/platform';
import { pickWindow, projectNames } from '../src/main/platform/project';

describe('window and tab titles', () => {
  it('leaves out empty titles, which would match every tab and window', () => {
    expect(matchableTitles(['', '  ', 'Fix the login', '\t'])).toEqual(['Fix the login']);
    expect(matchableTitles([])).toEqual([]);
  });
});

describe('IDE project windows', () => {
  const titles = ['Shop.Web – Program.cs', 'Shop – README.md', 'notes.md - tools - Visual Studio Code'];

  it('picks the window naming the session folder, or its nearest parent', () => {
    expect(pickWindow(titles, [], ['Shop'])).toBe(1);
    expect(pickWindow(titles, [], ['src', 'Shop.Web', 'dev'])).toBe(0);
    expect(pickWindow(titles, [], ['tools', 'me', 'home'])).toBe(2);
  });

  it('prefers the window titled after the session, as terminals do', () => {
    expect(pickWindow(['ghostty: Shop', 'Fix the login — ghostty'], ['Fix the login'], ['Shop'])).toBe(1);
  });

  it('picks the window naming the solution when it differs from the folder', () => {
    expect(pickWindow(['DarkOrbit – appsettings.json', 'M2X – Program.cs'], [], ['darkorbit-2009', 'DarkOrbit'])).toBe(0);
  });

  it('needs the name to stand alone and finds nothing otherwise', () => {
    expect(pickWindow(['Shop.Web – Program.cs'], [], ['Shop'])).toBeNull();
    expect(pickWindow([String.raw`Other [C:\x] – a.cs`], [], [])).toBeNull();
    expect(pickWindow([String.raw`Shop [C:\dev\Shop] – a.cs`], [], ['Shop'])).toBe(0);
  });
});

describe('project names', () => {
  const root = mkdtempSync(join(tmpdir(), 'agenttiles-'));
  const repo = join(root, 'darkorbit-2009');
  const api = join(repo, 'src', 'Api');
  mkdirSync(api, { recursive: true });
  writeFileSync(join(repo, 'DarkOrbit.slnx'), '');
  writeFileSync(join(repo, 'Legacy.sln'), '');
  writeFileSync(join(repo, 'README.md'), '');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('lists each folder and the solutions in it, nearest first', () => {
    const names = projectNames(api);
    expect(names.slice(0, 5)).toEqual(['Api', 'src', 'darkorbit-2009', 'DarkOrbit', 'Legacy']);
    expect(names).toContain(basename(root));
    expect(names.at(-1)).not.toBe('');
  });

  it('keeps the folder name when the folder cannot be read', () => {
    expect(projectNames(join(repo, 'gone')).slice(0, 2)).toEqual(['gone', 'darkorbit-2009']);
  });
});

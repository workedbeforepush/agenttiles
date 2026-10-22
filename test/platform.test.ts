import { describe, expect, it } from 'vitest';
import { matchableTitles, windowForFolder } from '../src/main/platform';

describe('window and tab titles', () => {
  it('leaves out empty titles, which would match every tab and window', () => {
    expect(matchableTitles(['', '  ', 'Fix the login', '\t'])).toEqual(['Fix the login']);
    expect(matchableTitles([])).toEqual([]);
  });
});

describe('IDE project windows', () => {
  const titles = ['Shop.Web – Program.cs', 'Shop – README.md', 'notes.md - tools - Visual Studio Code'];

  it('picks the window naming the session folder, or its nearest parent', () => {
    expect(windowForFolder(titles, String.raw`C:\dev\Shop`)).toBe(1);
    expect(windowForFolder(titles, String.raw`C:\dev\Shop.Web\src`)).toBe(0);
    expect(windowForFolder(titles, '/home/me/tools')).toBe(2);
  });

  it('needs the name to stand alone and finds nothing otherwise', () => {
    expect(windowForFolder(['Shop.Web – Program.cs'], String.raw`C:\dev\Shop`)).toBeNull();
    expect(windowForFolder([String.raw`Other [C:\x] – a.cs`], 'C:\\')).toBeNull();
    expect(windowForFolder([String.raw`Shop [C:\dev\Shop] – a.cs`], String.raw`C:\dev\Shop`)).toBe(0);
  });
});

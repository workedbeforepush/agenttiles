import { describe, expect, it } from 'vitest';
import { matchableTitles } from '../src/main/platform';

describe('window and tab titles', () => {
  it('leaves out empty titles, which would match every tab and window', () => {
    expect(matchableTitles(['', '  ', 'Fix the login', '\t'])).toEqual(['Fix the login']);
    expect(matchableTitles([])).toEqual([]);
  });
});

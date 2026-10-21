import { describe, expect, it } from 'vitest';
import { filterTiles, groupTiles, paginate } from '../src/renderer/src/layout';
import type { TileView } from '../src/core/types';

const tile = (id: string, state: TileView['state'], cwd = 'C:\\p\\a'): TileView =>
  ({ sessionId: id, state, cwd, project: cwd.split('\\').at(-1) }) as TileView;

describe('filter', () => {
  const tiles = [tile('1', 'working'), tile('2', 'compacting'), tile('3', 'needsApproval'), tile('4', 'done'), tile('5', 'idle')];

  it('shows everything without a filter and combines filters', () => {
    expect(filterTiles(tiles, [])).toHaveLength(5);
    expect(filterTiles(tiles, ['working']).map((t) => t.sessionId)).toEqual(['1', '2']);
    expect(filterTiles(tiles, ['waiting', 'done']).map((t) => t.sessionId)).toEqual(['3', '4']);
  });
});

describe('group and paginate', () => {
  const items = [tile('1', 'working', 'C:\\p\\a'), tile('2', 'done', 'C:\\p\\b'), tile('3', 'done', 'C:\\P\\A')].map((t) => ({
    tile: t,
  }));

  it('groups by project folder in order of first appearance', () => {
    const blocks = groupTiles(items, true);
    expect(blocks.map((b) => [b.title, b.items.map((i) => i.tile.sessionId)])).toEqual([
      ['a', ['1', '3']],
      ['b', ['2']],
    ]);
    expect(groupTiles(items, false)).toEqual([{ title: null, items }]);
  });

  it('fills pages by rows and repeats the heading of a continued block', () => {
    const blocks = [{ title: 'a', items: [1, 2, 3, 4, 5] }, { title: 'b', items: [6] }];
    const pages = paginate(blocks, { columns: 2, height: 260, rowHeight: 100, rowGap: 10, headingHeight: 20 });
    // page 1: heading 20 + row 100 + gap 10 + row 100 = 230, a third row would need 340
    // page 2: heading 20 + row 100 = 120, then block b: gap 10 + heading 20 + row 100 = 250
    expect(pages).toEqual([
      [{ title: 'a', items: [1, 2, 3, 4] }],
      [{ title: 'a', items: [5] }, { title: 'b', items: [6] }],
    ]);
  });

  it('pages without headings like a plain grid', () => {
    const pages = paginate([{ title: null, items: [1, 2, 3, 4, 5] }], { columns: 2, height: 210, rowHeight: 100, rowGap: 10, headingHeight: 20 });
    expect(pages.map((p) => p.flatMap((b) => b.items))).toEqual([[1, 2, 3, 4], [5]]);
  });

  it('always places one row, even when it does not fit', () => {
    const pages = paginate([{ title: 'a', items: [1, 2] }], { columns: 1, height: 50, rowHeight: 100, rowGap: 10, headingHeight: 20 });
    expect(pages).toHaveLength(2);
  });
});

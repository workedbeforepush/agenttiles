// Filtering, grouping and paging of tiles (DOM-free so it is testable in Node).
import { FILTER_STATES, type StatusFilter } from '../../core/counters';
import type { TileView } from '../../core/types';

/** Header counters double as filters; none active shows everything. */
export function filterTiles(tiles: TileView[], filters: StatusFilter[]): TileView[] {
  if (filters.length === 0) return tiles;
  const states = new Set(filters.flatMap((f) => FILTER_STATES[f]));
  return tiles.filter((t) => states.has(t.state));
}

export interface Block<T> {
  /** Project heading; null when tiles are not grouped. */
  title: string | null;
  items: T[];
}

/**
 * One block per project in order of first appearance (the store's order: pinned, manual, start time), or a single
 * untitled block when not grouped.
 */
export function groupTiles<T extends { tile: TileView }>(items: T[], grouped: boolean): Block<T>[] {
  if (!grouped) return [{ title: null, items }];
  const blocks = new Map<string, Block<T>>();
  for (const item of items) {
    const key = item.tile.cwd.toLowerCase();
    let block = blocks.get(key);
    if (!block) {
      block = { title: item.tile.project, items: [] };
      blocks.set(key, block);
    }
    block.items.push(item);
  }
  return [...blocks.values()];
}

export interface PageGeometry {
  columns: number;
  /** Available height, row height and the gap between rows, in px. */
  height: number;
  rowHeight: number;
  rowGap: number;
  /** Height of a project heading including its spacing. */
  headingHeight: number;
}

/**
 * Fills pages row by row. A block that continues on the next page repeats its heading there; a heading never ends
 * a page on its own. A page always takes at least one row, however small the window.
 */
export function paginate<T>(blocks: Block<T>[], g: PageGeometry): Block<T>[][] {
  const pages: Block<T>[][] = [[]];
  let used = 0;
  for (const source of blocks) {
    let block: Block<T> | null = null;
    for (let i = 0; i < source.items.length; i += g.columns) {
      const row = source.items.slice(i, i + g.columns);
      const heading = block ? 0 : source.title !== null ? g.headingHeight : 0;
      let need = heading + g.rowHeight + (used > 0 ? g.rowGap : 0);
      if (used > 0 && used + need > g.height) {
        pages.push([]);
        used = 0;
        block = null;
        need = (source.title !== null ? g.headingHeight : 0) + g.rowHeight;
      }
      if (!block) {
        block = { title: source.title, items: [] };
        pages.at(-1)!.push(block);
      }
      block.items.push(...row);
      used += need;
    }
  }
  return pages;
}

import type { SessionState } from '../../core/types';
import appIconUrl from '../../../resources/icon.png';

export function since(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export const COST_HINT =
  'Token usage priced at API list prices, as reported by the Claude Code statusline. Not billed on a Claude subscription.';

export const USAGE_COST_HINT =
  'Token usage from the session transcripts, priced at API list prices. Not billed on a Claude subscription.';

/** Token count as "950", "12.3k", "4.1M". */
export function tokenCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

export function usd(value: number): string {
  return value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(1)}`;
}

export function resetsIn(epochSeconds: number | null, nowMs: number): string {
  if (epochSeconds === null) return '';
  return `resets in ${since(nowMs, epochSeconds * 1000)}`;
}

/** Duration as "45s", "12m", "2h 5m". */
export function duration(ms: number): string {
  return since(0, ms);
}

/** Local clock time "14:20". */
export function clock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const NEEDS_YOU: SessionState[] = ['needsApproval', 'needsInput'];
export const TINTED: SessionState[] = ['needsApproval', 'needsInput', 'error', 'limitHit'];

export function stateColor(state: SessionState): string {
  return `var(--st-${state})`;
}

let appIcon: Promise<HTMLImageElement> | null = null;

function loadAppIcon(): Promise<HTMLImageElement> {
  appIcon ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('app icon could not be loaded'));
    image.src = appIconUrl;
  });
  return appIcon;
}

function canvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  return { canvas: element, ctx };
}

/**
 * A round badge with the waiting count in the style of Windows' own taskbar badges: a dark disc and a white,
 * semibold digit. Thin light-on-dark strokes stay sharp at 16-24 px; colour fills and heavy weights blur there.
 * Font size and text position are whole pixels.
 */
function drawBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, waiting: number): void {
  ctx.fillStyle = '#26282d';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const text = waiting > 99 ? '99' : String(waiting);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(r * (text.length > 1 ? 1.05 : 1.3))}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Centre on the digit's real height (its ascent), not the font box, then snap to the pixel grid.
  const ascent = ctx.measureText(text).actualBoundingBoxAscent;
  ctx.fillText(text, Math.round(cx), Math.round(cy + ascent / 2));
}

/**
 * The tray icon at `size` device pixels: the app icon (so it is told apart from other tray apps by shape, not
 * colour), plus the waiting count as a badge in the corner.
 */
export async function paintTrayIcon(waiting: number, size: number): Promise<string> {
  const icon = await loadAppIcon();
  const { canvas: element, ctx } = canvas(size);
  ctx.drawImage(icon, 0, 0, size, size);
  const r = Math.round(size * 0.36);
  if (waiting > 0) drawBadge(ctx, size - r, size - r, r, waiting);
  return element.toDataURL('image/png');
}

/** The taskbar overlay at `size` device pixels (drawn by Windows over the button's corner); null when nobody waits. */
export function paintTaskbarBadge(waiting: number, size: number): string | null {
  if (waiting === 0) return null;
  const { canvas: element, ctx } = canvas(size);
  drawBadge(ctx, size / 2, size / 2, size / 2, waiting);
  return element.toDataURL('image/png');
}

/** Markdown reduced to plain text for a few lines on a tile: no emphasis markers, code ticks, headings or bullets. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function prettyInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  return JSON.stringify(input, null, 2);
}

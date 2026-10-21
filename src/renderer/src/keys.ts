// Keyboard combos as strings ("Ctrl+Shift+D", "F11", "PageDown") for configurable shortcuts.

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** The parts of a KeyboardEvent a combo needs (kept DOM-free so it is testable in Node). */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** The combo of a key event, or null for a lone modifier. Letters are upper case; Space is "Space". */
export function comboOf(event: KeyInput): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  // Named keys and letters record Shift; for other characters it is already part of the character ("!" vs "1").
  if (event.shiftKey && (key.length > 1 || /^[A-Z]$/.test(key))) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** An Electron accelerator for a combo (arrow keys are named Up/Down/Left/Right there). */
export function acceleratorOf(combo: string): string {
  return combo.replace(/Arrow(Up|Down|Left|Right)/, '$1');
}

/** True when the combo has a modifier; a global hotkey without one would take a plain key from every app. */
export function hasModifier(combo: string): boolean {
  return /^(Ctrl|Alt|Shift|Meta)\+/.test(combo);
}

/** Human-readable form for the settings and hints. */
export function displayCombo(combo: string): string {
  return combo
    .replace('PageDown', 'PgDn')
    .replace('PageUp', 'PgUp')
    .replace('Escape', 'Esc')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→');
}

// Translations for main, hook-free renderer code and tests. English (`en.ts`) is the source: its shape defines the
// keys, every other locale must have the same shape (checked by the compiler and by a test). Messages use `{name}`
// placeholders; a message with plural forms is an object keyed by Intl.PluralRules categories and picks its form
// from the `count` parameter.
import { en } from './en';

/** A message with plural forms; `other` is required, as in Intl.PluralRules. */
export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type Shape<T> = T extends string ? string : T extends { other: string } ? Plural : { [K in keyof T]: Shape<T[K]> };

/** What every locale provides: the shape of the English messages, with any text. */
export type Messages = Shape<typeof en>;

type Leaf = string | Plural;
type Keys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${Prefix}${K}` : Keys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Dot path of a message, e.g. `tile.allow`. */
export type MessageKey = Keys<Messages>;

export type MessageParams = Record<string, string | number>;

export const LOCALES = { en } satisfies Record<string, Messages>;

export type Locale = keyof typeof LOCALES;

/** The language setting: follow the system, or one of the shipped locales. */
export type LanguageSetting = 'system' | Locale;

/** The language names shown in Settings, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value);
}

/**
 * The locale to use: the setting, or for `system` the first preferred system language AgentTiles ships (matched by
 * its primary subtag, so `de-AT` finds `de`). English when none matches.
 */
export function resolveLocale(setting: LanguageSetting, preferred: readonly string[]): Locale {
  if (setting !== 'system') return setting;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

function lookup(messages: Messages, key: MessageKey): Leaf {
  let node: unknown = messages;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  // The key type guarantees a leaf; a missing one means a locale file was edited by hand: fail fast.
  if (typeof node !== 'string' && (typeof node !== 'object' || node === null || !('other' in node))) {
    throw new Error(`Missing message: ${key}`);
  }
  return node as Leaf;
}

/** The message for `key` in `locale`, with placeholders filled in. */
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const message = lookup(LOCALES[locale], key);
  const text =
    typeof message === 'string'
      ? message
      : (message[new Intl.PluralRules(locale).select(Number(params['count'] ?? 0))] ?? message.other);
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** `translate` bound to one locale. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

export function translator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

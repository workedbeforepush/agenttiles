// The renderer's translator. `t` reads the locale from reactive state, so every text a template renders through it
// updates when the language setting changes.
import { translate, type Locale, type MessageKey, type MessageParams } from '../../core/i18n';

let current = $state<Locale>('en');

export function setLocale(locale: Locale): void {
  current = locale;
  document.documentElement.lang = locale;
}

/** The active locale, for Intl formatting (dates, numbers). */
export function locale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

// The locale of main's own texts (tray, toasts, dialogs); follows the language setting.
import { translate, type Locale, type MessageKey, type MessageParams } from '../core/i18n';

let current: Locale = 'en';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function locale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';
import kk from '../../messages/kk.json';

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

describe('файлы переводов', () => {
  it('i18n_ru_and_kk_have_identical_key_sets', () => {
    const ruKeys = flatten(ru as Messages).sort();
    const kkKeys = flatten(kk as Messages).sort();
    expect(kkKeys).toEqual(ruKeys);
  });

  it('i18n_no_locale_has_empty_values', () => {
    const empty = Object.entries({ ru, kk }).flatMap(([locale, messages]) =>
      JSON.stringify(messages).includes('""') ? [locale] : [],
    );
    expect(empty).toEqual([]);
  });
});

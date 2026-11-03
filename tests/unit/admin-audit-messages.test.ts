import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../../messages/ru.json';
import kk from '../../messages/kk.json';

/** Все файлы исходников: действия журнала аудита пишутся строковыми литералами. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('журнал аудита админки', () => {
  it('every_admin_audit_action_has_ru_and_kk_text', () => {
    const actions = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../../src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(
        /writeAdminAudit\([^,]+,\s*'([a-z_]+)'/g,
      )) {
        actions.add(match[1]!);
      }
    }
    expect(actions.size).toBeGreaterThan(0);
    const missing = [...actions].filter(
      (action) =>
        !(action in ru.admin.actions) || !(action in (kk.admin.actions as Record<string, string>)),
    );
    // Без перевода экран админки падает на MISSING_MESSAGE.
    expect(missing).toEqual([]);
  });
});

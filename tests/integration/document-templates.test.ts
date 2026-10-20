import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetPlatformFlags } from '../helpers/test-db';
import {
  getTemplateEditorData,
  previewTemplate,
  resetTemplate,
  samplePayload,
  saveTemplate,
} from '@/lib/admin/templates';
import { activeTemplateBody, printableHtml } from '@/lib/documents/print';
import { defaultTemplate, PRINTABLE_TYPES } from '@/lib/documents/templates';

const prisma = createTestPrisma();

async function admin(role: 'SUPERADMIN' | 'CONTENT_MANAGER') {
  return prisma.adminUser.findFirstOrThrow({ where: { role } });
}

beforeEach(async () => {
  await resetPlatformFlags(prisma);
});

afterAll(async () => {
  await resetPlatformFlags(prisma);
  await prisma.$disconnect();
});

describe('шаблоны печатных форм в админке', () => {
  it('default_templates_render_every_form_in_both_languages', async () => {
    for (const type of PRINTABLE_TYPES) {
      for (const locale of ['ru', 'kk'] as const) {
        const html = await printableHtml(type, samplePayload(locale), locale, {
          verifyUrl: 'https://example.kz/v',
        });
        // Все поля подставлены, служебных скобок не осталось, QR на месте.
        expect(html, `${type} ${locale}`).not.toContain('{{');
        expect(html).toContain('З-2-2026-000001');
        expect(html).toContain('<svg');
      }
    }
    expect(defaultTemplate('WAYBILL', 'kk')).toContain('З-2 нысаны');
  });

  it('saved_template_is_used_for_printing_and_keeps_history', async () => {
    const editor = await admin('CONTENT_MANAGER');
    const body = defaultTemplate('INVOICE', 'ru').replace(
      'Счёт на оплату',
      'Счёт на оплату (новая форма)',
    );

    expect(await saveTemplate(editor.id, 'INVOICE', 'ru', body)).toEqual({
      status: 'ok',
      version: 1,
    });
    expect(await saveTemplate(editor.id, 'INVOICE', 'ru', `${body}<p>v2</p>`)).toEqual({
      status: 'ok',
      version: 2,
    });

    const html = await printableHtml('INVOICE', samplePayload('ru'), 'ru');
    expect(html).toContain('Счёт на оплату (новая форма)');
    expect(html).toContain('<p>v2</p>');
    // Другой язык и другой документ не затронуты.
    expect(await activeTemplateBody('INVOICE', 'kk')).toBeNull();
    expect(await activeTemplateBody('WAYBILL', 'ru')).toBeNull();

    const data = await getTemplateEditorData('INVOICE', 'ru');
    expect(data.isDefault).toBe(false);
    expect(data.history.map((row) => [row.version, row.isActive])).toEqual([
      [2, true],
      [1, false],
    ]);
    const audit = await prisma.adminAuditLog.findMany({
      where: { action: 'document_template_saved' },
    });
    expect(audit).toHaveLength(2);
  });

  it('reset_returns_default_template_and_history_stays', async () => {
    const editor = await admin('SUPERADMIN');
    await saveTemplate(editor.id, 'WAYBILL', 'kk', '<h1>Своя форма {{number}}</h1>');

    await resetTemplate(editor.id, 'WAYBILL', 'kk');

    expect(await activeTemplateBody('WAYBILL', 'kk')).toBeNull();
    const html = await printableHtml('WAYBILL', samplePayload('kk'), 'kk');
    expect(html).toContain('З-2 нысаны');
    expect((await getTemplateEditorData('WAYBILL', 'kk')).history).toHaveLength(1);
  });

  it('broken_template_is_not_saved', async () => {
    const editor = await admin('CONTENT_MANAGER');

    expect(await saveTemplate(editor.id, 'INVOICE', 'ru', '{{#lines}} без конца')).toMatchObject({
      status: 'syntax_error',
      key: 'lines',
    });
    expect(await saveTemplate(editor.id, 'INVOICE', 'ru', '   ')).toEqual({ status: 'empty' });
    expect(await prisma.documentTemplate.count()).toBe(0);
  });

  it('preview_renders_pdf_of_sample_document', async () => {
    const result = await previewTemplate(
      'DISCREPANCY_ACT',
      'ru',
      defaultTemplate('DISCREPANCY_ACT', 'ru'),
    );
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Сохранения при предпросмотре нет.
    expect(await prisma.documentTemplate.count()).toBe(0);
  });
});

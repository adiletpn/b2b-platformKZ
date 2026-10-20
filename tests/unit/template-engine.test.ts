import { describe, expect, it } from 'vitest';
import { parseTemplate, renderTemplate, TemplateError } from '@/lib/documents/template-engine';

describe('движок печатных форм', () => {
  it('values_are_escaped_and_nested_keys_resolved', () => {
    expect(
      renderTemplate('<b>{{number}}</b> {{supplier.name}} {{missing}}', {
        number: 'З-2-1',
        supplier: { name: '<script>alert(1)</script>' },
      }),
    ).toBe('<b>З-2-1</b> &lt;script&gt;alert(1)&lt;/script&gt; ');
  });

  it('sections_repeat_lists_and_check_values', () => {
    const template =
      '{{#lines}}[{{position}}:{{name}}/{{number}}]{{/lines}}{{#note}}есть{{/note}}{{^note}}нет{{/note}}';
    expect(
      renderTemplate(template, {
        number: 'N',
        lines: [
          { position: 1, name: 'А' },
          { position: 2, name: 'Б' },
        ],
        note: '',
      }),
    ).toBe('[1:А/N][2:Б/N]нет');
    expect(renderTemplate('{{#lines}}x{{/lines}}{{^lines}}пусто{{/lines}}', { lines: [] })).toBe(
      'пусто',
    );
  });

  it('raw_html_is_allowed_only_for_platform_blocks', () => {
    const context = { blocks: { qr: '<svg/>' }, name: '<i>x</i>' };
    expect(renderTemplate('{{{blocks.qr}}}{{{name}}}', context)).toBe('<svg/>&lt;i&gt;x&lt;/i&gt;');
  });

  it('broken_templates_are_reported', () => {
    expect(() => parseTemplate('{{#lines}}без конца')).toThrow(TemplateError);
    expect(() => parseTemplate('{{/lines}}')).toThrow(TemplateError);
    expect(() => parseTemplate('{{#a}}{{/b}}')).toThrow(TemplateError);
    expect(() => parseTemplate('текст {{number')).toThrow(TemplateError);
  });
});

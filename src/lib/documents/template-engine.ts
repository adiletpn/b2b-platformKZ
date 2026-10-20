/**
 * Движок печатных форм для редактора админки (раздел 3.13 ТЗ). Синтаксис — подмножество
 * Mustache, его можно объяснить бухгалтеру за пять минут:
 *
 *   {{number}}, {{supplier.name}}  — значение с экранированием HTML;
 *   {{#lines}} … {{/lines}}        — повтор для каждой строки списка;
 *   {{#correction}} … {{/correction}} — блок, если значение есть;
 *   {{^supplier.isVatPayer}} … {{/supplier.isVatPayer}} — блок, если значения нет;
 *   {{{blocks.qr}}}                — готовый HTML-блок платформы (только из `blocks`).
 *
 * Логики и скриптов в шаблоне нет: PDF рендерится с выключенным JavaScript.
 */
type Node =
  | { kind: 'text'; value: string }
  | { kind: 'value'; key: string; raw: boolean }
  | { kind: 'section'; key: string; inverted: boolean; children: Node[] };

export class TemplateError extends Error {
  constructor(
    message: 'unclosed_section' | 'unexpected_close' | 'unclosed_tag' | 'empty_tag',
    readonly key: string,
  ) {
    super(message);
  }
}

const TAG = /\{\{(\{?)\s*([#^/]?)\s*([\w.]*)\s*\}?\}\}/g;

export function parseTemplate(source: string): Node[] {
  const root: Node[] = [];
  const stack: { key: string; children: Node[] }[] = [{ key: '', children: root }];
  let last = 0;

  for (const match of source.matchAll(TAG)) {
    const [whole, brace, sigil, key] = match as unknown as [string, string, string, string];
    const index = match.index ?? 0;
    const current = stack[stack.length - 1]!;
    if (index > last) current.children.push({ kind: 'text', value: source.slice(last, index) });
    last = index + whole.length;

    if (!key) throw new TemplateError('empty_tag', whole);
    if (sigil === '#' || sigil === '^') {
      const section: Node = { kind: 'section', key, inverted: sigil === '^', children: [] };
      current.children.push(section);
      stack.push({ key, children: section.children });
    } else if (sigil === '/') {
      if (stack.length === 1 || current.key !== key)
        throw new TemplateError('unexpected_close', key);
      stack.pop();
    } else {
      current.children.push({ kind: 'value', key, raw: brace === '{' });
    }
  }

  const tail = source.slice(last);
  if (tail.includes('{{'))
    throw new TemplateError('unclosed_tag', tail.slice(tail.indexOf('{{'), 40));
  if (tail) stack[stack.length - 1]!.children.push({ kind: 'text', value: tail });
  if (stack.length > 1) throw new TemplateError('unclosed_section', stack[stack.length - 1]!.key);
  return root;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Scope = Record<string, unknown>;

function lookup(stack: unknown[], key: string): unknown {
  if (key === '.') return stack[stack.length - 1];
  const [head, ...rest] = key.split('.');
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const scope = stack[index];
    if (scope && typeof scope === 'object' && head! in (scope as Scope)) {
      return rest.reduce<unknown>(
        (value, part) => (value && typeof value === 'object' ? (value as Scope)[part] : undefined),
        (scope as Scope)[head!],
      );
    }
  }
  return undefined;
}

function renderNodes(nodes: Node[], stack: unknown[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.value;
      const value = lookup(stack, node.key);
      if (node.kind === 'value') {
        if (value === undefined || value === null) return '';
        // Без экранирования выводятся только готовые блоки платформы.
        return node.raw && node.key.startsWith('blocks.')
          ? String(value)
          : escapeHtml(String(value));
      }
      const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
      if (node.inverted) return truthy ? '' : renderNodes(node.children, stack);
      if (!truthy) return '';
      if (Array.isArray(value)) {
        return value.map((item) => renderNodes(node.children, [...stack, item])).join('');
      }
      return renderNodes(node.children, typeof value === 'object' ? [...stack, value] : stack);
    })
    .join('');
}

export function renderTemplate(source: string, context: Scope): string {
  return renderNodes(parseTemplate(source), [context]);
}

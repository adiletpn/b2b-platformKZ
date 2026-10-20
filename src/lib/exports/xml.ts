/** Экранирование значений XML: выгрузки собираются строками, без новых зависимостей. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function tag(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

import { chromium, type Browser } from 'playwright';

/**
 * HTML-шаблон → PDF (раздел 5.3 ТЗ). В демо генерация синхронная, без очереди.
 * Браузер один на процесс: запуск занимает заметно больше, чем сам рендер.
 */
const globalForPdf = globalThis as unknown as { pdfBrowser?: Promise<Browser> };

async function getBrowser(): Promise<Browser> {
  const existing = await globalForPdf.pdfBrowser;
  if (existing?.isConnected()) return existing;

  globalForPdf.pdfBrowser = chromium.launch();
  return globalForPdf.pdfBrowser;
}

/**
 * Шаблоны печатных форм правит администратор платформы (раздел 3.13 ТЗ), поэтому HTML
 * рендерится без JavaScript и без сети: всё нужное (QR, штрихкод) встроено в разметку.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
  } finally {
    await context.close();
  }
}

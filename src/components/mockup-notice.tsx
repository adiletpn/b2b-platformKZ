import { getTranslations } from 'next-intl/server';

/** Плашка «макет»: раздел показан в демо без логики (раздел 1.2 демо-ТЗ). */
export async function MockupNotice() {
  const t = await getTranslations('mockups');

  return (
    <div
      className="border-border bg-muted mt-4 rounded-lg border border-dashed p-3 text-sm"
      data-testid="mockup-notice"
    >
      <span className="font-medium">{t('badge')}</span>
      <span className="text-muted-foreground"> — {t('note')}</span>
    </div>
  );
}

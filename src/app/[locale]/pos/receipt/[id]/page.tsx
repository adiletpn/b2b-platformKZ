import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { maskPhone } from '@/lib/phone';
import { PrintButton } from './print-button';

/**
 * Чек для чекового принтера 58/80 мм (раздел 4.2 ТЗ). Печать идёт через диалог браузера:
 * модель принтера и драйвер онлайн-кассы партнёра пока не выбраны — TODO(open-question).
 */
export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  if (!(await hasPermission(access!, 'POS', 'VIEW'))) redirect({ href: '/dashboard', locale });

  // Правило 4: чек только своей компании.
  const receipt = await prisma.receipt.findFirst({
    where: { id, companyId: access!.companyId },
    include: {
      company: { select: { name: true, bin: true } },
      location: { select: { address: true } },
      user: { select: { name: true } },
      loyaltyCustomer: { select: { phone: true } },
      items: { include: { product: { select: { nameRu: true, nameKk: true } } } },
    },
  });
  if (!receipt) notFound();

  const t = await getTranslations('receiptPrint');
  const tPay = await getTranslations('reportsXlsx');

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-6">
      <style>{`@media print {
  body * { visibility: hidden; }
  .receipt-paper, .receipt-paper * { visibility: visible; }
  .receipt-paper { position: absolute; left: 0; top: 0; width: 72mm; border: 0; padding: 0; }
  @page { margin: 2mm; }
}`}</style>
      <div
        className="receipt-paper border-border bg-card rounded-lg border p-4 font-mono text-xs leading-relaxed"
        data-testid="receipt-paper"
      >
        <p className="text-center font-bold">{receipt.company.name}</p>
        <p className="text-center">
          {t('bin')} {receipt.company.bin}
        </p>
        <p className="text-center">{receipt.location.address}</p>
        <hr className="my-2 border-dashed" />
        <p>
          {receipt.refundOf ? t('refundTitle') : t('saleTitle')} № {receipt.number}
        </p>
        <p>{formatDateTime(receipt.createdAt)}</p>
        {receipt.user?.name ? (
          <p>
            {t('cashier')}: {receipt.user.name}
          </p>
        ) : null}
        <hr className="my-2 border-dashed" />
        <ul>
          {receipt.items.map((item) => (
            <li key={item.id} className="mb-1">
              <p>{locale === 'kk' ? item.product.nameKk : item.product.nameRu}</p>
              <p className="flex justify-between gap-2">
                <span>
                  {item.pieces
                    ? t('pieces', { pieces: item.pieces, price: item.price.toFixed(2) })
                    : `${item.quantity.toFixed(3)} × ${item.price.toFixed(2)}`}
                </span>
                <span>{item.total.toFixed(2)}</span>
              </p>
              {item.pieces ? (
                <p data-testid="receipt-piece">
                  {t('pieceShare', { share: item.quantity.abs().toFixed(3) })}
                </p>
              ) : null}
              {item.discount.isZero() ? null : (
                <p className="flex justify-between gap-2">
                  <span>{t('discount')}</span>
                  <span>−{item.discount.toFixed(2)}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        <hr className="my-2 border-dashed" />
        <p className="flex justify-between gap-2 text-sm font-bold">
          <span>{t('total')}</span>
          <span>{receipt.total.toFixed(2)} ₸</span>
        </p>
        {receipt.bonusRedeemed.isZero() ? null : (
          <>
            <p className="flex justify-between gap-2" data-testid="receipt-bonus">
              <span>{t('bonusRedeemed')}</span>
              <span>−{receipt.bonusRedeemed.toFixed(2)}</span>
            </p>
            <p className="flex justify-between gap-2 font-bold">
              <span>{t('toPay')}</span>
              <span>{receipt.total.minus(receipt.bonusRedeemed).toFixed(2)} ₸</span>
            </p>
          </>
        )}
        <p className="flex justify-between gap-2">
          <span>{t('payment')}</span>
          <span>{tPay(`payment_${receipt.paymentType}`)}</span>
        </p>
        {receipt.loyaltyCustomer ? (
          <>
            <p>
              {t('customer')}: {maskPhone(receipt.loyaltyCustomer.phone)}
            </p>
            {receipt.bonusEarned.isZero() ? null : (
              <p className="flex justify-between gap-2">
                <span>{t('bonusEarned')}</span>
                <span>{receipt.bonusEarned.toFixed(2)}</span>
              </p>
            )}
          </>
        ) : null}
        {receipt.fiscalId ? (
          <>
            <hr className="my-2 border-dashed" />
            <p>
              {t('fiscal')}: {receipt.fiscalId}
            </p>
            {receipt.fiscalUrl ? <p className="break-all">{receipt.fiscalUrl}</p> : null}
          </>
        ) : null}
        <p className="mt-2 text-center">{t('thanks')}</p>
      </div>
      <div className="mt-4 flex justify-center">
        <PrintButton label={t('print')} />
      </div>
    </main>
  );
}

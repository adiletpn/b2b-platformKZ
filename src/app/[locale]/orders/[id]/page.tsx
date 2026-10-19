import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { sideOf } from '@/lib/orders/workflow';
import { prisma } from '@/lib/prisma';
import { OrderDetail } from './order-detail';

export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      store: { select: { name: true } },
      items: { include: { offer: { include: { product: { include: { unit: true } } } } } },
      statusLogs: { orderBy: { createdAt: 'asc' } },
      documents: { orderBy: { issuedAt: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      ratings: true,
      supplier: { select: { name: true, iik: true, bik: true, bankName: true } },
    },
  });
  if (!order) notFound();

  // Правило 4: чужая заявка не открывается.
  const side = sideOf(order, active!.companyId);
  if (!side) notFound();

  return (
    <OrderDetail
      locale={locale === 'kk' ? 'kk' : 'ru'}
      side={side}
      order={{
        id: order.id,
        number: order.number,
        status: order.status,
        total: order.totalWithVat.toFixed(2),
        counterparty: side === 'store' ? order.supplier.name : order.store.name,
        rejectionReason: order.rejectionReason,
        items: order.items.map((item) => ({
          id: item.id,
          nameRu: item.offer.product.nameRu,
          nameKk: item.offer.product.nameKk,
          unitRu: item.offer.product.unit.nameRu,
          unitKk: item.offer.product.unit.nameKk,
          quantityOrdered: item.quantityOrdered.toFixed(3),
          quantityConfirmed: item.quantityConfirmed?.toFixed(3) ?? null,
          priceWithVat: item.priceWithVat.toFixed(2),
        })),
        statusLogs: order.statusLogs.map((log) => ({
          toStatus: log.toStatus,
          createdAt: log.createdAt.toLocaleString('ru-RU'),
          comment: log.comment,
        })),
        disputeReason: order.disputeReason,
        counterpartyId: side === 'store' ? order.supplierId : order.storeId,
        myRatingScore:
          order.ratings
            .find((rating) => rating.authorCompanyId === active!.companyId)
            ?.score.toFixed(2) ?? null,
        payments: order.payments.map((payment) => ({
          id: payment.id,
          amount: payment.amount.toFixed(2),
          reference: payment.reference,
        })),
        supplierRequisites: {
          iik: order.supplier.iik,
          bik: order.supplier.bik,
          bankName: order.supplier.bankName,
        },
        documents: order.documents.map((document) => ({
          id: document.id,
          type: document.type,
          number: document.number,
          totalWithVat: document.totalWithVat.toFixed(2),
        })),
      }}
    />
  );
}

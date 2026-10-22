import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getAccess, hasPermission, permissionFlags } from '@/lib/auth/permissions';
import { formatDateTime, formatShortDate } from '@/lib/format';
import { getOnlinePayment } from '@/lib/payments/online';
import { listDocumentVersions } from '@/lib/documents/versions';
import { listAttachments } from '@/lib/files/attachments';
import type { DocumentPayload } from '@/lib/documents/payload';
import { isLiveGateway } from '@/mocks/payment-gateway';
import { sideOf } from '@/lib/orders/workflow';
import { prisma } from '@/lib/prisma';
import { OrderDetail } from './order-detail';

/** Подписи прошлых версий остаются в базе, в карточке — только по текущей. */
function currentSignatures<T extends { version: number }>(document: {
  version: number;
  signatures: T[];
}) {
  return document.signatures.filter((signature) => signature.version === document.version);
}

export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });
  // Раздел 3.12 ТЗ: заявки видит тот, у кого есть на них право. Торговый представитель
  // смотрит заявки своих магазинов в разделе представителей, а не все заявки компании.
  const access = await getAccess();
  if (!access || !(await hasPermission(access, 'SWIPE_ORDERS', 'VIEW'))) {
    redirect({ href: '/dashboard', locale });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      store: { select: { name: true } },
      items: { include: { offer: { include: { product: { include: { unit: true } } } } } },
      statusLogs: { orderBy: { createdAt: 'asc' } },
      documents: {
        orderBy: { issuedAt: 'asc' },
        include: { signatures: { orderBy: { signedAt: 'asc' } } },
      },
      payments: { orderBy: { createdAt: 'asc' } },
      ratings: true,
      supplier: { select: { name: true, iik: true, bik: true, bankName: true } },
    },
  });
  if (!order) notFound();

  // Правило 4: чужая заявка не открывается.
  const side = sideOf(order, active!.companyId);
  if (!side) notFound();
  // Черновик магазина поставщику не виден: заявка ему ещё не отправлена.
  if (side === 'supplier' && order.status === 'DRAFT') notFound();

  const can = await permissionFlags('DOCUMENTS_PAYMENTS', ['SIGN', 'UPDATE', 'CREATE', 'DELETE']);
  const versions = await Promise.all(
    order.documents.map((document) => listDocumentVersions(document.id, active!.companyId)),
  );
  const onlinePayment =
    side === 'store' ? await getOnlinePayment(order.id, active!.companyId) : null;
  // Раздел 3.4 ТЗ: вместо отсутствующей позиции поставщик предлагает свой товар.
  const substituteOffers =
    side === 'supplier' && order.status === 'SENT'
      ? await prisma.supplierOffer.findMany({
          where: {
            supplierId: active!.companyId,
            isActive: true,
            stock: { gt: 0 },
            id: { notIn: order.items.map((item) => item.offerId) },
          },
          include: { product: { select: { nameRu: true, nameKk: true } } },
          orderBy: { product: { nameRu: 'asc' } },
          take: 300,
        })
      : [];

  return (
    <OrderDetail
      locale={locale === 'kk' ? 'kk' : 'ru'}
      side={side}
      onlinePayment={onlinePayment}
      mockGateway={!isLiveGateway()}
      substituteOffers={substituteOffers.map((offer) => ({
        id: offer.id,
        name: locale === 'kk' ? offer.product.nameKk : offer.product.nameRu,
        priceWithVat: offer.priceWithVat.toFixed(2),
      }))}
      files={{
        initial: (await listAttachments(active!.companyId, order.id)) ?? [],
        canUpload: can.CREATE,
        canDelete: can.DELETE,
      }}
      order={{
        id: order.id,
        number: order.number,
        status: order.status,
        total: order.totalWithVat.toFixed(2),
        counterparty: side === 'store' ? order.supplier.name : order.store.name,
        createdOn: formatShortDate(order.createdAt, locale),
        rejectionReason: order.rejectionReason,
        creditHold: order.creditHold && order.status === 'DRAFT',
        items: order.items.map((item) => ({
          id: item.id,
          nameRu: item.offer.product.nameRu,
          nameKk: item.offer.product.nameKk,
          unitRu: item.offer.product.unit.nameRu,
          unitKk: item.offer.product.unit.nameKk,
          quantityOrdered: item.quantityOrdered.toFixed(3),
          quantityConfirmed: item.quantityConfirmed?.toFixed(3) ?? null,
          priceWithVat: item.priceWithVat.toFixed(2),
          substituteForId: item.substituteForId,
          barcode: item.offer.product.barcode,
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
        documents: order.documents.map((document, index) => ({
          id: document.id,
          type: document.type,
          number: document.number,
          totalWithVat: document.totalWithVat.toFixed(2),
          versions: versions[index] ?? [],
          deliveryAddress: (document.payload as unknown as DocumentPayload).deliveryAddress,
          // Исправляет выписавшая сторона (раздел 4.3 ТЗ).
          canCorrect: can.UPDATE && document.issuerId === active!.companyId,
          signatures: currentSignatures(document).map((signature) => ({
            signerName: signature.signerName,
            signedAt: formatDateTime(signature.signedAt),
            certificate: signature.certificate,
          })),
          // Подписывает каждая сторона один раз, при наличии права SIGN (раздел 3.12 ТЗ).
          canSign:
            can.SIGN &&
            !currentSignatures(document).some(
              (signature) => signature.companyId === active!.companyId,
            ),
        })),
      }}
    />
  );
}

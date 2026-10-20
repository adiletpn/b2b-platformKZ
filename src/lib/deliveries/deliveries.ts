import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { changeStatus } from '@/lib/orders/workflow';
import { uploadAttachment, type UploadResult } from '@/lib/files/attachments';

/** Статусы, которые видит водитель: собирается, в пути и только что доставлена. */
const DELIVERY_STATUSES: OrderStatus[] = ['PICKING', 'SHIPPED', 'DELIVERED'];

export type DeliveryRow = {
  orderId: string;
  number: string;
  status: OrderStatus;
  storeName: string;
  storePhone: string | null;
  address: string;
  deliveryDate: string | null;
  total: string;
  waybillId: string | null;
  photos: number;
};

/**
 * Список доставок водителя поставщика (разделы 1.2 и 3.5 ТЗ): куда везти, накладная
 * и отметка «доставлено». Правило 4: только заявки своей компании-поставщика.
 */
export async function listDeliveries(supplierId: string): Promise<DeliveryRow[]> {
  const orders = await prisma.order.findMany({
    where: { supplierId, status: { in: DELIVERY_STATUSES } },
    include: {
      store: { select: { name: true, contactPhone: true } },
      location: { include: { city: true } },
      documents: { where: { type: 'WAYBILL' }, select: { id: true } },
      attachments: { where: { kind: 'PHOTO', companyId: supplierId }, select: { id: true } },
    },
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });

  return orders.map((order) => ({
    orderId: order.id,
    number: order.number,
    status: order.status,
    storeName: order.store.name,
    storePhone: order.store.contactPhone,
    address: `${order.location.city.nameRu}, ${order.location.address}`,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : null,
    total: order.totalWithVat.toFixed(2),
    waybillId: order.documents[0]?.id ?? null,
    photos: order.attachments.length,
  }));
}

/** Отметка «доставлено» водителем: тот же переход статуса с записью в журнал. */
export function markDelivered(orderId: string, supplierId: string, userId: string) {
  return changeStatus(orderId, supplierId, userId, 'DELIVERED');
}

/** Фото подписанной бумажной накладной (раздел 3.5 ТЗ) — файл заявки, его видят обе стороны. */
export async function attachSignedWaybillPhoto(input: {
  orderId: string;
  supplierId: string;
  userId: string;
  fileName: string;
  data: Uint8Array;
  idempotencyKey?: string;
}): Promise<UploadResult> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, supplierId: input.supplierId, status: { in: DELIVERY_STATUSES } },
    select: { id: true },
  });
  if (!order) return { status: 'not_found' };
  return uploadAttachment({
    companyId: input.supplierId,
    userId: input.userId,
    orderId: input.orderId,
    kind: 'PHOTO',
    fileName: input.fileName,
    data: input.data,
    idempotencyKey: input.idempotencyKey,
  });
}

/** Накладная для водителя: только своей заявки в доставке. */
export async function waybillForDriver(orderId: string, supplierId: string) {
  return prisma.document.findFirst({
    where: {
      type: 'WAYBILL',
      orderId,
      issuerId: supplierId,
      order: { status: { in: DELIVERY_STATUSES } },
    },
  });
}

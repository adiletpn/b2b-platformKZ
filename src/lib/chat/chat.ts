import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { isBlocked } from './extras';

export const MESSAGE_MAX_LENGTH = 2000;

export type ChatSide = 'store' | 'supplier';

export type ChatSummary = {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  orderNumber: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
};

/**
 * Чат «магазин — поставщик» и отдельный чат внутри заявки (раздел 3.7 ТЗ).
 * Пара компаний плюс заявка определяют чат однозначно.
 */
export async function openChat(options: {
  companyId: string;
  counterpartyId: string;
  orderId?: string | null;
}) {
  const { companyId, counterpartyId } = options;
  const orderId = options.orderId ?? null;

  const [company, counterparty] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.company.findUnique({ where: { id: counterpartyId } }),
  ]);
  if (!company || !counterparty) return { status: 'not_found' as const };

  if (orderId) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const belongs =
      order &&
      ((order.storeId === companyId && order.supplierId === counterpartyId) ||
        (order.supplierId === companyId && order.storeId === counterpartyId));
    if (!belongs) return { status: 'not_found' as const };
  }

  // Сторона определяется типом компании: магазин всегда storeId, поставщик — supplierId.
  const storeId = company.type === 'SUPPLIER' ? counterpartyId : companyId;
  const supplierId = company.type === 'SUPPLIER' ? companyId : counterpartyId;
  if (storeId === supplierId) return { status: 'not_found' as const };

  const existing = await prisma.chat.findFirst({ where: { storeId, supplierId, orderId } });
  const chat = existing ?? (await prisma.chat.create({ data: { storeId, supplierId, orderId } }));

  return { status: 'ok' as const, chatId: chat.id };
}

export type SendResult =
  | { status: 'ok'; messageId: string }
  | { status: 'not_found' }
  | { status: 'empty_message' }
  | { status: 'too_long' }
  | { status: 'blocked' };

export async function sendMessage(
  chatId: string,
  companyId: string,
  userId: string,
  rawText: string,
): Promise<SendResult> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { order: { select: { number: true } } },
  });
  // Правило 4: писать в чужой чат нельзя.
  if (!chat || (chat.storeId !== companyId && chat.supplierId !== companyId)) {
    return { status: 'not_found' };
  }

  // Раздел 3.7 ТЗ: заблокированная переписка закрыта для обеих сторон.
  const otherId = chat.storeId === companyId ? chat.supplierId : chat.storeId;
  if (await isBlocked(companyId, otherId)) return { status: 'blocked' };

  const text = rawText.trim();
  if (text.length === 0) return { status: 'empty_message' };
  if (text.length > MESSAGE_MAX_LENGTH) return { status: 'too_long' };

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { chatId, authorCompanyId: companyId, authorUserId: userId, text },
    });
    await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    return created;
  });

  const counterpartyId = chat.storeId === companyId ? chat.supplierId : chat.storeId;
  await notify(counterpartyId, 'message_received', {
    number: chat.order?.number ?? '',
    text: text.slice(0, 80),
  });

  return { status: 'ok', messageId: message.id };
}

/** Прочитанными помечаются только сообщения собеседника. */
export async function markRead(chatId: string, companyId: string) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || (chat.storeId !== companyId && chat.supplierId !== companyId)) {
    return { status: 'not_found' as const };
  }

  const result = await prisma.message.updateMany({
    where: { chatId, authorCompanyId: { not: companyId }, readAt: null },
    data: { readAt: new Date() },
  });
  return { status: 'ok' as const, marked: result.count };
}

export async function listChats(companyId: string): Promise<ChatSummary[]> {
  const chats = await prisma.chat.findMany({
    where: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
    include: {
      store: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      order: { select: { number: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  const unread = await prisma.message.groupBy({
    by: ['chatId'],
    where: {
      chatId: { in: chats.map((chat) => chat.id) },
      authorCompanyId: { not: companyId },
      readAt: null,
    },
    _count: { _all: true },
  });
  const unreadByChat = new Map(unread.map((row) => [row.chatId, row._count._all]));

  return chats.map((chat) => {
    const counterparty = chat.storeId === companyId ? chat.supplier : chat.store;
    const last = chat.messages[0];
    return {
      id: chat.id,
      counterpartyId: counterparty.id,
      counterpartyName: counterparty.name,
      orderNumber: chat.order?.number ?? null,
      lastMessage: last?.text ?? null,
      lastMessageAt: last?.createdAt.toISOString() ?? null,
      unread: unreadByChat.get(chat.id) ?? 0,
    };
  });
}

export async function getMessages(chatId: string, companyId: string) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      store: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      order: { select: { number: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          attachments: { select: { id: true, mimeType: true } },
          offer: {
            select: {
              id: true,
              priceWithVat: true,
              product: { select: { nameRu: true, nameKk: true, barcode: true } },
            },
          },
          document: { select: { id: true, type: true, number: true } },
        },
      },
    },
  });
  if (!chat || (chat.storeId !== companyId && chat.supplierId !== companyId)) return null;

  const counterparty = chat.storeId === companyId ? chat.supplier : chat.store;
  return {
    id: chat.id,
    counterpartyName: counterparty.name,
    orderNumber: chat.order?.number ?? null,
    messages: chat.messages.map((message) => ({
      id: message.id,
      text: message.text,
      mine: message.authorCompanyId === companyId,
      read: message.readAt !== null,
      createdAt: message.createdAt.toISOString(),
      file: message.attachments[0]
        ? {
            id: message.attachments[0].id,
            image: message.attachments[0].mimeType.startsWith('image/'),
          }
        : null,
      offer: message.offer
        ? {
            id: message.offer.id,
            nameRu: message.offer.product.nameRu,
            nameKk: message.offer.product.nameKk,
            barcode: message.offer.product.barcode,
            price: message.offer.priceWithVat.toFixed(2),
          }
        : null,
      document: message.document,
    })),
  };
}

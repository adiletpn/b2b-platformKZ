import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/mocks/notifications';
import { detectFileType, uploadAttachment, type UploadResult } from '@/lib/files/attachments';
import { writeAdminAudit } from '@/lib/admin/session';

/** Раздел 3.7 ТЗ: шаблоны быстрых ответов, поиск, файлы, жалобы и блокировка. */
export const TEMPLATE_MAX_LENGTH = 500;
export const MAX_TEMPLATES = 30;

async function ownChat(chatId: string, companyId: string) {
  return prisma.chat.findFirst({
    where: { id: chatId, OR: [{ storeId: companyId }, { supplierId: companyId }] },
  });
}

// ---------- Шаблоны быстрых ответов ----------

export async function listTemplates(companyId: string) {
  const rows = await prisma.chatTemplate.findMany({
    where: { companyId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, text: row.text }));
}

export async function addTemplate(companyId: string, rawText: string) {
  const text = rawText.trim();
  if (!text) return { status: 'empty_message' as const };
  if (text.length > TEMPLATE_MAX_LENGTH) return { status: 'too_long' as const };
  if ((await prisma.chatTemplate.count({ where: { companyId } })) >= MAX_TEMPLATES) {
    return { status: 'too_many' as const };
  }
  const row = await prisma.chatTemplate.create({ data: { companyId, text } });
  return { status: 'ok' as const, id: row.id };
}

export async function deleteTemplate(id: string, companyId: string) {
  const deleted = await prisma.chatTemplate.deleteMany({ where: { id, companyId } });
  return deleted.count > 0 ? ('ok' as const) : ('not_found' as const);
}

// ---------- Поиск ----------

export type SearchHit = {
  chatId: string;
  messageId: string;
  counterpartyName: string;
  orderNumber: string | null;
  text: string;
  createdAt: string;
};

/** Поиск по сообщениям своих переписок, без учёта регистра. */
export async function searchMessages(companyId: string, rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const rows = await prisma.message.findMany({
    where: {
      text: { contains: query, mode: 'insensitive' },
      // Правило 4: только свои переписки.
      chat: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
    },
    include: {
      chat: {
        include: {
          store: { select: { name: true } },
          supplier: { select: { name: true } },
          order: { select: { number: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return rows.map((row) => ({
    chatId: row.chatId,
    messageId: row.id,
    counterpartyName: row.chat.storeId === companyId ? row.chat.supplier.name : row.chat.store.name,
    orderNumber: row.chat.order?.number ?? null,
    text: row.text,
    createdAt: formatDateTime(row.createdAt),
  }));
}

// ---------- Блокировка ----------

/** Переписка закрыта, если хотя бы одна сторона заблокировала другую. */
export async function isBlocked(companyA: string, companyB: string) {
  const block = await prisma.chatBlock.findFirst({
    where: {
      OR: [
        { blockerCompanyId: companyA, blockedCompanyId: companyB },
        { blockerCompanyId: companyB, blockedCompanyId: companyA },
      ],
    },
  });
  return block !== null;
}

export async function setBlocked(chatId: string, companyId: string, blocked: boolean) {
  const chat = await ownChat(chatId, companyId);
  if (!chat) return { status: 'not_found' as const };
  const counterpartyId = chat.storeId === companyId ? chat.supplierId : chat.storeId;
  if (blocked) {
    await prisma.chatBlock.upsert({
      where: {
        blockerCompanyId_blockedCompanyId: {
          blockerCompanyId: companyId,
          blockedCompanyId: counterpartyId,
        },
      },
      update: {},
      create: { blockerCompanyId: companyId, blockedCompanyId: counterpartyId },
    });
  } else {
    await prisma.chatBlock.deleteMany({
      where: { blockerCompanyId: companyId, blockedCompanyId: counterpartyId },
    });
  }
  return { status: 'ok' as const };
}

/** Состояние блокировки для экрана: я заблокировал, меня заблокировали. */
export async function blockState(chatId: string, companyId: string) {
  const chat = await ownChat(chatId, companyId);
  if (!chat) return null;
  const counterpartyId = chat.storeId === companyId ? chat.supplierId : chat.storeId;
  const blocks = await prisma.chatBlock.findMany({
    where: {
      OR: [
        { blockerCompanyId: companyId, blockedCompanyId: counterpartyId },
        { blockerCompanyId: counterpartyId, blockedCompanyId: companyId },
      ],
    },
  });
  return {
    blockedByMe: blocks.some((block) => block.blockerCompanyId === companyId),
    blockedMe: blocks.some((block) => block.blockerCompanyId === counterpartyId),
  };
}

// ---------- Файлы ----------

/** Фото или файл в чат: создаётся сообщение с именем файла и вложение к нему. */
export async function sendFile(input: {
  chatId: string;
  companyId: string;
  userId: string;
  fileName: string;
  data: Uint8Array;
}): Promise<UploadResult | { status: 'blocked' }> {
  const chat = await ownChat(input.chatId, input.companyId);
  if (!chat) return { status: 'not_found' };
  const counterpartyId = chat.storeId === input.companyId ? chat.supplierId : chat.storeId;
  if (await isBlocked(input.companyId, counterpartyId)) return { status: 'blocked' };

  const mime = detectFileType(input.data, input.fileName);
  if (!mime) return { status: 'unsupported_type' };

  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      authorCompanyId: input.companyId,
      authorUserId: input.userId,
      text: input.fileName.split(/[\\/]/).pop()!.slice(-200),
    },
  });
  const result = await uploadAttachment({
    companyId: input.companyId,
    userId: input.userId,
    messageId: message.id,
    kind: mime.startsWith('image/') ? 'PHOTO' : 'OTHER',
    fileName: input.fileName,
    data: input.data,
  });
  if (result.status !== 'ok') {
    await prisma.message.delete({ where: { id: message.id } });
    return result;
  }
  await prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
  await notify(counterpartyId, 'message_received', { number: '', text: message.text.slice(0, 80) });
  return result;
}

// ---------- Жалобы ----------

export type ComplaintResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'reason_required' }
  | { status: 'already_sent' };

/** Жалоба на сообщение собеседника (свои сообщения обжаловать нельзя). */
export async function complain(
  messageId: string,
  companyId: string,
  rawReason: string,
): Promise<ComplaintResult> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { chat: true },
  });
  if (
    !message ||
    message.authorCompanyId === companyId ||
    (message.chat.storeId !== companyId && message.chat.supplierId !== companyId)
  ) {
    return { status: 'not_found' };
  }
  const reason = rawReason.trim();
  if (reason.length < 3 || reason.length > 500) return { status: 'reason_required' };

  const existing = await prisma.chatComplaint.findUnique({
    where: { messageId_companyId: { messageId, companyId } },
  });
  if (existing) return { status: 'already_sent' };
  await prisma.chatComplaint.create({ data: { messageId, companyId, reason } });
  return { status: 'ok' };
}

export type ComplaintRow = {
  id: string;
  reason: string;
  messageText: string;
  authorName: string;
  complainantName: string;
  createdAt: string;
};

/** Очередь жалоб для модератора (раздел 3.13 ТЗ). */
export async function listOpenComplaints(): Promise<ComplaintRow[]> {
  const rows = await prisma.chatComplaint.findMany({
    where: { status: 'OPEN' },
    include: {
      company: { select: { name: true } },
      message: { include: { authorCompany: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    messageText: row.message.text,
    authorName: row.message.authorCompany.name,
    complainantName: row.company.name,
    createdAt: formatDateTime(row.createdAt),
  }));
}

/** Решение по жалобе: комментарий обязателен, запись в журнал аудита. */
export async function resolveComplaint(adminId: string, id: string, rawResolution: string) {
  const resolution = rawResolution.trim();
  if (resolution.length < 3) return { status: 'comment_required' as const };
  const complaint = await prisma.chatComplaint.findFirst({ where: { id, status: 'OPEN' } });
  if (!complaint) return { status: 'not_found' as const };
  await prisma.chatComplaint.update({
    where: { id },
    data: { status: 'RESOLVED', resolution, resolvedAt: new Date() },
  });
  await writeAdminAudit(adminId, 'chat_complaint_resolved', {
    entity: 'ChatComplaint',
    entityId: id,
    reason: resolution,
  });
  return { status: 'ok' as const };
}

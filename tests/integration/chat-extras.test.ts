import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { openChat, sendMessage, getMessages } from '@/lib/chat/chat';
import {
  addTemplate,
  blockState,
  complain,
  deleteTemplate,
  listOpenComplaints,
  listTemplates,
  resolveComplaint,
  listShareables,
  searchMessages,
  sendCard,
  sendFile,
  sendVoice,
  setBlocked,
} from '@/lib/chat/extras';
import { detectAudioType } from '@/lib/files/attachments';
import { chatChangesSince } from '@/lib/chat/live';
import { readAttachment } from '@/lib/files/attachments';

const prisma = createTestPrisma();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

async function pairWithChat(index: number, upTo: 'SENT' | 'ACCEPTED' = 'SENT') {
  const base = await orderFixture(prisma, {
    index,
    phones: ['7743', '7744'],
    binBase: 600,
    productBase: 290000,
    upTo,
  });
  const opened = await openChat({ companyId: base.storeId, counterpartyId: base.supplierId });
  if (opened.status !== 'ok') throw new Error(opened.status);
  return { ...base, chatId: opened.chatId };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('чат: шаблоны, поиск, файлы (раздел 3.7 ТЗ)', () => {
  it('templates_belong_to_company', async () => {
    const context = await pairWithChat(1);
    const added = await addTemplate(context.supplierId, '  Доставка завтра до 12:00  ');
    expect(added.status).toBe('ok');
    expect(await listTemplates(context.supplierId)).toEqual([
      { id: (added as { id: string }).id, text: 'Доставка завтра до 12:00' },
    ]);
    // Правило 4: чужой шаблон не виден и не удаляется.
    expect(await listTemplates(context.storeId)).toEqual([]);
    expect(await deleteTemplate((added as { id: string }).id, context.storeId)).toBe('not_found');
    expect(await addTemplate(context.supplierId, ' ')).toEqual({ status: 'empty_message' });
  });

  it('search_finds_only_own_chats', async () => {
    const context = await pairWithChat(2);
    const other = await pairWithChat(3);
    await sendMessage(
      context.chatId,
      context.storeId,
      context.storeUserId,
      'Нужна накладная по айрану',
    );
    await sendMessage(other.chatId, other.storeId, other.storeUserId, 'Айран закончился');

    const hits = await searchMessages(context.supplierId, 'айран');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain('накладная');
    expect(await searchMessages(context.supplierId, 'а')).toEqual([]);
  });

  it('photo_in_chat_is_visible_to_both_sides_only', async () => {
    const context = await pairWithChat(4);
    const other = await pairWithChat(5);
    const sent = await sendFile({
      chatId: context.chatId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      fileName: 'полка.png',
      data: PNG,
    });
    if (sent.status !== 'ok') throw new Error(sent.status);

    const chat = await getMessages(context.chatId, context.storeId);
    expect(chat!.messages[0]!.file).toEqual({
      id: sent.id,
      image: true,
      voice: false,
      durationMs: null,
    });
    expect(await readAttachment(sent.id, context.storeId)).not.toBeNull();
    expect(await readAttachment(sent.id, other.storeId)).toBeNull();
    // В чужую переписку файл не отправить.
    expect(
      (
        await sendFile({
          chatId: context.chatId,
          companyId: other.storeId,
          userId: other.storeUserId,
          fileName: 'x.png',
          data: PNG,
        })
      ).status,
    ).toBe('not_found');
  });
});

describe('чат: голосовые и реальное время (раздел 3.7 ТЗ)', () => {
  const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5]);

  it('audio_containers_are_detected_by_first_bytes', () => {
    expect(detectAudioType(WEBM)).toBe('audio/webm');
    expect(detectAudioType(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2]))).toBe('audio/ogg');
    expect(
      detectAudioType(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34])),
    ).toBe('audio/mp4');
    // Картинка под видом голосового не пройдёт.
    expect(detectAudioType(PNG)).toBeNull();
  });

  it('voice_message_is_limited_to_two_minutes_and_own_chats', async () => {
    const context = await pairWithChat(8);
    const other = await pairWithChat(9);
    const base = {
      chatId: context.chatId,
      companyId: context.storeId,
      userId: context.storeUserId,
      data: WEBM,
    };
    expect((await sendVoice({ ...base, durationMs: 121_000 })).status).toBe('too_long');
    expect((await sendVoice({ ...base, durationMs: 5_000, data: PNG })).status).toBe(
      'unsupported_type',
    );
    expect((await sendVoice({ ...base, companyId: other.storeId, durationMs: 5_000 })).status).toBe(
      'not_found',
    );

    const since = new Date(Date.now() - 1000);
    const sent = await sendVoice({ ...base, durationMs: 15_000 });
    if (sent.status !== 'ok') throw new Error(sent.status);
    const chat = await getMessages(context.chatId, context.supplierId);
    expect(chat!.messages[0]!.file).toEqual({
      id: sent.id,
      image: false,
      voice: true,
      durationMs: 15_000,
    });

    // Поток событий видит изменение только у сторон переписки (правило 4).
    expect(await chatChangesSince(context.supplierId, since)).toEqual([context.chatId]);
    expect(await chatChangesSince(other.supplierId, since)).toEqual([]);
  });
});

describe('чат: блокировка и жалобы', () => {
  it('offer_and_document_cards_only_from_own_pair', async () => {
    const context = await pairWithChat(6, 'ACCEPTED');
    const other = await pairWithChat(7, 'ACCEPTED');

    const shareables = await listShareables(context.chatId, context.storeId);
    expect(shareables!.offers.map((offer) => offer.id)).toContain(context.offerId);
    expect(shareables!.documents.length).toBeGreaterThan(0);
    expect(await listShareables(context.chatId, other.storeId)).toBeNull();

    const offerCard = await sendCard({
      chatId: context.chatId,
      companyId: context.storeId,
      userId: context.storeUserId,
      offerId: context.offerId,
    });
    expect(offerCard.status).toBe('ok');
    const documentCard = await sendCard({
      chatId: context.chatId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      documentId: shareables!.documents[0]!.id,
    });
    expect(documentCard.status).toBe('ok');

    // Правило 4: товар и документ чужой пары в этот чат не уходят.
    const otherDocument = await prisma.document.findFirstOrThrow({
      where: { orderId: other.orderId },
    });
    expect(
      (
        await sendCard({
          chatId: context.chatId,
          companyId: context.storeId,
          userId: context.storeUserId,
          offerId: other.offerId,
        })
      ).status,
    ).toBe('not_found');
    expect(
      (
        await sendCard({
          chatId: context.chatId,
          companyId: context.storeId,
          userId: context.storeUserId,
          documentId: otherDocument.id,
        })
      ).status,
    ).toBe('not_found');

    const chat = await getMessages(context.chatId, context.supplierId);
    expect(chat!.messages.filter((message) => message.offer)).toHaveLength(1);
    expect(chat!.messages.filter((message) => message.document)).toHaveLength(1);
  });

  it('blocked_chat_refuses_messages_both_ways', async () => {
    const context = await pairWithChat(6);
    expect(await setBlocked(context.chatId, context.storeId, true)).toEqual({ status: 'ok' });

    expect(
      await sendMessage(context.chatId, context.supplierId, context.supplierUserId, 'Привет'),
    ).toEqual({
      status: 'blocked',
    });
    expect(
      await sendMessage(context.chatId, context.storeId, context.storeUserId, 'Привет'),
    ).toEqual({
      status: 'blocked',
    });
    expect(await blockState(context.chatId, context.supplierId)).toEqual({
      blockedByMe: false,
      blockedMe: true,
    });

    await setBlocked(context.chatId, context.storeId, false);
    expect(
      (await sendMessage(context.chatId, context.supplierId, context.supplierUserId, 'Привет'))
        .status,
    ).toBe('ok');
  });

  it('complaint_goes_to_moderator_and_is_resolved_with_comment', async () => {
    const context = await pairWithChat(7);
    const sent = await sendMessage(
      context.chatId,
      context.supplierId,
      context.supplierUserId,
      'Грубость',
    );
    if (sent.status !== 'ok') throw new Error(sent.status);

    // Свою реплику обжаловать нельзя, чужую — один раз.
    expect(await complain(sent.messageId, context.supplierId, 'сам на себя')).toEqual({
      status: 'not_found',
    });
    expect(await complain(sent.messageId, context.storeId, 'x')).toEqual({
      status: 'reason_required',
    });
    expect(await complain(sent.messageId, context.storeId, 'Оскорбление')).toEqual({
      status: 'ok',
    });
    expect(await complain(sent.messageId, context.storeId, 'Оскорбление')).toEqual({
      status: 'already_sent',
    });

    const queue = await listOpenComplaints();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.messageText).toBe('Грубость');

    const moderator = await prisma.adminUser.findFirstOrThrow({ where: { role: 'MODERATOR' } });
    expect(await resolveComplaint(moderator.id, queue[0]!.id, '')).toEqual({
      status: 'comment_required',
    });
    expect(await resolveComplaint(moderator.id, queue[0]!.id, 'Предупреждение отправлено')).toEqual(
      {
        status: 'ok',
      },
    );
    expect(await listOpenComplaints()).toEqual([]);
    expect(await prisma.adminAuditLog.count({ where: { action: 'chat_complaint_resolved' } })).toBe(
      1,
    );
  });
});

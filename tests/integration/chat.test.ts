import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { getMessages, listChats, markRead, openChat, sendMessage } from '@/lib/chat/chat';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function pair(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7750${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7751${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(350 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(351 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 20' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  return {
    supplier: { id: supplier.companyId, userId: supplierUser.id },
    store: { id: store.companyId, userId: storeUser.id },
    locationId: (await prisma.location.findFirstOrThrow({ where: { companyId: store.companyId } }))
      .id,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('чат магазина и поставщика', () => {
  it('chat_is_opened_once_for_a_pair_of_companies', async () => {
    const { store, supplier } = await pair(1);

    const first = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    const second = await openChat({ companyId: supplier.id, counterpartyId: store.id });

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    if (first.status !== 'ok' || second.status !== 'ok') return;
    // Обе стороны попадают в одну переписку.
    expect(second.chatId).toBe(first.chatId);
    expect(await prisma.chat.count()).toBe(1);
  });

  it('order_chat_is_separate_from_general_chat', async () => {
    const context = await pair(2);
    const order = await prisma.order.create({
      data: {
        number: 'CHAT-1',
        storeId: context.store.id,
        supplierId: context.supplier.id,
        locationId: context.locationId,
        status: 'SENT',
      },
    });

    const general = await openChat({
      companyId: context.store.id,
      counterpartyId: context.supplier.id,
    });
    const byOrder = await openChat({
      companyId: context.store.id,
      counterpartyId: context.supplier.id,
      orderId: order.id,
    });

    if (general.status !== 'ok' || byOrder.status !== 'ok') throw new Error('чат не открылся');
    expect(byOrder.chatId).not.toBe(general.chatId);
    expect(await prisma.chat.count()).toBe(2);
  });

  it('chat_of_foreign_order_is_not_opened', async () => {
    const first = await pair(3);
    const second = await pair(4);
    const order = await prisma.order.create({
      data: {
        number: 'CHAT-2',
        storeId: first.store.id,
        supplierId: first.supplier.id,
        locationId: first.locationId,
        status: 'SENT',
      },
    });

    const result = await openChat({
      companyId: second.store.id,
      counterpartyId: second.supplier.id,
      orderId: order.id,
    });
    expect(result.status).toBe('not_found');
  });

  it('message_is_delivered_to_counterparty_and_notified', async () => {
    const { store, supplier } = await pair(5);
    const chat = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    if (chat.status !== 'ok') throw new Error('чат не открылся');
    await prisma.notification.deleteMany();

    const sent = await sendMessage(chat.chatId, store.id, store.userId, '  Когда отгрузите?  ');
    expect(sent.status).toBe('ok');

    const forSupplier = await getMessages(chat.chatId, supplier.id);
    expect(forSupplier!.messages).toHaveLength(1);
    expect(forSupplier!.messages[0]!.text).toBe('Когда отгрузите?');
    // Для получателя сообщение чужое.
    expect(forSupplier!.messages[0]!.mine).toBe(false);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { companyId: supplier.id },
    });
    expect(notification.event).toBe('message_received');
  });

  it('empty_and_too_long_messages_are_refused', async () => {
    const { store, supplier } = await pair(6);
    const chat = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    if (chat.status !== 'ok') throw new Error('чат не открылся');

    expect(await sendMessage(chat.chatId, store.id, store.userId, '   ')).toEqual({
      status: 'empty_message',
    });
    expect(await sendMessage(chat.chatId, store.id, store.userId, 'я'.repeat(2001))).toEqual({
      status: 'too_long',
    });
    expect(await prisma.message.count()).toBe(0);
  });

  it('stranger_cannot_read_or_write_to_chat', async () => {
    const { store, supplier } = await pair(7);
    const stranger = await pair(8);
    const chat = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    if (chat.status !== 'ok') throw new Error('чат не открылся');

    // Правило 4: чужая переписка недоступна.
    expect(await getMessages(chat.chatId, stranger.store.id)).toBeNull();
    expect(
      await sendMessage(chat.chatId, stranger.store.id, stranger.store.userId, 'привет'),
    ).toEqual({ status: 'not_found' });
  });

  it('opening_chat_marks_counterparty_messages_as_read', async () => {
    const { store, supplier } = await pair(9);
    const chat = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    if (chat.status !== 'ok') throw new Error('чат не открылся');

    await sendMessage(chat.chatId, store.id, store.userId, 'первое');
    await sendMessage(chat.chatId, store.id, store.userId, 'второе');

    const beforeRead = await listChats(supplier.id);
    expect(beforeRead[0]!.unread).toBe(2);

    const marked = await markRead(chat.chatId, supplier.id);
    expect(marked).toEqual({ status: 'ok', marked: 2 });

    const afterRead = await listChats(supplier.id);
    expect(afterRead[0]!.unread).toBe(0);

    // Отправитель видит, что сообщения прочитаны.
    const forAuthor = await getMessages(chat.chatId, store.id);
    expect(forAuthor!.messages.every((message) => message.read)).toBe(true);
  });

  it('own_messages_do_not_count_as_unread', async () => {
    const { store, supplier } = await pair(10);
    const chat = await openChat({ companyId: store.id, counterpartyId: supplier.id });
    if (chat.status !== 'ok') throw new Error('чат не открылся');

    await sendMessage(chat.chatId, store.id, store.userId, 'сообщение магазина');

    expect((await listChats(store.id))[0]!.unread).toBe(0);
    expect((await listChats(supplier.id))[0]!.unread).toBe(1);
  });
});

import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { resetSessions, searchUsers, setUserBlocked } from '@/lib/admin/users';
import { integrationStatus, sendBroadcast } from '@/lib/admin/broadcasts';
import { buildReport } from '@/lib/admin/reports';
import {
  adminTicketAction,
  createTicket,
  getTicket,
  listCompanyTickets,
  listTickets,
  replyAsCompany,
} from '@/lib/support/tickets';

const prisma = createTestPrisma();

const fixture = (index: number) =>
  orderFixture(prisma, {
    index,
    phones: ['7745', '7746'],
    binBase: 600,
    productBase: 300000,
    upTo: 'SENT',
  });

async function admin(role: 'SUPERADMIN' | 'MODERATOR') {
  return prisma.adminUser.findFirstOrThrow({ where: { role } });
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('админка: пользователи (раздел 3.13 ТЗ)', () => {
  it('admin_finds_user_with_companies_and_blocks_with_reason', async () => {
    const context = await fixture(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: context.storeUserId } });
    await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const superadmin = await admin('SUPERADMIN');

    const found = await searchUsers(user.phone.slice(-9));
    expect(found).toHaveLength(1);
    expect(found[0]!.companies[0]!.role).toBe('OWNER');
    expect(found[0]!.sessions).toBe(1);

    expect(await setUserBlocked(superadmin.id, user.id, true, '')).toEqual({
      status: 'reason_required',
    });
    expect(await setUserBlocked(superadmin.id, user.id, true, 'Мошенничество')).toEqual({
      status: 'ok',
    });
    // Блокировка закрывает все сессии сразу.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await searchUsers(user.phone))[0]!.blocked).toBe(true);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: 'user_blocked' },
    });
    expect(audit.reason).toBe('Мошенничество');

    await setUserBlocked(superadmin.id, user.id, false, '');
    expect((await searchUsers(user.phone))[0]!.blocked).toBe(false);
    expect(await resetSessions(superadmin.id, user.id)).toEqual({ status: 'ok', sessions: 0 });
  });
});

describe('админка: обращения в поддержку', () => {
  it('ticket_goes_from_company_to_support_and_back', async () => {
    const context = await fixture(2);
    const other = await fixture(3);
    const support = await admin('SUPERADMIN');

    expect(
      await createTicket(context.storeId, context.storeUserId, { subject: '', text: 'x' }),
    ).toEqual({
      status: 'invalid',
    });
    const created = await createTicket(context.storeId, context.storeUserId, {
      subject: 'Не приходит код',
      text: 'Код из SMS не приходит',
    });
    if (created.status !== 'ok') throw new Error(created.status);

    // Правило 4: чужая компания не видит обращение.
    expect(await listCompanyTickets(other.storeId)).toEqual([]);
    expect(await getTicket(created.id, other.storeId)).toBeNull();
    expect(await replyAsCompany(created.id, other.storeId, 'чужой ответ')).toEqual({
      status: 'not_found',
    });

    expect((await listTickets()).map((row) => row.id)).toEqual([created.id]);
    await adminTicketAction(support.id, created.id, { assignToMe: true });
    await adminTicketAction(support.id, created.id, { reply: 'Проверили, код пришёл' });
    const ticket = await getTicket(created.id, context.storeId);
    expect(ticket).toMatchObject({ status: 'IN_PROGRESS', assignee: support.name });
    expect(ticket!.messages.map((message) => message.fromAdmin)).toEqual([false, true]);
    expect(
      await prisma.notification.count({
        where: { companyId: context.storeId, event: 'support_reply' },
      }),
    ).toBe(1);

    await adminTicketAction(support.id, created.id, { status: 'CLOSED' });
    expect(await listTickets()).toEqual([]);
    // Ответ компании снова открывает закрытое обращение.
    await replyAsCompany(created.id, context.storeId, 'Снова не приходит');
    expect((await getTicket(created.id, context.storeId))!.status).toBe('OPEN');
  });
});

describe('админка: рассылки, отчёты, интеграции', () => {
  it('broadcast_reaches_only_segment', async () => {
    const context = await fixture(4);
    const superadmin = await admin('SUPERADMIN');

    const result = await sendBroadcast(superadmin.id, {
      text: 'Плановые работы ночью',
      type: 'SUPPLIER',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(
      await prisma.notification.count({
        where: { companyId: context.supplierId, event: 'platform_broadcast' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { companyId: context.storeId, event: 'platform_broadcast' },
      }),
    ).toBe(0);
    expect(await sendBroadcast(superadmin.id, { text: 'х' })).toEqual({ status: 'invalid_text' });
  });

  it('orders_and_city_reports_are_excel', async () => {
    await fixture(5);
    const period = {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    };
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(
      (await buildReport('cities', { city: 'Город', gmv: 'Оборот' }, period)) as never,
    );
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Город');
    expect(sheet.getRow(2).getCell(1).value).toBe('Тараз');
    expect(sheet.getRow(2).getCell(3).value).toBe('580.00');

    const orders = new ExcelJS.Workbook();
    await orders.xlsx.load((await buildReport('orders', {}, period)) as never);
    expect(orders.worksheets[0]!.rowCount).toBe(2);
  });

  it('integration_status_shows_mock_without_keys_and_never_values', () => {
    process.env.FISCAL_API_KEY = 'secret-value';
    try {
      const rows = integrationStatus();
      expect(rows.find((row) => row.key === 'fiscal')).toEqual({
        key: 'fiscal',
        env: 'FISCAL_API_KEY',
        live: true,
      });
      expect(JSON.stringify(rows)).not.toContain('secret-value');
      expect(rows.find((row) => row.key === 'sms')!.live).toBe(false);
    } finally {
      delete process.env.FISCAL_API_KEY;
    }
  });
});

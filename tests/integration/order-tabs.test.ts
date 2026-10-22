import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { orderTabWhere, parseOrderTab } from '@/lib/orders/list-tabs';

const prisma = createTestPrisma();

const fixture = () =>
  orderFixture(prisma, {
    index: 0,
    phones: ['7751', '7752'],
    binBase: 640,
    productBase: 320000,
    upTo: 'SENT',
  });

async function count(tab: Parameters<typeof orderTabWhere>[0], companyId: string) {
  return prisma.order.count({ where: orderTabWhere(tab, companyId) });
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('вкладки списка заявок (M07, D02)', () => {
  it('unknown_tab_falls_back_to_active', () => {
    expect(parseOrderTab(undefined)).toBe('active');
    expect(parseOrderTab('nope')).toBe('active');
    expect(parseOrderTab('archive')).toBe('archive');
  });

  it('new_order_needs_action_from_supplier_not_store', async () => {
    const { storeId, supplierId } = await fixture();
    expect(await count('action', supplierId)).toBe(1);
    expect(await count('action', storeId)).toBe(0);
    expect(await count('active', storeId)).toBe(1);
    expect(await count('archive', storeId)).toBe(0);
  });

  it('changed_order_needs_action_from_store', async () => {
    const { orderId, storeId, supplierId } = await fixture();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CHANGED_BY_SUPPLIER' } });
    expect(await count('action', storeId)).toBe(1);
    expect(await count('action', supplierId)).toBe(0);
  });

  it('shipped_and_payment_and_archive_tabs', async () => {
    const { orderId, storeId } = await fixture();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' } });
    expect(await count('transit', storeId)).toBe(1);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'OVERDUE' } });
    expect(await count('payment', storeId)).toBe(1);
    expect(await count('action', storeId)).toBe(1);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CLOSED' } });
    expect(await count('archive', storeId)).toBe(1);
    expect(await count('active', storeId)).toBe(0);
  });

  it('supplier_does_not_see_store_drafts', async () => {
    const { orderId, supplierId } = await fixture();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'DRAFT' } });
    expect(await count('active', supplierId)).toBe(0);
  });
});

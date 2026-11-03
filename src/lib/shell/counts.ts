import { prisma } from '@/lib/prisma';
import { orderTabWhere } from '@/lib/orders/list-tabs';
import { locationAllowed } from '@/lib/employees/permission-matrix';

/**
 * Счётчики в меню и нижней панели (макеты D01–D10 и M03–M13): корзина — сколько заявок
 * в ней наберётся (поставщиков), заявки — сколько ждут действия компании, чаты — непрочитанные.
 * Правило 4: всё считается только по компании из сессии.
 */
export type ShellCounts = { cart: number; orders: number; chat: number };

export async function shellCounts(
  companyId: string,
  options: { store: boolean; allowedLocationIds: string[] },
): Promise<ShellCounts> {
  const [cart, orders, chat] = await Promise.all([
    options.store ? cartSuppliers(companyId, options.allowedLocationIds) : 0,
    prisma.order.count({ where: orderTabWhere('action', companyId) }),
    prisma.message.count({
      where: {
        readAt: null,
        authorCompanyId: { not: companyId },
        chat: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
      },
    }),
  ]);
  return { cart, orders, chat };
}

/** Корзина точки, с которой работает сотрудник (как в getStoreContext). */
async function cartSuppliers(companyId: string, allowedLocationIds: string[]) {
  const locations = await prisma.location.findMany({
    where: { companyId, type: 'STORE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const location = locations.find((item) => locationAllowed(allowedLocationIds, item.id));
  if (!location) return 0;
  const items = await prisma.cartItem.findMany({
    where: { cart: { locationId: location.id } },
    select: { offer: { select: { supplierId: true } } },
  });
  return new Set(items.map((item) => item.offer.supplierId)).size;
}

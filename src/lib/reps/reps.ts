import Decimal from 'decimal.js';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { maskPhone } from '@/lib/phone';

/**
 * Торговые представители поставщика (этап 3 ТЗ). Владелец закрепляет за представителем
 * магазины, которые уже заказывали у поставщика. Представитель видит только свои магазины:
 * историю их заявок у этого поставщика, долги и отметки визитов.
 * TODO(open-question): заявку от имени магазина представитель не создаёт — нужна
 * договорённость о согласии магазина (раздел 1.2 ТЗ: «с его подтверждением»).
 */
export const VISIT_COMMENT_MAX = 1000;

const DEBT_STATUSES: OrderStatus[] = ['AWAITING_PAYMENT', 'OVERDUE'];

export type RepRow = { membershipId: string; label: string };
export type StoreOption = { storeId: string; name: string };
export type AssignmentRow = {
  storeId: string;
  storeName: string;
  membershipId: string;
  rep: string;
};

function memberLabel(user: { name: string | null; phone: string }) {
  // Правило 11: телефон сотрудника на экране — маской.
  return user.name ?? maskPhone(user.phone);
}

/** Сотрудники, у роли которых есть раздел «Торговые представители» (матрица прав в БД). */
export async function listReps(supplierId: string): Promise<RepRow[]> {
  const memberships = await prisma.membership.findMany({
    where: { companyId: supplierId, status: 'ACTIVE', role: { not: 'OWNER' } },
    include: {
      user: { select: { name: true, phone: true } },
      customRole: { include: { permissions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const templates = await prisma.role.findMany({
    where: { companyId: null },
    include: { permissions: true },
  });
  const byCode = new Map(templates.map((role) => [role.code, role]));
  return memberships
    .filter((membership) => {
      const role = membership.customRole ?? byCode.get(membership.role);
      return role?.permissions.some(
        (permission) => permission.section === 'SALES_REPS' && permission.action === 'VIEW',
      );
    })
    .map((membership) => ({ membershipId: membership.id, label: memberLabel(membership.user) }));
}

/** Магазины, которые уже отправляли заявки этому поставщику. */
export async function eligibleStores(supplierId: string): Promise<StoreOption[]> {
  const orders = await prisma.order.findMany({
    where: { supplierId, status: { not: 'DRAFT' } },
    select: { store: { select: { id: true, name: true } } },
    distinct: ['storeId'],
  });
  return orders
    .map((order) => ({ storeId: order.store.id, name: order.store.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listAssignments(supplierId: string): Promise<AssignmentRow[]> {
  const rows = await prisma.salesRepStore.findMany({
    where: { supplierId },
    include: {
      store: { select: { name: true } },
      membership: { include: { user: { select: { name: true, phone: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    storeId: row.storeId,
    storeName: row.store.name,
    membershipId: row.membershipId,
    rep: memberLabel(row.membership.user),
  }));
}

export type AssignResult = { status: 'ok' } | { status: 'not_rep' } | { status: 'not_customer' };

/** Закрепить магазин за представителем; у магазина один представитель, повтор переназначает. */
export async function assignStore(
  supplierId: string,
  actorId: string,
  membershipId: string,
  storeId: string,
): Promise<AssignResult> {
  const reps = await listReps(supplierId);
  if (!reps.some((rep) => rep.membershipId === membershipId)) return { status: 'not_rep' };
  const stores = await eligibleStores(supplierId);
  if (!stores.some((store) => store.storeId === storeId)) return { status: 'not_customer' };

  await prisma.salesRepStore.upsert({
    where: { supplierId_storeId: { supplierId, storeId } },
    update: { membershipId },
    create: { supplierId, storeId, membershipId },
  });
  await writeAudit(supplierId, actorId, 'rep_store_assigned', 'Company', storeId);
  return { status: 'ok' };
}

export async function unassignStore(supplierId: string, actorId: string, storeId: string) {
  const deleted = await prisma.salesRepStore.deleteMany({ where: { supplierId, storeId } });
  if (deleted.count === 0) return { status: 'not_found' as const };
  await writeAudit(supplierId, actorId, 'rep_store_unassigned', 'Company', storeId);
  return { status: 'ok' as const };
}

export type RepStoreView = {
  storeId: string;
  name: string;
  contactPhone: string | null;
  debt: string;
  overdue: string;
  orders: { id: string; number: string; status: OrderStatus; total: string; createdAt: string }[];
  visits: { id: string; comment: string; visitedAt: string }[];
};

/**
 * Магазины представителя: только закреплённые за ним (правило 4 и раздел 3.12 ТЗ),
 * заявки только у своего поставщика, долг — неоплаченные заявки к оплате и просроченные.
 */
export async function repStores(supplierId: string, membershipId: string): Promise<RepStoreView[]> {
  const assigned = await prisma.salesRepStore.findMany({
    where: { supplierId, membershipId },
    include: { store: { select: { id: true, name: true, contactPhone: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(
    assigned.map(async ({ store }) => {
      const [orders, visits] = await Promise.all([
        prisma.order.findMany({
          where: { supplierId, storeId: store.id, status: { not: 'DRAFT' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.salesRepVisit.findMany({
          where: { supplierId, storeId: store.id },
          orderBy: { visitedAt: 'desc' },
          take: 10,
        }),
      ]);
      let debt = new Decimal(0);
      let overdue = new Decimal(0);
      for (const order of orders) {
        if (!DEBT_STATUSES.includes(order.status)) continue;
        debt = debt.plus(order.totalWithVat.toString());
        if (order.status === 'OVERDUE') overdue = overdue.plus(order.totalWithVat.toString());
      }
      return {
        storeId: store.id,
        name: store.name,
        contactPhone: store.contactPhone,
        debt: debt.toFixed(2),
        overdue: overdue.toFixed(2),
        orders: orders.map((order) => ({
          id: order.id,
          number: order.number,
          status: order.status,
          total: order.totalWithVat.toFixed(2),
          createdAt: order.createdAt.toISOString(),
        })),
        visits: visits.map((visit) => ({
          id: visit.id,
          comment: visit.comment,
          visitedAt: visit.visitedAt.toISOString(),
        })),
      };
    }),
  );
}

export type VisitResult =
  { status: 'ok'; id: string } | { status: 'not_found' } | { status: 'comment_required' };

/** Отметка визита: только в закреплённый магазин, комментарий обязателен. */
export async function addVisit(
  supplierId: string,
  membershipId: string,
  userId: string,
  storeId: string,
  rawComment: string,
): Promise<VisitResult> {
  const assignment = await prisma.salesRepStore.findUnique({
    where: { supplierId_storeId: { supplierId, storeId } },
  });
  if (!assignment || assignment.membershipId !== membershipId) return { status: 'not_found' };
  const comment = rawComment.trim();
  if (!comment || comment.length > VISIT_COMMENT_MAX) return { status: 'comment_required' };

  const visit = await prisma.salesRepVisit.create({
    data: { supplierId, membershipId, storeId, comment },
  });
  await writeAudit(supplierId, userId, 'rep_visit', 'SalesRepVisit', visit.id);
  return { status: 'ok', id: visit.id };
}

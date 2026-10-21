'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

import type { OrderStatus as Status } from '@/generated/prisma/enums';

/**
 * Цвет статуса по макету: изменено поставщиком — оранжевый, в работе — нейтральный,
 * в пути — синий, ждёт оплаты и проблемы — красный, завершено — зелёный.
 */
const TONES: Record<Status, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'neutral',
  ACCEPTED: 'neutral',
  CHANGED_BY_SUPPLIER: 'warning',
  REJECTED: 'danger',
  PICKING: 'neutral',
  SHIPPED: 'info',
  DELIVERED: 'info',
  ACCEPTED_BY_STORE: 'success',
  ACCEPTED_WITH_DISCREPANCY: 'warning',
  AWAITING_PAYMENT: 'danger',
  OVERDUE: 'danger',
  PAID: 'success',
  CLOSED: 'success',
  DISPUTE: 'danger',
  CANCELLED: 'neutral',
};

export function OrderStatusBadge({ status, testId }: { status: Status; testId?: string }) {
  const t = useTranslations('orders');
  return (
    <Badge tone={TONES[status]} data-testid={testId}>
      {t(`status.${status}`)}
    </Badge>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

type Status =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'CHANGED_BY_SUPPLIER'
  | 'REJECTED'
  | 'PICKING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'ACCEPTED_BY_STORE'
  | 'ACCEPTED_WITH_DISCREPANCY'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'CLOSED'
  | 'CANCELLED';

/** Цвет статуса: ждём действия — синий, проблема — красный, завершено — зелёный. */
const TONES: Record<Status, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'info',
  CHANGED_BY_SUPPLIER: 'warning',
  REJECTED: 'danger',
  PICKING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'info',
  ACCEPTED_BY_STORE: 'success',
  ACCEPTED_WITH_DISCREPANCY: 'warning',
  AWAITING_PAYMENT: 'warning',
  PAID: 'success',
  CLOSED: 'success',
  CANCELLED: 'danger',
};

export function OrderStatusBadge({ status, testId }: { status: Status; testId?: string }) {
  const t = useTranslations('orders');
  return (
    <Badge tone={TONES[status]} data-testid={testId}>
      {t(`status.${status}`)}
    </Badge>
  );
}

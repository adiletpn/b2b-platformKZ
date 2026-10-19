import { prisma } from '@/lib/prisma';

/**
 * Мок-адаптер уведомлений. Интерфейс как у реальных каналов (WhatsApp, Telegram, email):
 * запись в лог и в интерфейс, реальных отправок нет.
 */
export const NOTIFICATION_CHANNELS = ['whatsapp', 'telegram', 'email'] as const;

export type NotificationEvent =
  | 'order_created'
  | 'order_accepted'
  | 'order_changed_by_supplier'
  | 'order_rejected'
  | 'order_changes_approved'
  | 'order_status_changed'
  | 'order_cancelled'
  | 'company_approved'
  | 'company_rejected'
  | 'rating_received'
  | 'message_received'
  | 'owner_transferred';

export async function notify(
  companyId: string,
  event: NotificationEvent,
  payload: Record<string, string | number>,
  orderId?: string,
) {
  console.info(`[notify-mock] ${event} → компания ${companyId.slice(0, 6)}…`);
  await prisma.notification.create({
    data: {
      companyId,
      event,
      orderId: orderId ?? null,
      channels: [...NOTIFICATION_CHANNELS],
      payload,
    },
  });
}

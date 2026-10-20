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
  | 'owner_transferred'
  | 'document_corrected'
  | 'support_reply'
  | 'platform_broadcast';

export async function notify(
  companyId: string,
  event: NotificationEvent,
  payload: Record<string, string | number>,
  orderId?: string,
) {
  console.info(`[notify-mock] ${event} → компания ${companyId.slice(0, 6)}…`);

  // Раздел 3.10 ТЗ: уведомление уходит только в выбранные компанией каналы.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { notificationChannels: true },
  });
  const channels = (company?.notificationChannels ?? [...NOTIFICATION_CHANNELS]).filter(
    (channel): channel is (typeof NOTIFICATION_CHANNELS)[number] =>
      (NOTIFICATION_CHANNELS as readonly string[]).includes(channel),
  );

  await prisma.notification.create({
    data: {
      companyId,
      event,
      orderId: orderId ?? null,
      channels,
      payload,
    },
  });
}

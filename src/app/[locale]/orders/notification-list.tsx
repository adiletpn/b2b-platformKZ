'use client';

import { useTranslations } from 'next-intl';

type Item = { id: string; event: string; channels: string[]; payload: Record<string, string> };

/** Мок-уведомления: показываем то, что «ушло» в WhatsApp, Telegram и email. */
export function NotificationList({ notifications }: { notifications: Item[] }) {
  const t = useTranslations('orders');

  return (
    <section className="border-border mt-8 rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-medium">{t('notifications')}</h2>
      {notifications.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="notifications-empty">
          {t('notificationsEmpty')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm" data-testid="notifications">
          {notifications.map((item) => (
            <li key={item.id} className="break-words">
              {t(`events.${item.event}` as 'events.order_created', {
                number: '',
                total: '',
                ...item.payload,
              })}
              <span className="text-muted-foreground ml-2 text-xs">
                {t('notificationChannels')}: {item.channels.join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

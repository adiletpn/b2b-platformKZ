'use client';

import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { money } from '@/lib/format';

type Item = { id: string; event: string; channels: string[]; payload: Record<string, string> };

/** Мок-уведомления: показываем то, что «ушло» в WhatsApp, Telegram и email. */
export function NotificationList({ notifications }: { notifications: Item[] }) {
  const t = useTranslations('orders');

  return (
    <section className="border-border mt-8 rounded-[20px] border-[1.5px] border-dashed p-[18px]">
      <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
        <Bell aria-hidden className="text-muted-foreground size-4" />
        {t('notifications')}
      </h2>
      {notifications.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="notifications-empty">
          {t('notificationsEmpty')}
        </p>
      ) : (
        <ul className="mt-2.5 space-y-1.5 text-sm font-medium" data-testid="notifications">
          {notifications.map((item) => (
            <li key={item.id} className="break-words">
              {t(`events.${item.event}` as 'events.order_created', {
                number: '',
                total: '',
                ...item.payload,
                // Сумма в payload — строка Decimal; выводим как в макете: «32 364».
                ...(item.payload.total ? { total: money(item.payload.total) } : {}),
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

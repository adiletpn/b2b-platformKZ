'use client';

import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Megaphone, X } from 'lucide-react';

const DISMISSED_KEY = 'dismissed-banners';

type Banner = { id: string; text: string };

function readStored(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function parse(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

const noSubscribe = () => () => {};

/**
 * Баннеры платформы в кабинете (раздел 3.13 ТЗ). Закрытый баннер запоминается в браузере
 * и больше не показывается на этом устройстве.
 */
export function CabinetBanners({ banners }: { banners: Banner[] }) {
  const t = useTranslations('dashboard.banners');
  // На сервере хранилища нет: баннеры не показываем, иначе закрытый мелькнёт до гидратации.
  const stored = useSyncExternalStore(noSubscribe, readStored, () => null);
  const [closedNow, setClosedNow] = useState<string[]>([]);
  const dismissed = stored === null ? null : [...parse(stored), ...closedNow];

  function dismiss(id: string) {
    const next = [...(dismissed ?? []), id];
    setClosedNow((current) => [...current, id]);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Приватный режим: баннер закрыт до перезагрузки.
    }
  }

  if (dismissed === null) return null;
  const visible = banners.filter((banner) => !dismissed.includes(banner.id));
  if (visible.length === 0) return null;

  return (
    <ul className="mb-4 space-y-2" data-testid="cabinet-banners">
      {visible.map((banner) => (
        <li
          key={banner.id}
          className="bg-primary-soft text-primary flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
          data-testid="cabinet-banner"
        >
          <Megaphone aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{banner.text}</span>
          <button
            type="button"
            className="-m-1 rounded p-1 opacity-70 hover:opacity-100"
            aria-label={t('dismiss')}
            data-testid="cabinet-banner-dismiss"
            onClick={() => dismiss(banner.id)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

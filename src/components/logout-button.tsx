'use client';

import { useRouter } from '@/i18n/navigation';
import { ChevronRight, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** variant="row" — строка меню «Кабинета» на телефоне (макет M13). */
export function LogoutButton({
  label,
  variant = 'icon',
}: {
  label: string;
  variant?: 'icon' | 'row';
}) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Сохранённая для работы без сети страница кассы не должна пережить выход (public/sw.js).
    if ('caches' in window) await caches.delete('b2b-pages-v1').catch(() => false);
    router.push('/login');
    router.refresh();
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={logout}
        data-testid="menu-logout"
        className="flex w-full items-center gap-3.5 py-[13px] text-left"
      >
        <span className="bg-muted grid size-[38px] shrink-0 place-items-center rounded-xl">
          <LogOut aria-hidden className="size-[19px]" />
        </span>
        <span className="flex-1 text-[15px] font-bold">{label}</span>
        <ChevronRight aria-hidden className="size-4 text-[#bdb5ab]" strokeWidth={2.4} />
      </button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="icon"
      className="size-9"
      aria-label={label}
      onClick={logout}
      data-testid="logout"
    >
      <LogOut aria-hidden />
    </Button>
  );
}

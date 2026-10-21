'use client';

import { useRouter } from '@/i18n/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Сохранённая для работы без сети страница кассы не должна пережить выход (public/sw.js).
    if ('caches' in window) await caches.delete('b2b-pages-v1').catch(() => false);
    router.push('/login');
    router.refresh();
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

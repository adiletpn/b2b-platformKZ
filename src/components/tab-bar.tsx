'use client';

import {
  Calculator,
  ClipboardList,
  MessagesSquare,
  Package,
  ShoppingCart,
  Store,
  Truck,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type TabItem = {
  href: '/feed' | '/cart' | '/orders' | '/pos' | '/dashboard' | '/catalog' | '/deliveries' | '/chat';
  label: string;
  icon: string;
};

const ICONS: Record<string, LucideIcon> = {
  feed: Layers,
  cart: ShoppingCart,
  orders: ClipboardList,
  pos: Calculator,
  cabinet: Store,
  catalog: Package,
  deliveries: Truck,
  chat: MessagesSquare,
};

/** Нижняя панель разделов на телефоне (макет M03–M13): активная вкладка оранжевая. */
export function TabBar({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 flex justify-around border-t px-2 pt-2.5 pb-[max(env(safe-area-inset-bottom),14px)] lg:hidden print:hidden"
      data-testid="tab-bar"
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? Store;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            data-testid={`tab-${item.href.slice(1)}`}
            className={cn(
              'flex w-16 flex-col items-center gap-1 text-[11px]',
              active ? 'text-primary font-extrabold' : 'font-semibold text-[#a39b91]',
            )}
          >
            <Icon aria-hidden className="size-6" strokeWidth={active ? 2.2 : 2} />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

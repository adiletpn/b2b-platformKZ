'use client';

import {
  Calculator,
  List,
  ClipboardList,
  MessagesSquare,
  Package,
  ShoppingCart,
  Store,
  Truck,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type TabItem = {
  href:
    '/feed' | '/cart' | '/orders' | '/pos' | '/dashboard' | '/catalog' | '/deliveries' | '/chat';
  label: string;
  icon: string;
  /** Режим ленты: «Список» — та же /feed с ?view=list (макет M05). */
  view?: 'list';
  /** Оранжевый счётчик над иконкой (макет M03): корзина, заявки. */
  badge?: number;
};

const ICONS: Record<string, LucideIcon> = {
  feed: Layers,
  list: List,
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
  const view = useSearchParams().get('view');
  return (
    <nav
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 flex justify-around border-t px-2 pt-2.5 pb-[max(env(safe-area-inset-bottom),14px)] lg:hidden print:hidden"
      data-testid="tab-bar"
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? Store;
        const onPath = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const active =
          item.href === '/feed' ? onPath && (view === 'list') === (item.view === 'list') : onPath;
        const key = item.view ? `${item.href}-${item.view}` : item.href;
        return (
          <Link
            key={key}
            href={item.view ? { pathname: item.href, query: { view: item.view } } : item.href}
            aria-current={active ? 'page' : undefined}
            data-testid={`tab-${item.view ?? item.href.slice(1)}`}
            className={cn(
              'relative flex w-16 flex-col items-center gap-1 text-[11px]',
              active ? 'text-primary font-extrabold' : 'font-semibold text-[#a39b91]',
            )}
          >
            <Icon aria-hidden className="size-6" strokeWidth={active ? 2.2 : 2} />
            {item.badge ? (
              <span
                className="bg-primary absolute -top-1 left-[38px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white px-[5px] text-[10px] font-extrabold text-white"
                data-testid={`tab-badge-${item.view ?? item.href.slice(1)}`}
              >
                {item.badge}
              </span>
            ) : null}
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

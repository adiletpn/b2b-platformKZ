'use client';

import {
  Archive,
  BarChart3,
  ChevronRight,
  Boxes,
  Calculator,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  MessagesSquare,
  Package,
  ShoppingBasket,
  ShoppingCart,
  Star,
  Truck,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { NavGroup } from './app-header';

/** Иконки разделов: сервер передаёт ключ, компонент иконки живёт на клиенте. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  feed: ShoppingBasket,
  cart: ShoppingCart,
  orders: ClipboardList,
  analytics: BarChart3,
  stock: Boxes,
  pos: Calculator,
  catalog: Package,
  deliveries: Truck,
  reps: UserCheck,
  settlements: Wallet,
  archive: Archive,
  chat: MessagesSquare,
  ratings: Star,
  requisites: Landmark,
  employees: Users,
  support: LifeBuoy,
};

/**
 * Разделы кабинета. Одна разметка на все экраны: на телефоне — прокручиваемая строка
 * под шапкой, на компьютере — колонка бокового меню одним списком, как в макете.
 */
export function NavLinks({
  groups,
  variant = 'sidebar',
}: {
  groups: NavGroup[];
  variant?: 'sidebar' | 'menu';
}) {
  const pathname = usePathname();

  // Список разделов на телефоне — внизу «Кабинета», как меню макета M13.
  if (variant === 'menu') {
    return (
      <nav
        className="border-border bg-card divide-border divide-y rounded-[22px] border px-4 py-0.5 lg:hidden"
        data-testid="mobile-menu"
      >
        {groups
          .flatMap((group) => group.items)
          .filter((item) => item.href !== '/dashboard')
          .map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`menu-${item.href.slice(1)}`}
                className="flex items-center gap-3.5 py-[13px]"
              >
                <span className="bg-muted grid size-[38px] shrink-0 place-items-center rounded-xl">
                  <Icon aria-hidden className="size-[19px]" />
                </span>
                <span className="flex-1 text-[15px] font-bold">{item.label}</span>
                {item.hint ? (
                  <span className="text-muted-foreground text-[13px] font-bold">{item.hint}</span>
                ) : null}
                <ChevronRight aria-hidden className="size-4 text-[#bdb5ab]" strokeWidth={2.4} />
              </Link>
            );
          })}
      </nav>
    );
  }

  return (
    <nav className="order-3 -mx-1 hidden w-full scrollbar-none gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_88%,transparent)] px-1 pt-1 pb-2.5 lg:order-3 lg:mx-0 lg:flex lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:[mask-image:none] lg:px-0 lg:pt-0 lg:pb-4">
      {groups.map((group) => (
        // Макет D01–D10: разделы одним списком, без подписей групп.
        <div key={group.label} className="contents lg:flex lg:flex-col lg:gap-0.5">
          {group.items.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex shrink-0 items-center gap-3 rounded-full px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors lg:rounded-[14px] lg:px-3 lg:py-[11px] lg:text-sm',
                  active
                    ? 'bg-primary-soft text-primary-text font-extrabold'
                    : 'border-border bg-card text-foreground hover:bg-muted border font-semibold lg:border-0 lg:bg-transparent',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 lg:size-5',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="lg:flex-1 lg:truncate">{item.label}</span>
                {item.badge ? (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-extrabold',
                      active ? 'bg-primary text-white' : 'bg-muted text-foreground',
                    )}
                    data-testid={`badge-${item.href.slice(1)}`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

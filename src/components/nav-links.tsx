'use client';

import {
  Archive,
  BarChart3,
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
 * под шапкой, на компьютере — колонка бокового меню с подписями групп.
 */
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="order-3 -mx-1 flex w-full scrollbar-none gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_88%,transparent)] px-1 pb-2 lg:order-3 lg:mx-0 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:[mask-image:none] lg:px-3 lg:pb-4">
      {groups.map((group) => (
        <div key={group.label} className="contents lg:block lg:pt-4 lg:first:pt-1">
          <p className="text-sidebar-muted hidden px-3 pb-1.5 text-[11px] font-medium tracking-wider uppercase lg:block">
            {group.label}
          </p>
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
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors lg:py-2',
                  active
                    ? 'bg-primary-soft text-primary lg:bg-sidebar-active lg:text-white'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground lg:text-sidebar-muted lg:hover:text-sidebar-foreground lg:hover:bg-white/5',
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

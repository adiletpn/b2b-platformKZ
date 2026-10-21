'use client';

import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { Avatar, Progress } from '@/components/ui/controls';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CartSupplierGroup } from '@/lib/cart/cart';

/**
 * Группа корзины по поставщику (макет M06 и правая панель D01): аватар, позиции, сумма
 * и прогресс до минимального заказа — зелёный, когда набран, оранжевый, когда не хватает.
 */
export function CartGroupCard({
  group,
  index,
  children,
  className,
}: {
  group: CartSupplierGroup;
  index: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('feed');
  const minimum = new Decimal(group.minOrderAmount);
  const percent = minimum.isZero()
    ? 100
    : new Decimal(group.total).div(minimum).times(100).toNumber();

  return (
    <div
      className={cn(
        'border-border bg-card flex flex-col gap-2.5 rounded-[20px] border p-3.5',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={group.supplierName} tone={index % 2 === 1 ? 'dark' : 'primary'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{group.supplierName}</p>
          <p className="text-muted-foreground text-xs font-semibold">
            {t('positions', { count: group.items.length })}
          </p>
        </div>
        <p className="text-[15px] font-black whitespace-nowrap tabular-nums">
          {money(group.total)} ₸
        </p>
      </div>
      {children}
      <Progress value={percent} tone={group.meetsMinimum ? 'success' : 'primary'} />
      <p
        className={cn(
          'text-xs font-bold',
          group.meetsMinimum ? 'text-success' : 'text-primary-text',
        )}
      >
        {group.meetsMinimum
          ? t('reachedMin', { min: money(group.minOrderAmount) })
          : t('missingMin', { missing: money(group.missingToMinimum) })}
      </p>
    </div>
  );
}

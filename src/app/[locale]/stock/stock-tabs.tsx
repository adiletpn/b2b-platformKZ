'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export const STOCK_SECTIONS = ['balances', 'documents', 'inventory', 'pricing', 'batches'] as const;
export type StockSection = (typeof STOCK_SECTIONS)[number];

/**
 * Вкладки склада по макету D09. Разделы остаются на одной странице: вкладка прокручивает
 * к своему блоку, чтобы документы, переоценка и сроки были под рукой без перезагрузки.
 */
export function StockTabs() {
  const t = useTranslations('stock.tabs');
  const [active, setActive] = useState<StockSection>('balances');

  return (
    <nav
      className="lg:border-border -mx-5 mb-4 flex scrollbar-none gap-6 overflow-x-auto px-5 lg:-mx-8 lg:-mt-6 lg:mb-5 lg:border-b lg:px-8"
      data-testid="stock-tabs"
    >
      {STOCK_SECTIONS.map((id) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={() => setActive(id)}
          aria-current={active === id ? 'true' : undefined}
          data-testid={`stock-tab-${id}`}
          className={cn(
            '-mb-px shrink-0 border-b-[2.5px] pt-3.5 pb-3 text-sm whitespace-nowrap',
            active === id
              ? 'border-primary text-foreground font-extrabold'
              : 'text-muted-foreground hover:text-foreground border-transparent font-semibold',
          )}
        >
          {t(id)}
        </a>
      ))}
    </nav>
  );
}

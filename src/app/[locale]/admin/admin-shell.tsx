import { getTranslations } from 'next-intl/server';
import {
  BarChart3,
  Building2,
  FileText,
  LayoutGrid,
  Scale,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Brand } from '@/components/app-header';
import { LanguageSwitcher } from '@/components/language-switcher';

export type AdminNavItem = { id: string; key: string; badge?: number };

const ICONS: Record<string, LucideIcon> = {
  dashboard: BarChart3,
  companies: Building2,
  users: Users,
  reference: LayoutGrid,
  moderation: ShieldAlert,
  disputes: Scale,
  tariffs: Wallet,
  audit: FileText,
};

/**
 * Каркас админки (макет D10): боковое меню 248 px, разделы — якоря одной страницы.
 * Пункты передаёт страница: каждой роли администратора только её разделы (раздел 3.13 ТЗ).
 */
export async function AdminShell({
  items,
  adminName,
  roleLabel,
  children,
}: {
  items: AdminNavItem[];
  adminName: string;
  roleLabel: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations('admin');
  const tApp = await getTranslations('app');
  return (
    <>
      <aside
        className="border-border bg-sidebar fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r px-4 pt-[22px] lg:flex"
        data-testid="admin-sidebar"
      >
        <div className="px-2 pb-5">
          <Brand name={tApp('name')} href="/" />
        </div>
        <div className="bg-muted mb-3.5 flex items-center gap-2.5 rounded-2xl p-2.5">
          <span
            aria-hidden
            className="bg-foreground grid size-9 shrink-0 place-items-center rounded-xl text-sm font-black text-white"
          >
            A
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-extrabold">{t('nav.title')}</p>
            <p className="text-muted-foreground text-[11px] font-semibold">{t('nav.subtitle')}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {items.map((item) => {
            const Icon = ICONS[item.key] ?? LayoutGrid;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                data-testid={`admin-nav-${item.key}`}
                className="hover:bg-muted flex items-center gap-3 rounded-[14px] px-3 py-[11px] text-sm font-semibold"
              >
                <Icon aria-hidden className="text-muted-foreground size-5 shrink-0" />
                <span className="flex-1 truncate">{t(`nav.${item.key}` as 'nav.title')}</span>
                {item.badge ? (
                  <span className="bg-muted rounded-full px-2 py-0.5 text-[11px] font-extrabold">
                    {item.badge}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="pb-3">
          <LanguageSwitcher testIdPrefix="admin-locale" />
        </div>
        <div className="border-border flex items-center gap-2.5 border-t py-3 pl-1">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#b9a58f] text-[13px] font-black text-white"
          >
            {adminName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold">{adminName}</p>
            <p className="text-muted-foreground truncate text-[11px] font-semibold">{roleLabel}</p>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[248px]">{children}</div>
    </>
  );
}

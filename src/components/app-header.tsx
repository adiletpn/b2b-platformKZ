import { getTranslations } from 'next-intl/server';
import { LogIn } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { LogoutButton } from '@/components/logout-button';
import { NavLinks } from '@/components/nav-links';

type NavItem = {
  href:
    | '/dashboard'
    | '/feed'
    | '/cart'
    | '/orders'
    | '/stock'
    | '/pos'
    | '/catalog'
    | '/deliveries'
    | '/ratings'
    | '/requisites'
    | '/employees'
    | '/settlements'
    | '/archive'
    | '/chat';
  label: string;
  testId: string;
  icon: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Знак платформы: плейсхолдер, логотип заказчик не передал (TZ-demo 8.6). */
function Brand({
  name,
  href,
  compact = false,
}: {
  name: string;
  href: '/' | '/dashboard';
  compact?: boolean;
}) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="from-primary grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br to-[oklch(0.62_0.14_200)] text-sm font-bold text-white shadow-sm"
      >
        B
      </span>
      <span className={`truncate text-sm font-semibold ${compact ? 'hidden sm:inline' : ''}`}>
        {name}
      </span>
    </Link>
  );
}

/**
 * Оболочка кабинета: разделы по типу компании, язык и выход. Гость видит только
 * верхнюю строку со входом. Содержимое страницы сдвигается под боковое меню.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('dashboard');
  const tApp = await getTranslations('app');
  const tType = await getTranslations('companyType');

  // Компания уже приходит вместе с сессией: лишний запрос к базе на каждый рендер не нужен.
  const session = await getSession();
  const membership =
    session?.user.memberships.find(
      (item) => item.companyId === session.activeCompanyId && item.status === 'ACTIVE',
    ) ?? session?.user.memberships.find((item) => item.status === 'ACTIVE');
  const company = membership?.company ?? null;

  if (!company) {
    return (
      <>
        <header className="border-border bg-card/80 sticky top-0 z-30 border-b backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
            <Brand name={tApp('name')} href="/" />
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher />
            </div>
          </div>
        </header>
        {children}
      </>
    );
  }

  const store = company.type !== 'SUPPLIER';
  const supplier = company.type !== 'STORE';
  const item = (href: NavItem['href'], key: string, icon: string): NavItem => ({
    href,
    label: t(key as 'feedLink'),
    testId: `go-${href.slice(1)}`,
    icon,
  });

  const groups: NavGroup[] = [
    {
      label: t('navGroups.main'),
      items: [
        item('/dashboard', 'dashboardLink', 'dashboard'),
        ...(store ? [item('/feed', 'feedLink', 'feed'), item('/cart', 'cartLink', 'cart')] : []),
        item('/orders', 'ordersLink', 'orders'),
        ...(supplier
          ? [
              item('/catalog', 'catalogLink', 'catalog'),
              item('/deliveries', 'deliveriesLink', 'deliveries'),
            ]
          : []),
      ],
    },
    ...(store
      ? [
          {
            label: t('navGroups.warehouse'),
            items: [item('/stock', 'stockLink', 'stock'), item('/pos', 'posLink', 'pos')],
          },
        ]
      : []),
    {
      label: t('navGroups.documents'),
      items: [
        ...(supplier ? [item('/settlements', 'settlementsLink', 'settlements')] : []),
        item('/archive', 'archiveLink', 'archive'),
        item('/chat', 'chatLink', 'chat'),
        item('/ratings', 'ratingsLink', 'ratings'),
      ],
    },
    {
      label: t('navGroups.company'),
      items: [
        item('/requisites', 'requisitesLink', 'requisites'),
        item('/employees', 'employeesLink', 'employees'),
      ],
    },
  ];

  return (
    <>
      <header className="border-border bg-card/85 lg:bg-sidebar lg:text-sidebar-foreground sticky top-0 z-30 flex flex-wrap items-center gap-x-3 border-b px-4 pt-2.5 backdrop-blur sm:px-6 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r-0 lg:border-b-0 lg:px-0 lg:pt-0">
        <div className="order-1 flex min-w-0 items-center lg:px-5 lg:pt-5 lg:pb-3">
          <Brand name={tApp('name')} href="/dashboard" compact />
        </div>

        <div
          className="order-4 hidden min-w-0 lg:order-2 lg:mx-3 lg:mb-1 lg:block lg:rounded-xl lg:bg-white/5 lg:px-3 lg:py-2.5"
          data-testid="shell-company"
        >
          <p className="truncate text-sm font-medium">{company.name}</p>
          <Badge tone="info" className="mt-1">
            {tType(company.type)}
          </Badge>
        </div>

        <div className="order-2 ml-auto flex items-center gap-2 lg:order-5 lg:ml-0 lg:justify-between lg:border-t lg:border-white/10 lg:px-4 lg:py-3">
          <LanguageSwitcher inShell />
          <LogoutButton label={t('logout')} />
        </div>

        <NavLinks groups={groups} />
      </header>

      <div className="lg:pl-64">{children}</div>
    </>
  );
}

/** Ссылка входа для гостевых страниц. */
export function LoginLink({ label }: { label: string }) {
  return (
    <Link href="/login" className={buttonVariants({ size: 'sm' })} data-testid="go-login">
      <LogIn aria-hidden />
      {label}
    </Link>
  );
}

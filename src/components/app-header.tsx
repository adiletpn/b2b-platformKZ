import { getTranslations } from 'next-intl/server';
import { LogIn } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { buttonVariants } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { LogoutButton } from '@/components/logout-button';
import { NavLinks } from '@/components/nav-links';
import { TabBar, type TabItem } from '@/components/tab-bar';

type NavItem = {
  href:
    | '/dashboard'
    | '/feed'
    | '/cart'
    | '/orders'
    | '/analytics'
    | '/stock'
    | '/pos'
    | '/catalog'
    | '/deliveries'
    | '/reps'
    | '/ratings'
    | '/requisites'
    | '/employees'
    | '/settlements'
    | '/archive'
    | '/support'
    | '/chat';
  label: string;
  testId: string;
  icon: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Знак Arbafind: значок из макета и название платформы. */
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
    <Link href={href} className="flex min-w-0 items-center gap-2.5" data-testid="brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/arbafind-mark.png"
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-[10px]"
      />
      <span
        className={`truncate text-lg font-black tracking-[-0.03em] ${compact ? 'hidden sm:inline lg:inline' : ''}`}
      >
        {name}
      </span>
    </Link>
  );
}

/** Инициалы для аватара: две первые буквы имени или названия. */
function initials(value: string) {
  const words = value
    .replace(/[«»"()]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !/^(ТОО|ИП|АО)$/i.test(word));
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || value.slice(0, 1).toUpperCase()
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
        item('/analytics', 'analyticsLink', 'analytics'),
        ...(supplier
          ? [
              item('/catalog', 'catalogLink', 'catalog'),
              item('/deliveries', 'deliveriesLink', 'deliveries'),
              item('/reps', 'repsLink', 'reps'),
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
        item('/support', 'supportLink', 'support'),
      ],
    },
  ];

  const tRoles = await getTranslations('employees.roles');
  const userName = session?.user.name ?? null;
  const roleLabel = tRoles(membership!.role as 'OWNER');

  // Нижняя панель на телефоне (макет M03–M13): пять главных разделов по типу компании.
  const tabs: TabItem[] = store
    ? [
        { href: '/feed', label: t('feedTab'), icon: 'feed' },
        { href: '/cart', label: t('cartLink'), icon: 'cart' },
        { href: '/orders', label: t('ordersLink'), icon: 'orders' },
        { href: '/pos', label: t('posLink'), icon: 'pos' },
        { href: '/dashboard', label: t('cabinetTab'), icon: 'cabinet' },
      ]
    : [
        { href: '/orders', label: t('ordersLink'), icon: 'orders' },
        { href: '/catalog', label: t('catalogLink'), icon: 'catalog' },
        { href: '/deliveries', label: t('deliveriesLink'), icon: 'deliveries' },
        { href: '/chat', label: t('chatLink'), icon: 'chat' },
        { href: '/dashboard', label: t('cabinetTab'), icon: 'cabinet' },
      ];

  return (
    <>
      <header className="border-border bg-card/90 lg:bg-sidebar lg:text-sidebar-foreground sticky top-0 z-30 flex flex-wrap items-center gap-x-3 border-b px-4 pt-2.5 backdrop-blur sm:px-6 lg:fixed lg:inset-y-0 lg:left-0 lg:w-[248px] lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r lg:border-b-0 lg:px-4 lg:pt-[22px] lg:backdrop-blur-none">
        <div className="order-1 flex min-w-0 items-center lg:px-2 lg:pb-5">
          <Brand name={tApp('name')} href="/dashboard" compact />
        </div>

        <div
          className="bg-muted order-4 mb-3.5 hidden min-w-0 items-center gap-2.5 rounded-2xl p-2.5 lg:order-2 lg:flex"
          data-testid="shell-company"
        >
          <span
            aria-hidden
            className="bg-primary grid size-9 shrink-0 place-items-center rounded-xl text-sm font-black text-white"
          >
            {initials(company.name).slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-extrabold">{company.name}</p>
            <p className="text-muted-foreground text-[11px] font-semibold">
              {tType(company.type)}
            </p>
          </div>
        </div>

        <div className="order-2 ml-auto flex items-center gap-2 lg:order-5 lg:ml-0 lg:flex-col lg:items-stretch lg:gap-3 lg:border-t lg:py-3">
          <div className="hidden items-center gap-2.5 px-1 lg:flex" data-testid="shell-user">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#b9a58f] text-[13px] font-black text-white"
            >
              {initials(userName ?? company.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold">{userName ?? company.name}</p>
              <p className="text-muted-foreground truncate text-[11px] font-semibold">
                {roleLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 lg:justify-between">
            <LanguageSwitcher />
            <LogoutButton label={t('logout')} />
          </div>
        </div>

        <NavLinks groups={groups} />
      </header>

      <div className="pb-24 lg:pb-0 lg:pl-[248px]">{children}</div>
      <TabBar items={tabs} />
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

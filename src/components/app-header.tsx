import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { LanguageSwitcher } from '@/components/language-switcher';
import { LogoutButton } from '@/components/logout-button';

type NavItem = {
  href:
    | '/feed'
    | '/cart'
    | '/orders'
    | '/stock'
    | '/catalog'
    | '/ratings'
    | '/requisites'
    | '/employees'
    | '/settlements'
    | '/chat';
  label: string;
  testId: string;
};

/** Общая шапка: бренд, разделы по типу компании, язык и выход. */
export async function AppHeader() {
  const t = await getTranslations('dashboard');
  const tApp = await getTranslations('app');

  // Компания уже приходит вместе с сессией: лишний запрос к базе на каждый рендер не нужен.
  const session = await getSession();
  const membership =
    session?.user.memberships.find(
      (item) => item.companyId === session.activeCompanyId && item.status === 'ACTIVE',
    ) ?? session?.user.memberships.find((item) => item.status === 'ACTIVE');
  const company = membership?.company ?? null;

  const items: NavItem[] = [];
  if (company) {
    if (company.type !== 'SUPPLIER') {
      items.push({ href: '/feed', label: t('feedLink'), testId: 'go-feed' });
      items.push({ href: '/cart', label: t('cartLink'), testId: 'go-cart' });
      items.push({ href: '/stock', label: t('stockLink'), testId: 'go-stock' });
    }
    if (company.type !== 'STORE') {
      items.push({ href: '/catalog', label: t('catalogLink'), testId: 'go-catalog' });
      items.push({
        href: '/settlements',
        label: t('settlementsLink'),
        testId: 'go-settlements',
      });
    }
    items.push({ href: '/orders', label: t('ordersLink'), testId: 'go-orders' });
    items.push({ href: '/chat', label: t('chatLink'), testId: 'go-chat' });
    items.push({ href: '/ratings', label: t('ratingsLink'), testId: 'go-ratings' });
    items.push({ href: '/requisites', label: t('requisitesLink'), testId: 'go-requisites' });
    items.push({ href: '/employees', label: t('employeesLink'), testId: 'go-employees' });
  }

  return (
    <header className="border-border bg-card/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href={company ? '/dashboard' : '/'} className="flex items-center gap-2">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-sm font-bold"
          >
            B
          </span>
          <span className="text-sm font-semibold whitespace-nowrap">{tApp('name')}</span>
        </Link>

        {items.length > 0 ? (
          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          {company ? <LogoutButton label={t('logout')} /> : null}
        </div>
      </div>
    </header>
  );
}

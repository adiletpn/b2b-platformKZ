import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MockupNotice } from '@/components/mockup-notice';

export default async function ChatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('mockups.chat');
  const tDashboard = await getTranslations('dashboard');

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>
      <MockupNotice />

      <section className="border-border bg-card mt-5 space-y-3 rounded-lg border p-4">
        <p className="bg-muted max-w-[80%] rounded-lg px-3 py-2 text-sm">{t('message1')}</p>
        <p className="bg-primary text-primary-foreground ml-auto max-w-[80%] rounded-lg px-3 py-2 text-sm">
          {t('message2')}
        </p>
      </section>

      <div className="mt-4 flex gap-2">
        <Input placeholder={t('placeholder')} disabled />
        <Button disabled>{t('send')}</Button>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">{t('templates')}</p>
    </main>
  );
}

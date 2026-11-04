import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Brand } from '@/components/app-header';
import { LoginForm } from './login-form';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tApp = await getTranslations('app');
  return <LoginForm brand={<Brand name={tApp('name')} href="/" testId="login-brand" />} />;
}

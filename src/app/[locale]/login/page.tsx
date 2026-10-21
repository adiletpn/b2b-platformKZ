import { connection } from 'next/server';
import { setRequestLocale } from 'next-intl/server';
import { LoginForm } from './login-form';
import { isPasswordLoginEnabled } from '@/lib/auth/password';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Флаг входа по паролю читается из БД на каждый запрос, а не при сборке.
  await connection();
  return <LoginForm passwordLogin={await isPasswordLoginEnabled()} />;
}

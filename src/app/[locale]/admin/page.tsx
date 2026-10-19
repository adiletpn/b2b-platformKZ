import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAdminSession } from '@/lib/admin/session';
import { prisma } from '@/lib/prisma';
import { getDashboard, listDisputes } from '@/lib/admin/dashboard';
import { AdminLogin } from './admin-login';
import { AdminPanel } from './admin-panel';

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getAdminSession();
  const t = await getTranslations('admin');

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold">{t('login')}</h1>
        <AdminLogin />
      </main>
    );
  }

  const [metrics, disputes, queue, audit, impersonations] = await Promise.all([
    getDashboard(),
    listDisputes(),
    prisma.verificationRequest.findMany({
      where: { status: 'PENDING' },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
    prisma.adminAuditLog.findMany({
      include: { admin: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.impersonationLog.findMany({
      where: { adminId: session.adminId, endedAt: null },
      include: { company: true },
      orderBy: { startedAt: 'desc' },
      take: 1,
    }),
  ]);

  return (
    <AdminPanel
      role={session.admin.role}
      metrics={metrics}
      disputes={disputes}
      queue={queue.map((request) => ({
        id: request.id,
        companyName: request.company.name,
        bin: request.company.bin,
      }))}
      audit={audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        admin: entry.admin.name,
        reason: entry.reason,
        createdAt: entry.createdAt.toLocaleString('ru-RU'),
      }))}
      activeImpersonation={
        impersonations[0]
          ? { id: impersonations[0].id, companyName: impersonations[0].company.name }
          : null
      }
      companies={(await prisma.company.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })).map(
        (company) => ({ id: company.id, name: company.name }),
      )}
    />
  );
}

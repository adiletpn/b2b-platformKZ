import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAdminSession } from '@/lib/admin/session';
import { prisma } from '@/lib/prisma';
import { getDashboard, listDisputes } from '@/lib/admin/dashboard';
import { listPlans, listSubscriptions } from '@/lib/admin/tariffs';
import { getReferenceData } from '@/lib/admin/reference';
import { AdminLogin } from './admin-login';
import { AdminPanel } from './admin-panel';
import { TemplateEditor } from './template-editor';
import { getTemplateEditorData, TEMPLATE_EDITOR_ROLES } from '@/lib/admin/templates';
import { Page } from '@/components/ui/page';
import { ComplaintsPanel } from './complaints-panel';
import {
  BroadcastPanel,
  IntegrationsPanel,
  ReportsPanel,
  TicketsPanel,
  UsersPanel,
} from './admin-ops';
import { listOpenComplaints } from '@/lib/chat/extras';
import { listTickets } from '@/lib/support/tickets';
import { integrationStatus } from '@/lib/admin/broadcasts';

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

  const [metrics, disputes, plans, subscriptions, reference, queue, audit, impersonations] =
    await Promise.all([
      getDashboard(),
      listDisputes(),
      listPlans(),
      listSubscriptions(),
      getReferenceData(),
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

  const role = session.admin.role;
  const canEditTemplates = TEMPLATE_EDITOR_ROLES.includes(role);
  const templates = canEditTemplates ? await getTemplateEditorData('WAYBILL', 'ru') : null;
  // Раздел 3.13 ТЗ: каждой роли администратора — свои разделы.
  const is = (...roles: string[]) => role === 'SUPERADMIN' || roles.includes(role);
  const [complaints, tickets, cities] = await Promise.all([
    is('MODERATOR') ? listOpenComplaints() : Promise.resolve(null),
    is('SUPPORT') ? listTickets() : Promise.resolve(null),
    is('CONTENT_MANAGER')
      ? prisma.city.findMany({
          orderBy: { nameRu: 'asc' },
          select: { id: true, nameRu: true, nameKk: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <AdminPanel
        role={session.admin.role}
        metrics={metrics}
        disputes={disputes}
        plans={plans}
        subscriptions={subscriptions}
        reference={reference}
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
        companies={(
          await prisma.company.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
        ).map((company) => ({ id: company.id, name: company.name }))}
      />
      <Page width="lg" className="space-y-4 pt-0 sm:pt-0">
        {complaints ? <ComplaintsPanel initial={complaints} /> : null}
        {tickets ? <TicketsPanel initial={tickets} /> : null}
        {is('SUPPORT') ? <UsersPanel /> : null}
        {is('FINANCE') ? <ReportsPanel /> : null}
        {cities ? (
          <BroadcastPanel
            cities={cities.map((city) => ({
              id: city.id,
              name: locale === 'kk' ? city.nameKk : city.nameRu,
            }))}
            plans={plans.map((plan) => ({ code: plan.code, name: plan.nameRu }))}
          />
        ) : null}
        {templates ? <TemplateEditor initial={templates} /> : null}
        {role === 'SUPERADMIN' ? <IntegrationsPanel rows={integrationStatus()} /> : null}
      </Page>
    </>
  );
}

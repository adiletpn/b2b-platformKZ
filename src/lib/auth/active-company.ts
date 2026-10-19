import { getSession } from './session';

export type ActiveCompany = { sessionId: string; userId: string; companyId: string };

/** Активная компания сессии. Правило 4: дальше все запросы идут только по ней. */
export async function getActiveCompany(): Promise<ActiveCompany | null> {
  const session = await getSession();
  if (!session) return null;

  const membership =
    session.user.memberships.find(
      (item) => item.companyId === session.activeCompanyId && item.status === 'ACTIVE',
    ) ?? session.user.memberships.find((item) => item.status === 'ACTIVE');

  if (!membership) return null;
  return { sessionId: session.id, userId: session.userId, companyId: membership.companyId };
}

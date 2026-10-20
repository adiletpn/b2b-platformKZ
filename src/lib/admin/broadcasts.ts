import type { CompanyType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { writeAdminAudit } from './session';

export type BroadcastInput = {
  text: string;
  cityId?: string;
  type?: CompanyType;
  planCode?: string;
};

/**
 * Рассылка по сегменту (раздел 3.13 ТЗ): город, тип компании, тариф. Уходит в каналы,
 * которые выбрала каждая компания (раздел 3.10), через тот же мок уведомлений.
 */
export async function sendBroadcast(adminId: string, input: BroadcastInput) {
  const text = input.text.trim();
  if (text.length < 3 || text.length > 1000) return { status: 'invalid_text' as const };

  const companies = await prisma.company.findMany({
    where: {
      ...(input.type ? { type: input.type } : {}),
      ...(input.cityId
        ? {
            OR: [
              { locations: { some: { cityId: input.cityId } } },
              { deliveryZones: { some: { cityId: input.cityId } } },
            ],
          }
        : {}),
      ...(input.planCode
        ? {
            subscriptions: {
              some: { plan: { code: input.planCode }, status: { in: ['ACTIVE', 'TRIAL'] } },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  for (const company of companies) {
    await notify(company.id, 'platform_broadcast', { text: text.slice(0, 300) });
  }
  const broadcast = await prisma.broadcast.create({
    data: {
      adminId,
      text,
      cityId: input.cityId ?? null,
      type: input.type ?? null,
      planCode: input.planCode ?? null,
      recipients: companies.length,
    },
  });
  await writeAdminAudit(adminId, 'broadcast_sent', { entity: 'Broadcast', entityId: broadcast.id });
  return { status: 'ok' as const, recipients: companies.length };
}

/** Интеграции платформы (раздел 3.13 ТЗ): подключён ли боевой ключ. Сами ключи не показываются. */
export function integrationStatus() {
  const configured = (name: string) => Boolean(process.env[name]);
  return [
    { key: 'sms', env: 'SMS_API_KEY', live: configured('SMS_API_KEY') },
    { key: 'messengers', env: 'WHATSAPP_API_KEY', live: configured('WHATSAPP_API_KEY') },
    { key: 'payments', env: 'PAYMENT_API_KEY', live: configured('PAYMENT_API_KEY') },
    { key: 'webhook', env: 'PAYMENT_WEBHOOK_SECRET', live: configured('PAYMENT_WEBHOOK_SECRET') },
    { key: 'fiscal', env: 'FISCAL_API_KEY', live: configured('FISCAL_API_KEY') },
    { key: 'ecp', env: 'ECP_PROVIDER_URL', live: configured('ECP_PROVIDER_URL') },
    { key: 'monitoring', env: 'MONITORING_DSN', live: configured('MONITORING_DSN') },
    { key: 'maps', env: 'MAPS_API_KEY', live: configured('MAPS_API_KEY') },
    { key: 'appUrl', env: 'APP_URL', live: configured('APP_URL') },
  ];
}

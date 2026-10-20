import type { BannerAudience, CompanyType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { kzDayKey } from '@/lib/format';
import { writeAdminAudit } from './session';

/** Баннеры ведут те же, кто делает рассылки: суперадмин и контент-менеджер (раздел 3.13 ТЗ). */
export const BANNER_EDITOR_ROLES = ['SUPERADMIN', 'CONTENT_MANAGER'];
export const BANNER_AUDIENCES = ['ALL', 'STORES', 'SUPPLIERS'] as const;
export const BANNER_TEXT_MAX = 300;

export type BannerInput = {
  textRu: string;
  textKk: string;
  audience: string;
  startsOn: string;
  endsOn: string;
};

export type BannerRow = {
  id: string;
  textRu: string;
  textKk: string;
  audience: BannerAudience;
  startsOn: string;
  endsOn: string;
};

export type BannerResult =
  | { status: 'ok'; id: string }
  | { status: 'text_required' }
  | { status: 'invalid_audience' }
  | { status: 'invalid_dates' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function toRow(banner: {
  id: string;
  textRu: string;
  textKk: string;
  audience: BannerAudience;
  startsOn: Date;
  endsOn: Date;
}): BannerRow {
  return {
    id: banner.id,
    textRu: banner.textRu,
    textKk: banner.textKk,
    audience: banner.audience,
    startsOn: banner.startsOn.toISOString().slice(0, 10),
    endsOn: banner.endsOn.toISOString().slice(0, 10),
  };
}

/** Баннер в кабинете: текст на обоих языках обязателен (решение заказчика про ru и kk). */
export async function createBanner(adminId: string, input: BannerInput): Promise<BannerResult> {
  const textRu = input.textRu.trim();
  const textKk = input.textKk.trim();
  if (!textRu || !textKk || textRu.length > BANNER_TEXT_MAX || textKk.length > BANNER_TEXT_MAX) {
    return { status: 'text_required' };
  }
  if (!(BANNER_AUDIENCES as readonly string[]).includes(input.audience)) {
    return { status: 'invalid_audience' };
  }
  if (!DAY.test(input.startsOn) || !DAY.test(input.endsOn) || input.endsOn < input.startsOn) {
    return { status: 'invalid_dates' };
  }
  const banner = await prisma.banner.create({
    data: {
      textRu,
      textKk,
      audience: input.audience as BannerAudience,
      startsOn: new Date(input.startsOn),
      endsOn: new Date(input.endsOn),
      createdById: adminId,
    },
  });
  await writeAdminAudit(adminId, 'banner_created', { entity: 'Banner', entityId: banner.id });
  return { status: 'ok', id: banner.id };
}

export async function deleteBanner(adminId: string, id: string): Promise<'ok' | 'not_found'> {
  const deleted = await prisma.banner.deleteMany({ where: { id } });
  if (deleted.count === 0) return 'not_found';
  await writeAdminAudit(adminId, 'banner_deleted', { entity: 'Banner', entityId: id });
  return 'ok';
}

/** Баннеры для админки: текущие и будущие. */
export async function listBanners(now = new Date()): Promise<BannerRow[]> {
  const rows = await prisma.banner.findMany({
    where: { endsOn: { gte: new Date(kzDayKey(now)) } },
    orderBy: { startsOn: 'asc' },
    take: 50,
  });
  return rows.map(toRow);
}

/**
 * Баннеры, которые сегодня видит компания: по датам показа (по календарю Казахстана)
 * и по типу компании. Компания «магазин и поставщик» видит баннеры обеих сторон.
 */
export async function activeBannersFor(type: CompanyType, now = new Date()): Promise<BannerRow[]> {
  const today = new Date(kzDayKey(now));
  const audiences: BannerAudience[] = ['ALL'];
  if (type !== 'SUPPLIER') audiences.push('STORES');
  if (type !== 'STORE') audiences.push('SUPPLIERS');
  const rows = await prisma.banner.findMany({
    where: { audience: { in: audiences }, startsOn: { lte: today }, endsOn: { gte: today } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return rows.map(toRow);
}

import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

try {
  loadEnvFile('.env');
} catch {
  // В CI переменные приходят из окружения.
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL не задан');

// Тесты всегда работают с отдельной базой, чтобы не затирать демо-данные.
process.env.DATABASE_URL = testDatabaseUrl;

export function createTestPrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
}

/** Чистит операционные данные; справочники (города, НДС, единицы, категории) остаются. */
export async function resetTransactionalData(prisma: PrismaClient) {
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.stockDocumentLine.deleteMany();
  await prisma.stockDocument.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.document.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderStatusLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.order.deleteMany();
  await prisma.numberSequence.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.swipeAction.deleteMany();
  await prisma.supplierOffer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.companyAccessRequest.deleteMany();
  await prisma.deliveryZone.deleteMany();
  await prisma.location.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.company.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.user.deleteMany();

  await resetPlatformFlags(prisma);
}

/** Флаги платформы глобальные: тесты обязаны возвращать их в исходное состояние. */
export async function resetPlatformFlags(prisma: PrismaClient) {
  await prisma.adminAuditLog.deleteMany();
  await prisma.impersonationLog.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.platformSetting.upsert({
    where: { key: 'auto_verify_companies' },
    update: { value: 'true' },
    create: { key: 'auto_verify_companies', value: 'true' },
  });
}
